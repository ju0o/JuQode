/* A Task draft is a proposal, not an observation.
 *
 * The sentence the person typed becomes the goal. One acceptance line is suggested
 * from those same words. Nothing here claims the change already happened, that a
 * test passed, or that the Agent will succeed. */

export function proposeDraft(sentence) {
  if (typeof sentence !== 'string') return null;
  const goal = sentence.replace(/\s+/g, ' ').trim();
  if (!goal) return null;
  const alreadyCheckable = /(?:한다|됩니다|된다|돼요|보여\s*준다|보여요|남긴다|남아요)\s*$/.test(goal);
  return {
    goal,
    criteria: [alreadyCheckable ? goal : `「${goal}」가 실제로 된다`],
    proposal: true,
  };
}

/* Compare two finished attempts without ranking them.
 * Missing context or missing file evidence stays unknown. An empty observed
 * file list is a real observation and may be "same". An unobserved list is not. */
export function compareRuns(newer, older) {
  if (!newer || !older || newer === older) return null;
  const context = (left, right) => {
    if (typeof left !== 'string' || typeof right !== 'string' || !left || !right) return 'unknown';
    return left === right ? 'same' : 'different';
  };
  const files = (run) => {
    if (run.filesObserved !== true) return null;
    const list = Array.isArray(run.changedFiles) ? run.changedFiles.filter((item) => typeof item === 'string') : [];
    return [...new Set(list)].sort();
  };
  const left = files(newer);
  const right = files(older);
  let fileRelation = 'unknown';
  let addedFiles = [];
  let removedFiles = [];
  if (left && right) {
    addedFiles = left.filter((file) => !right.includes(file));
    removedFiles = right.filter((file) => !left.includes(file));
    fileRelation = addedFiles.length === 0 && removedFiles.length === 0 ? 'same' : 'different';
  }
  return {
    context: context(newer.contextDigest, older.contextDigest),
    files: fileRelation,
    addedFiles,
    removedFiles,
    outcomeNewer: newer.outcome ?? null,
    outcomeOlder: older.outcome ?? null,
  };
}
