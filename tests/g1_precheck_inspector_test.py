import json
import io
import os
import sys
import tempfile
import unittest
from pathlib import Path
from unittest import mock

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
from scripts import g1_precheck_inspector as inspector


CANARY = "SYNTHETIC_SECRET_CANARY_84f2"
MAX = inspector.MAX_INPUT_BYTES


def write(root: Path, relative: tuple[str, ...], content: bytes) -> Path:
    path = root.joinpath(*relative)
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_bytes(content)
    return path


def complete_home(root: Path) -> None:
    write(root, (".claude", "settings.json"), json.dumps({
        "permissions": {"allow": [CANARY], "ask": [], "deny": []},
        "hooks": {"PreToolUse": [{"command": CANARY}]},
        "enabledPlugins": {CANARY: True},
        "autoMode": True,
        "skipDangerousModePermissionPrompt": False,
    }).encode())
    write(root, (".codex", "config.toml"), (
        'approval_policy = "on-request"\n'
        'sandbox_mode = "workspace-write"\n'
        f'profile = "{CANARY}"\n'
        f'[mcp_servers."{CANARY}"]\ncommand = "{CANARY}"\n'
    ).encode())
    write(root, (".config", "opencode", "opencode.json"), json.dumps({
        "permission": {"edit": "ask", "write": "deny"},
        "plugin": {CANARY: True},
        "mcp": {CANARY: {"url": CANARY}},
    }).encode())


class InspectorTests(unittest.TestCase):
    def test_synthetic_json_toml_classification_never_returns_values(self):
        with tempfile.TemporaryDirectory() as temp:
            root = Path(temp)
            complete_home(root)
            result = inspector.inspect_home(root)
        serialized = inspector.render_report(result)
        self.assertEqual(result["claude"]["status"], "CLASSIFIED")
        self.assertEqual(result["codex"]["approval_policy"], "ON_REQUEST")
        self.assertEqual(result["opencode"]["permission"], {"allow": "ABSENT", "ask": "PRESENT", "deny": "PRESENT"})
        self.assertNotIn(CANARY.encode(), serialized)
        self.assertLessEqual(len(serialized), inspector.MAX_OUTPUT_BYTES)

    def test_exact_two_mib_is_accepted(self):
        with tempfile.TemporaryDirectory() as temp:
            root = Path(temp)
            base = json.dumps({"permissions": {}}).encode()
            raw = base + b" " * (MAX - len(base))
            write(root, (".claude", "settings.json"), raw)
            result = inspector._inspect_json(root, (".claude", "settings.json"), inspector._claude_summary)
        self.assertEqual(result["status"], "CLASSIFIED")

    def test_over_two_mib_fails_before_reading_content(self):
        with tempfile.TemporaryDirectory() as temp:
            root = Path(temp)
            path = write(root, (".claude", "settings.json"), b"{}" + b" " * (MAX - 1))
            with mock.patch.object(inspector.os, "fdopen", side_effect=AssertionError("must not read")):
                with self.assertRaises(inspector.InspectionError) as caught:
                    inspector._read_bounded(root, (".claude", "settings.json"))
        self.assertEqual(caught.exception.reason, "SIZE_LIMIT")

    def test_wrong_file_type_fails_closed(self):
        with tempfile.TemporaryDirectory() as temp:
            root = Path(temp)
            (root / ".claude").mkdir()
            (root / ".claude" / "settings.json").mkdir()
            with self.assertRaises(inspector.InspectionError) as caught:
                inspector._read_bounded(root, (".claude", "settings.json"))
        self.assertEqual(caught.exception.reason, "WRONG_TYPE")

    @unittest.skipUnless(hasattr(os, "O_NOFOLLOW"), "requires Linux no-follow open")
    def test_symlink_final_and_directory_component_fail_closed(self):
        with tempfile.TemporaryDirectory() as temp:
            root = Path(temp)
            target = root / "outside.json"
            target.write_text('{"permissions":{}}', encoding="utf-8")
            (root / ".claude").mkdir()
            (root / ".claude" / "settings.json").symlink_to(target)
            with self.assertRaises(inspector.InspectionError) as final_error:
                inspector._read_bounded(root, (".claude", "settings.json"))
            (root / ".claude" / "settings.json").unlink()
            (root / ".claude").rmdir()
            (root / ".claude").symlink_to(root, target_is_directory=True)
            with self.assertRaises(inspector.InspectionError) as parent_error:
                inspector._read_bounded(root, (".claude", "settings.json"))
        self.assertEqual(final_error.exception.reason, "SYMLINK")
        self.assertEqual(parent_error.exception.reason, "SYMLINK")

    def test_opencode_json_wins_and_jsonc_is_not_read(self):
        with tempfile.TemporaryDirectory() as temp:
            root = Path(temp)
            complete_home(root)
            write(root, (".config", "opencode", "opencode.json"), b'{"permission":{}}')
            write(root, (".config", "opencode", "opencode.jsonc"), CANARY.encode())
            real_read = inspector._read_bounded
            def guarded_read(home, relative):
                if relative[-1] == "opencode.jsonc":
                    raise AssertionError("lower-priority JSONC must not be opened")
                return real_read(home, relative)
            with mock.patch.object(inspector, "_read_bounded", side_effect=guarded_read):
                result = inspector.inspect_home(root)
        self.assertEqual(result["opencode"]["status"], "CLASSIFIED")
        self.assertNotIn(CANARY.encode(), inspector.render_report(result))

    def test_jsonc_fallback_is_unknown_without_opening_content(self):
        with tempfile.TemporaryDirectory() as temp:
            root = Path(temp)
            complete_home(root)
            (root / ".config" / "opencode" / "opencode.json").unlink()
            write(root, (".config", "opencode", "opencode.jsonc"), CANARY.encode())
            real_read = inspector._read_bounded
            def guarded_read(home, relative):
                if relative[-1] == "opencode.jsonc":
                    raise AssertionError("JSONC must not be opened")
                return real_read(home, relative)
            with mock.patch.object(inspector, "_read_bounded", side_effect=guarded_read):
                result = inspector.inspect_home(root)
        self.assertEqual(result["opencode"], {"status": "UNKNOWN", "reason": "UNSUPPORTED_JSONC"})

    @unittest.skipUnless(hasattr(os, "O_NOFOLLOW"), "requires Linux no-follow open")
    def test_opencode_primary_symlink_stops_without_jsonc_fallback(self):
        with tempfile.TemporaryDirectory() as temp:
            root = Path(temp)
            complete_home(root)
            primary = root / ".config" / "opencode" / "opencode.json"
            primary.unlink()
            target = root / "other.json"
            target.write_text("{}", encoding="utf-8")
            primary.symlink_to(target)
            real_read = inspector._read_bounded
            def guarded_read(home, relative):
                if relative[-1] == "opencode.jsonc":
                    raise AssertionError("must not fall back after a symlink")
                return real_read(home, relative)
            with mock.patch.object(inspector, "_read_bounded", side_effect=guarded_read):
                result = inspector.inspect_home(root)
        self.assertEqual(result["opencode"], {"status": "UNKNOWN", "reason": "SYMLINK"})

    def test_opencode_unrecognized_permission_shape_is_unknown(self):
        with tempfile.TemporaryDirectory() as temp:
            root = Path(temp)
            complete_home(root)
            write(root, (".config", "opencode", "opencode.json"), json.dumps({
                "permission": CANARY,
                "plugin": {},
                "mcp": {},
            }).encode())
            result = inspector.inspect_home(root)
        self.assertEqual(result["opencode"]["permission"], {"allow": "UNKNOWN", "ask": "UNKNOWN", "deny": "UNKNOWN"})
        self.assertNotIn(CANARY.encode(), inspector.render_report(result))

    def test_malformed_json_toml_and_invalid_utf8_hide_parser_details(self):
        cases = [
            ((".claude", "settings.json"), (b'{"x":"' + CANARY.encode()), "claude"),
            ((".codex", "config.toml"), (b'x = "' + CANARY.encode()), "codex"),
            ((".claude", "settings.json"), b"\xff", "claude"),
        ]
        for relative, content, provider in cases:
            with self.subTest(provider=provider, content=content[:1]):
                with tempfile.TemporaryDirectory() as temp:
                    root = Path(temp)
                    complete_home(root)
                    write(root, relative, content)
                    result = inspector.inspect_home(root)
                self.assertEqual(result[provider]["status"], "UNKNOWN")
                self.assertNotIn(CANARY.encode(), inspector.render_report(result))

    def test_duplicate_json_keys_become_unknown_without_values(self):
        with tempfile.TemporaryDirectory() as temp:
            root = Path(temp)
            complete_home(root)
            write(root, (".claude", "settings.json"), b'{"x":"' + CANARY.encode() + b'","x":2}')
            result = inspector.inspect_home(root)
        self.assertEqual(result["claude"], {"status": "UNKNOWN", "reason": "DUPLICATE_KEY"})
        self.assertNotIn(CANARY.encode(), inspector.render_report(result))

    def test_duplicate_toml_keys_become_unknown_without_values(self):
        with tempfile.TemporaryDirectory() as temp:
            root = Path(temp)
            complete_home(root)
            write(root, (".codex", "config.toml"), f'x = "{CANARY}"\nx = 2\n'.encode())
            result = inspector.inspect_home(root)
        self.assertEqual(result["codex"]["status"], "UNKNOWN")
        self.assertNotIn(CANARY.encode(), inspector.render_report(result))

    def test_failure_stops_before_later_provider_reads(self):
        with tempfile.TemporaryDirectory() as temp:
            root = Path(temp)
            write(root, (".claude", "settings.json"), b"not-json")
            write(root, (".codex", "config.toml"), b'approval_policy = "never"')
            with mock.patch.object(inspector, "_read_bounded", wraps=inspector._read_bounded) as read:
                result = inspector.inspect_home(root)
        self.assertEqual(read.call_count, 1)
        self.assertEqual(result["claude"]["status"], "UNKNOWN")
        self.assertEqual(result["codex"], {"status": "UNKNOWN", "reason": "NOT_CHECKED"})
        self.assertEqual(result["opencode"], {"status": "UNKNOWN", "reason": "NOT_CHECKED"})

    def test_mutation_during_read_becomes_unknown(self):
        with tempfile.TemporaryDirectory() as temp:
            root = Path(temp)
            path = write(root, (".claude", "settings.json"), b'{"permissions":{}}')
            real_fstat = inspector.os.fstat
            calls = 0
            def mutate_after_read(fd):
                nonlocal calls
                calls += 1
                if calls == 2:
                    path.write_bytes(b'{"permissions":{"allow":["changed"]}}')
                return real_fstat(fd)
            with mock.patch.object(inspector.os, "fstat", side_effect=mutate_after_read):
                with self.assertRaises(inspector.InspectionError) as caught:
                    inspector._read_bounded(root, (".claude", "settings.json"))
        self.assertEqual(caught.exception.reason, "FILE_CHANGED")

    def test_unexpected_failure_prints_only_fixed_unknown(self):
        class Capture:
            def __init__(self):
                self.buffer = io.BytesIO()
        capture = Capture()
        stderr = io.StringIO()
        gate = "HG-20261024-a1b2c3"
        with mock.patch.object(inspector, "inspect_home", side_effect=RuntimeError(CANARY)):
            with mock.patch.object(sys, "stdout", capture), mock.patch.object(sys, "stderr", stderr):
                self.assertEqual(inspector.main(["--approved-gate", gate]), 0)
        self.assertEqual(capture.buffer.getvalue(), b'{"status":"UNKNOWN","reason":"ACCESS_ERROR"}\n')
        self.assertEqual(stderr.getvalue(), "")
        self.assertNotIn(CANARY, capture.buffer.getvalue().decode())

    def test_invalid_approval_reference_does_not_run_inspection(self):
        for gate in ("not-a-gate", "HG-20261022-b6d048", "HG-20261023-e0fa18"):
            with self.subTest(gate=gate):
                with mock.patch.object(inspector, "inspect_home", side_effect=AssertionError("must not inspect")):
                    with mock.patch.object(sys, "stdout") as stdout:
                        self.assertEqual(inspector.main(["--approved-gate", gate]), 2)
                self.assertTrue(stdout.buffer.write.called)

    def test_extra_cli_argument_is_not_echoed_or_inspected(self):
        class Capture:
            def __init__(self):
                self.buffer = io.BytesIO()
        capture = Capture()
        stderr = io.StringIO()
        canary = "SYNTHETIC_SECRET_CANARY"
        with mock.patch.object(inspector, "inspect_home", side_effect=AssertionError("must not inspect")):
            with mock.patch.object(sys, "stdout", capture), mock.patch.object(sys, "stderr", stderr):
                self.assertEqual(inspector.main(["--approved-gate", "HG-20261024-a1b2c3", canary]), 2)
        self.assertEqual(capture.buffer.getvalue(), b'{"status":"NOT_RUN","reason":"INVALID_APPROVAL_REFERENCE"}\n')
        self.assertEqual(stderr.getvalue(), "")
        self.assertNotIn(canary.encode(), capture.buffer.getvalue())

    def test_renderer_whitelists_fields_and_never_echoes_untrusted_values(self):
        report = {
            "claude": {
                "status": "CLASSIFIED",
                "permissions": {"allow": CANARY, "ask": [], "deny": []},
                "hooks": CANARY,
                "enabledPlugins": "bad",
                "autoMode": True,
                "skipDangerousModePermissionPrompt": False,
                "extra": CANARY,
            },
            "codex": {"status": "CLASSIFIED", "approval_policy": CANARY},
            "opencode": {"status": "UNKNOWN", "reason": "PARSE_ERROR", "raw": CANARY},
            "extra": CANARY,
        }
        rendered = inspector.render_report(report)
        self.assertNotIn(CANARY.encode(), rendered)
        self.assertNotIn(b"extra", rendered)
        self.assertEqual(json.loads(rendered)["claude"]["reason"], "SCHEMA_UNKNOWN")
        self.assertLessEqual(len(rendered), inspector.MAX_OUTPUT_BYTES)


if __name__ == "__main__":
    unittest.main()
