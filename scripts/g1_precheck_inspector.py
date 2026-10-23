#!/usr/bin/env python3
"""Read-only, fail-closed G1 settings classifier.

The inspector accepts only fixed ASUS user-settings paths. Its test suite uses
synthetic home directories; never run the real-home mode before the exact
Founder approval has been received and reviewed. The CLI gate ID is an operator
attestation, not an online verification of the Founder response.
"""

from __future__ import annotations

import errno
import json
import os
import re
import stat
import sys
import tomllib
from pathlib import Path
from typing import Any


MAX_INPUT_BYTES = 2 * 1024 * 1024
MAX_OUTPUT_BYTES = 2048
APPROVAL_ID = re.compile(r"^HG-[0-9]{8}-[a-f0-9]{6}$")
REJECTED_APPROVAL_IDS = {"HG-20261022-b6d048", "HG-20261023-e0fa18"}
OPEN_FLAGS = os.O_RDONLY | getattr(os, "O_CLOEXEC", 0) | getattr(os, "O_NOFOLLOW", 0)
DIRECTORY_FLAGS = OPEN_FLAGS | getattr(os, "O_DIRECTORY", 0)

REASONS = {
    "MISSING",
    "SYMLINK",
    "WRONG_TYPE",
    "SIZE_LIMIT",
    "FILE_CHANGED",
    "INVALID_UTF8",
    "PARSE_ERROR",
    "DUPLICATE_KEY",
    "UNSUPPORTED_JSONC",
    "SCHEMA_UNKNOWN",
    "ACCESS_ERROR",
    "OUTPUT_LIMIT",
    "NOT_CHECKED",
}


class InspectionError(Exception):
    """An error with a deliberately non-sensitive, fixed reason code."""

    def __init__(self, reason: str):
        self.reason = reason if reason in REASONS else "ACCESS_ERROR"
        super().__init__(self.reason)


class DuplicateJSONKey(ValueError):
    pass


def _json_object(pairs: list[tuple[str, Any]]) -> dict[str, Any]:
    result: dict[str, Any] = {}
    for key, value in pairs:
        if key in result:
            raise DuplicateJSONKey()
        result[key] = value
    return result


def _reject_json_constant(_: str) -> None:
    raise ValueError()


def _absolute_parts(path: Path) -> list[str]:
    if not path.is_absolute():
        raise InspectionError("ACCESS_ERROR")
    normalized = Path(os.path.abspath(os.fspath(path)))
    return [part for part in normalized.parts if part not in (normalized.anchor, "", ".")]


def _open_directory_chain(parts: list[str]) -> int:
    """Open each exact directory component without following symlinks."""
    if os.name != "posix" or not hasattr(os, "O_NOFOLLOW") or not hasattr(os, "O_DIRECTORY"):
        raise InspectionError("ACCESS_ERROR")
    try:
        fd = os.open(os.sep, DIRECTORY_FLAGS)
    except OSError:
        raise InspectionError("ACCESS_ERROR") from None
    try:
        for part in parts:
            if part in (".", "..", ""):
                raise InspectionError("ACCESS_ERROR")
            try:
                component = os.stat(part, dir_fd=fd, follow_symlinks=False)
            except FileNotFoundError:
                raise InspectionError("MISSING") from None
            except OSError:
                raise InspectionError("ACCESS_ERROR") from None
            if stat.S_ISLNK(component.st_mode):
                raise InspectionError("SYMLINK")
            if not stat.S_ISDIR(component.st_mode):
                raise InspectionError("WRONG_TYPE")
            try:
                next_fd = os.open(part, DIRECTORY_FLAGS, dir_fd=fd)
            except OSError as exc:
                if exc.errno == errno.ELOOP:
                    raise InspectionError("SYMLINK") from None
                if exc.errno == errno.ENOENT:
                    raise InspectionError("MISSING") from None
                if exc.errno == errno.ENOTDIR:
                    raise InspectionError("WRONG_TYPE") from None
                raise InspectionError("ACCESS_ERROR") from None
            os.close(fd)
            fd = next_fd
        return fd
    except Exception:
        os.close(fd)
        raise


def _parent_fd(home: Path, relative: tuple[str, ...]) -> tuple[int, str]:
    if not relative or any(part in ("", ".", "..") for part in relative):
        raise InspectionError("ACCESS_ERROR")
    parts = _absolute_parts(home) + list(relative[:-1])
    return _open_directory_chain(parts), relative[-1]


def _probe_regular(home: Path, relative: tuple[str, ...]) -> os.stat_result | None:
    parent, leaf = _parent_fd(home, relative)
    try:
        try:
            item = os.stat(leaf, dir_fd=parent, follow_symlinks=False)
        except FileNotFoundError:
            return None
        except OSError:
            raise InspectionError("ACCESS_ERROR") from None
        if stat.S_ISLNK(item.st_mode):
            raise InspectionError("SYMLINK")
        if not stat.S_ISREG(item.st_mode):
            raise InspectionError("WRONG_TYPE")
        return item
    finally:
        os.close(parent)


def _same_file_state(before: os.stat_result, after: os.stat_result) -> bool:
    return (
        before.st_dev == after.st_dev
        and before.st_ino == after.st_ino
        and before.st_size == after.st_size
        and before.st_mtime_ns == after.st_mtime_ns
        and before.st_ctime_ns == after.st_ctime_ns
    )


def _read_bounded(home: Path, relative: tuple[str, ...]) -> bytes:
    parent, leaf = _parent_fd(home, relative)
    fd = -1
    try:
        try:
            before = os.stat(leaf, dir_fd=parent, follow_symlinks=False)
        except FileNotFoundError:
            raise InspectionError("MISSING") from None
        except OSError:
            raise InspectionError("ACCESS_ERROR") from None
        if stat.S_ISLNK(before.st_mode):
            raise InspectionError("SYMLINK")
        if not stat.S_ISREG(before.st_mode):
            raise InspectionError("WRONG_TYPE")
        if before.st_size > MAX_INPUT_BYTES:
            raise InspectionError("SIZE_LIMIT")
        try:
            fd = os.open(leaf, OPEN_FLAGS, dir_fd=parent)
        except OSError as exc:
            if exc.errno == errno.ELOOP:
                raise InspectionError("SYMLINK") from None
            raise InspectionError("ACCESS_ERROR") from None
        opened = os.fstat(fd)
        if not stat.S_ISREG(opened.st_mode):
            raise InspectionError("WRONG_TYPE")
        if not _same_file_state(before, opened):
            raise InspectionError("FILE_CHANGED")
        try:
            with os.fdopen(fd, "rb", closefd=True) as stream:
                fd = -1
                # The full bounded byte string and decoded parser structures can coexist in memory.
                raw = stream.read(MAX_INPUT_BYTES + 1)
                after = os.fstat(stream.fileno())
        except InspectionError:
            raise
        except Exception:
            raise InspectionError("ACCESS_ERROR") from None
        if len(raw) > MAX_INPUT_BYTES:
            raise InspectionError("SIZE_LIMIT")
        if len(raw) != before.st_size or not _same_file_state(before, after):
            raise InspectionError("FILE_CHANGED")
        return raw
    finally:
        if fd >= 0:
            os.close(fd)
        os.close(parent)


def _decode_json(raw: bytes) -> dict[str, Any]:
    try:
        value = json.loads(raw, object_pairs_hook=_json_object, parse_constant=_reject_json_constant)
    except DuplicateJSONKey:
        raise InspectionError("DUPLICATE_KEY") from None
    except (UnicodeDecodeError,):
        raise InspectionError("INVALID_UTF8") from None
    except Exception:
        raise InspectionError("PARSE_ERROR") from None
    if not isinstance(value, dict):
        raise InspectionError("SCHEMA_UNKNOWN")
    return value


def _decode_toml(raw: bytes) -> dict[str, Any]:
    try:
        text = raw.decode("utf-8")
    except UnicodeDecodeError:
        raise InspectionError("INVALID_UTF8") from None
    try:
        value = tomllib.loads(text)
    except Exception:
        raise InspectionError("PARSE_ERROR") from None
    if not isinstance(value, dict):
        raise InspectionError("SCHEMA_UNKNOWN")
    return value


def _presence(value: Any) -> str:
    if isinstance(value, dict) or isinstance(value, list):
        return "PRESENT" if value else "EMPTY"
    return "UNKNOWN"


def _boolean(value: Any) -> str:
    if isinstance(value, bool):
        return "TRUE" if value else "FALSE"
    return "UNKNOWN"


def _permission_classes(value: Any) -> dict[str, str]:
    unknown_shape = {"allow": "UNKNOWN", "ask": "UNKNOWN", "deny": "UNKNOWN"}
    if not isinstance(value, (dict, list)):
        return unknown_shape
    pending = [value]
    seen = {"allow": False, "ask": False, "deny": False}
    other = False
    while pending:
        current = pending.pop()
        if isinstance(current, dict):
            pending.extend(current.values())
        elif isinstance(current, list):
            pending.extend(current)
        elif isinstance(current, str) and current in seen:
            seen[current] = True
        else:
            other = True
    return {
        key: "PRESENT" if found else "UNKNOWN" if other else "ABSENT"
        for key, found in seen.items()
    }


def _claude_summary(obj: dict[str, Any]) -> dict[str, Any]:
    permissions = obj.get("permissions")
    if not isinstance(permissions, dict):
        return {"status": "UNKNOWN", "reason": "SCHEMA_UNKNOWN"}
    rules: dict[str, str] = {}
    for category in ("allow", "ask", "deny"):
        value = permissions.get(category)
        if isinstance(value, list):
            rules[category] = "PRESENT" if value else "EMPTY"
        elif category not in permissions:
            rules[category] = "MISSING"
        else:
            rules[category] = "UNKNOWN"
    return {
        "status": "CLASSIFIED",
        "permissions": rules,
        "hooks": _presence(obj["hooks"]) if "hooks" in obj else "MISSING",
        "enabledPlugins": _presence(obj["enabledPlugins"]) if "enabledPlugins" in obj else "MISSING",
        "autoMode": _boolean(obj["autoMode"]) if "autoMode" in obj else "MISSING",
        "skipDangerousModePermissionPrompt": (
            _boolean(obj["skipDangerousModePermissionPrompt"])
            if "skipDangerousModePermissionPrompt" in obj else "MISSING"
        ),
    }


def _codex_summary(obj: dict[str, Any]) -> dict[str, Any]:
    approval = obj.get("approval_policy")
    sandbox = obj.get("sandbox_mode")
    approvals = {"on-request": "ON_REQUEST", "never": "NEVER", "untrusted": "UNTRUSTED"}
    sandboxes = {"read-only": "READ_ONLY", "workspace-write": "WORKSPACE_WRITE", "danger-full-access": "DANGER_FULL_ACCESS"}
    return {
        "status": "CLASSIFIED",
        "approval_policy": (
            approvals.get(approval, "OTHER") if isinstance(approval, str)
            else "MISSING" if "approval_policy" not in obj else "UNKNOWN"
        ),
        "sandbox_mode": (
            sandboxes.get(sandbox, "OTHER") if isinstance(sandbox, str)
            else "MISSING" if "sandbox_mode" not in obj else "UNKNOWN"
        ),
        "mcp_present": _presence(obj["mcp_servers"]) if "mcp_servers" in obj else "MISSING",
        "profile_present": (
            "PRESENT" if "profile" in obj or "profiles" in obj
            else "MISSING"
        ),
    }


def _opencode_summary(obj: dict[str, Any]) -> dict[str, Any]:
    if "permission" not in obj:
        permission = {"allow": "UNKNOWN", "ask": "UNKNOWN", "deny": "UNKNOWN"}
    else:
        permission = _permission_classes(obj["permission"])
    return {
        "status": "CLASSIFIED",
        "permission": permission,
        "plugin_present": _presence(obj["plugin"]) if "plugin" in obj else "MISSING",
        "mcp_present": _presence(obj["mcp"]) if "mcp" in obj else "MISSING",
    }


def _unknown(reason: str) -> dict[str, str]:
    return {"status": "UNKNOWN", "reason": reason if isinstance(reason, str) and reason in REASONS else "ACCESS_ERROR"}


def _inspect_json(home: Path, relative: tuple[str, ...], summarize: Any) -> dict[str, Any]:
    raw = _read_bounded(home, relative)
    obj = _decode_json(raw)
    return summarize(obj)


def _inspect_toml(home: Path, relative: tuple[str, ...], summarize: Any) -> dict[str, Any]:
    raw = _read_bounded(home, relative)
    obj = _decode_toml(raw)
    return summarize(obj)


def inspect_home(home: Path) -> dict[str, Any]:
    """Inspect only the three fixed files under `home`; intended for approved runs."""
    report: dict[str, Any] = {}
    targets = (
        ("claude", (".claude", "settings.json"), "json", _claude_summary),
        ("codex", (".codex", "config.toml"), "toml", _codex_summary),
    )
    for index, (provider, relative, fmt, summarize) in enumerate(targets):
        try:
            report[provider] = _inspect_json(home, relative, summarize) if fmt == "json" else _inspect_toml(home, relative, summarize)
        except InspectionError as exc:
            report[provider] = _unknown(exc.reason)
            for later_provider, _, _, _ in targets[index + 1:]:
                report[later_provider] = _unknown("NOT_CHECKED")
            report["opencode"] = _unknown("NOT_CHECKED")
            return report
    if "opencode" not in report:
        try:
            json_path = (".config", "opencode", "opencode.json")
            jsonc_path = (".config", "opencode", "opencode.jsonc")
            json_stat = _probe_regular(home, json_path)
            if json_stat is not None:
                report["opencode"] = _inspect_json(home, json_path, _opencode_summary)
            else:
                jsonc_stat = _probe_regular(home, jsonc_path)
                if jsonc_stat is None:
                    report["opencode"] = _unknown("MISSING")
                else:
                    report["opencode"] = _unknown("UNSUPPORTED_JSONC")
        except InspectionError as exc:
            report["opencode"] = _unknown(exc.reason)
    if len(json.dumps(report, separators=(",", ":"), ensure_ascii=True).encode("ascii")) > MAX_OUTPUT_BYTES:
        return {"status": "UNKNOWN", "reason": "OUTPUT_LIMIT"}
    return report


def render_report(report: dict[str, Any]) -> bytes:
    enum_presence = {"PRESENT", "EMPTY", "MISSING", "UNKNOWN"}
    sanitized: dict[str, Any] = {}
    schemas = {
        "claude": {
            "permissions": {key: {"PRESENT", "EMPTY", "MISSING", "UNKNOWN"} for key in ("allow", "ask", "deny")},
            "hooks": enum_presence,
            "enabledPlugins": enum_presence,
            "autoMode": {"TRUE", "FALSE", "MISSING", "UNKNOWN"},
            "skipDangerousModePermissionPrompt": {"TRUE", "FALSE", "MISSING", "UNKNOWN"},
        },
        "codex": {
            "approval_policy": {"ON_REQUEST", "NEVER", "UNTRUSTED", "OTHER", "MISSING", "UNKNOWN"},
            "sandbox_mode": {"READ_ONLY", "WORKSPACE_WRITE", "DANGER_FULL_ACCESS", "OTHER", "MISSING", "UNKNOWN"},
            "mcp_present": enum_presence,
            "profile_present": {"PRESENT", "MISSING"},
        },
        "opencode": {
            "permission": {key: {"PRESENT", "ABSENT", "UNKNOWN"} for key in ("allow", "ask", "deny")},
            "plugin_present": enum_presence,
            "mcp_present": enum_presence,
        },
    }
    if not isinstance(report, dict):
        return b'{"status":"UNKNOWN","reason":"SCHEMA_UNKNOWN"}'
    for provider, fields in schemas.items():
        item = report.get(provider)
        if not isinstance(item, dict) or item.get("status") not in ("CLASSIFIED", "UNKNOWN"):
            sanitized[provider] = _unknown("SCHEMA_UNKNOWN")
            continue
        if item["status"] == "UNKNOWN":
            sanitized[provider] = _unknown(item.get("reason", "SCHEMA_UNKNOWN"))
            continue
        clean: dict[str, Any] = {"status": "CLASSIFIED"}
        valid = True
        for field, allowed in fields.items():
            value = item.get(field)
            if isinstance(allowed, dict):
                if not isinstance(value, dict):
                    valid = False
                    break
                safe_nested = {key: value.get(key) for key in allowed}
                if any(not isinstance(safe_nested[key], str) or safe_nested[key] not in allowed[key] for key in allowed):
                    valid = False
                    break
                clean[field] = safe_nested
            elif not isinstance(value, str) or value not in allowed:
                valid = False
                break
            else:
                clean[field] = value
        sanitized[provider] = clean if valid else _unknown("SCHEMA_UNKNOWN")
    payload = json.dumps(sanitized, separators=(",", ":"), ensure_ascii=True).encode("ascii")
    if len(payload) > MAX_OUTPUT_BYTES:
        return b'{"status":"UNKNOWN","reason":"OUTPUT_LIMIT"}'
    return payload


def main(argv: list[str] | None = None) -> int:
    args = sys.argv[1:] if argv is None else argv
    if len(args) != 2 or args[0] != "--approved-gate":
        sys.stdout.buffer.write(b'{"status":"NOT_RUN","reason":"INVALID_APPROVAL_REFERENCE"}\n')
        return 2
    approval_id = args[1]
    if not APPROVAL_ID.fullmatch(approval_id) or approval_id in REJECTED_APPROVAL_IDS:
        sys.stdout.buffer.write(b'{"status":"NOT_RUN","reason":"INVALID_APPROVAL_REFERENCE"}\n')
        return 2
    try:
        report = inspect_home(Path.home())
        output = render_report(report)
    except Exception:
        output = b'{"status":"UNKNOWN","reason":"ACCESS_ERROR"}'
    sys.stdout.buffer.write(output + b"\n")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
