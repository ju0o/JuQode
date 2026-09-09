'use strict';
/* WBS-03 · the facts layer's half of the six Brief answers (`11` F-C1-02, `19` §C1).
 *
 * Produces STRUCTURE, never sentences. Two reasons:
 *   1. `18` is the single source of product copy, and a sentence built in the main process
 *      would be copy that never passed through it.
 *   2. The facts layer answers three of the six questions; the narrative layer (WBS-04) will
 *      answer the others. Keeping both as data means the Brief is composed once, at display.
 *
 * `20` requires `source_ref` whenever confidence is 'confirmed'. Every confirmed answer below
 * names the file or listing it came from — no exceptions, because the chip is a promise.
 */

/* `18` brief.q order — 하는 일 · 주요 기능 · 쓰인 기술 · 폴더가 하는 일 · 실행 방법 · 확인 못한 것.
 * The schema numbers them 1..6 (`20`: `check (q between 1 and 6)`). */
const Q = { WHAT: 1, FEATURES: 2, TECH: 3, FOLDERS: 4, RUN: 5, UNKNOWN: 6 };

/**
 * @param {ReturnType<import('./scan').scan>} scanned
 * @returns {{q:number, kind:string, data:object|null, confidence:'confirmed'|'expected'|'unconfirmed', sourceRef:string|null}[]}
 */
function answers(scanned) {
  const { facts, skipped, failed } = scanned;
  const out = [];
  const unknown = [];

  /* ① 하는 일 · ② 주요 기능 — the narrative layer's questions (WBS-04). Nothing deterministic
   * establishes what a project is FOR, so they stay 확인 못함 rather than being filled in
   * from a README, which states an intention rather than proving one. */
  out.push({ q: Q.WHAT, kind: 'needs-narrative', data: null, confidence: 'unconfirmed', sourceRef: null });
  out.push({ q: Q.FEATURES, kind: 'needs-narrative', data: null, confidence: 'unconfirmed', sourceRef: null });
  unknown.push('what', 'features');

  /* ③ 쓰인 기술 — a manifest is proof. Without one there is nothing to be confident about.
   * `11` F-C1-02 ③ asks two things: which technology, AND what it means in this project. Only
   * the first is deterministic, so the second is recorded as still unanswered. */
  const manifest = facts.manifests[0];
  const lock = facts.lockfiles[0] ?? null;
  if (manifest) {
    out.push({
      q: Q.TECH,
      kind: 'tech',
      data: {
        ecosystems: facts.ecosystems,
        name: manifest.name,
        /* Only from a lockfile. `package.json` proves a SCRIPT exists; it proves nothing
         * about npm vs pnpm vs yarn vs bun, and `19` §C4 lists package-manager detection as
         * 미검증. No lockfile → no claim. */
        packageManager: lock?.pm ?? null,
        deps: manifest.deps.slice(0, 12),
        depCount: manifest.deps.length,
      },
      confidence: 'confirmed',
      sourceRef: lock ? `${manifest.file} · ${lock.file}` : manifest.file,
    });
    unknown.push('tech-meaning');
  } else {
    out.push({ q: Q.TECH, kind: 'no-manifest', data: null, confidence: 'unconfirmed', sourceRef: null });
    unknown.push('tech');
  }

  /* ④ 폴더가 하는 일 — the QUESTION is the role, and the role is inference. What the scan
   * establishes is that these folders exist and what they are named; a 확인됨 chip on this row
   * would certify an answer to a question nothing has answered (D-114, `19` §C1 ②: 답이 없으면
   * 확인 못함). The listing is carried as context under a 확인 못함 chip until WBS-04 supplies
   * the roles — which will then be 예상됨, not 확인됨. See CANON_FINDINGS CF-7. */
  out.push({
    q: Q.FOLDERS,
    kind: facts.topDirs.length ? 'folders-listed' : 'no-folders',
    data: facts.topDirs.length ? { dirs: facts.topDirs, listedFrom: 'tree:1' } : null,
    confidence: 'unconfirmed', sourceRef: null,
  });
  unknown.push(facts.topDirs.length ? 'folder-roles' : 'folders');

  /* ⑤ 실행 방법 — only from scripts the project itself declares. If it declares none, the way
   * to run it is not known, and inventing one is exactly what `19` §C4 forbids elsewhere. */
  const runnable = facts.scripts.filter((s) => ['dev', 'start', 'serve', 'build', 'test'].includes(s.name));
  if (runnable.length) {
    out.push({
      q: Q.RUN, kind: 'run',
      data: {
        pm: lock?.pm ?? null,
        scripts: runnable.map((s) => ({
          name: s.name, body: s.body,
          /* With no lockfile the runner is unknown, so the script NAME is all we can state. */
          command: lock ? `${lock.pm} run ${s.name}` : null,
        })),
      },
      confidence: 'confirmed',
      sourceRef: lock ? `${runnable[0].source} · ${lock.file}` : runnable[0].source,
    });
  } else {
    out.push({ q: Q.RUN, kind: 'no-scripts', data: null, confidence: 'unconfirmed', sourceRef: null });
    unknown.push('run');
  }

  /* ⑥ 확인 못한 것 — a statement about this scan, so the scan is its source. It names what the
   * budget cut off, because `19` §C1 ③ says a skipped part is reported, not dropped. */
  out.push({
    q: Q.UNKNOWN, kind: 'unknown', confidence: 'confirmed', sourceRef: 'scan',
    data: {
      questions: unknown,
      skippedFiles: skipped?.files ?? 0,
      /* Only directories the OS refused. A folder on the permanent exclusion list was never
       * going to be read, so calling it a gap would inflate this answer with a non-gap. */
      unreadableDirs: skipped?.unreadableDirs ?? [],
      /* Real content the depth cap chose not to look at. It used to vanish with no report at
       * all, which made the header's "never silently dropped" untrue. */
      depthLimited: skipped?.depthLimited ?? [],
      excludedDirs: facts.excludedDirs ?? [],
      readCount: scanned.readFiles.length,
      readBytes: scanned.readBytes ?? 0,
      fileCount: facts.fileCount ?? 0,
      scanFailed: failed ?? null,
    },
  });

  return out;
}

/** interpreted · partial · failed — `11` F-C1-02 Visible States. 부분 해석 is not a failure.
 *  The earlier form exempted q6 from the check. q6 is always confirmed, so the exemption never
 *  changed an answer — dead code that read like a rule. */
function statusOf(scanned, list) {
  if (scanned.failed) return 'failed';
  return list.some((a) => a.confidence !== 'confirmed') ? 'partial' : 'interpreted';
}

module.exports = { answers, statusOf, Q };
