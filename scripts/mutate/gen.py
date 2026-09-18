"""Enumerate mutation sites in one file, on the CODE — comments stripped by the repo's own lexer.

Mutating a comment is not a test of anything, and this run wasted four separate detours on it:
`setInterval` inside presence.js's own comment, `declared` in nextaction.js, `app.getPath` in
main.js, `history.more` in prose. `tests/src.js` owns the lexer (strings, templates, regex
literals) and is the single answer to "what is code here".

    python3 scripts/mutate/gen.py app/renderer/screens/sc02.js   -> JSON array of sites
"""
import sys, json, subprocess, os

REPO = os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
rel = sys.argv[1]
src = open(os.path.join(REPO, rel), encoding='utf-8').read()
code = subprocess.run(
  ['node', '-e',
   "const {strip}=require(process.argv[1]);"
   "process.stdout.write(strip(require('fs').readFileSync(process.argv[2],'utf8')))",
   os.path.join(REPO, 'tests/src.js'), os.path.join(REPO, rel)],
  capture_output=True, text=True, check=True).stdout

OPS = [
  ('===', '!=='), ('!==', '==='),
  (' && ', ' || '), (' || ', ' && '),
  (' > ', ' >= '), (' < ', ' <= '), (' >= ', ' > '), (' <= ', ' < '),
  ('.length > 0', '.length >= 0'),
  ('return null;', 'return {};'),
  ('return false;', 'return true;'), ('return true;', 'return false;'),
]

# A site is addressed by its surrounding CONTEXT, not by an offset: the offset would be into the
# comment-stripped code and the patch has to land in the real file. A context that is not unique
# is skipped rather than guessed at.
sites, seen = [], set()
for old, new in OPS:
    start = 0
    while True:
        i = code.find(old, start)
        if i == -1: break
        start = i + 1
        ctx = code[max(0, i - 45):i + len(old) + 45]
        if src.count(ctx) != 1 or ctx in seen: continue
        seen.add(ctx)
        sites.append({'rel': rel, 'ctx': ctx, 'old': old, 'new': new, 'at': ctx.find(old)})
print(json.dumps(sites))
