#!/usr/bin/env node
/* Read-only, pinned, sparse checkout of the Private Canon files the tests compare against.
 *
 *   node scripts/canon-checkout.mjs --out <dir> [--pin tests/canon.pin.json] [--url <git url or path>]
 *   then:  JUQODE_PRIVATE=<dir>/JuQode-Private npm test
 *
 * - Uses whatever Git access the host ALREADY has (gh / credential helper). It never logs in, never
 *   writes global or system Git config, never prompts (GIT_TERMINAL_PROMPT=0), and sets the repo-local
 *   sparse-checkout only inside <dir>.
 * - Fetches exactly the pinned commit (`git fetch --depth 1 origin <sha>`), checks out only the pinned
 *   paths, then verifies: HEAD == pin.sha, each file's git blob id and sha256 == the pin.
 * - On ANY mismatch it removes what it created and exits 1: a half-trusted Canon is worse than none.
 * - Prints a manifest (sha, blob ids, sha256). Canon text is never printed, copied elsewhere or committed. */
import { spawnSync } from 'node:child_process';
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';

const args = Object.fromEntries(process.argv.slice(2).reduce((a, v, i, all) => (v.startsWith('--') ? [...a, [v.slice(2), all[i + 1]]] : a), []));
const fail = (msg) => { console.error(`canon-checkout: ${msg}`); process.exit(1); };
if (!args.out) fail('--out <dir> is required');

const pinPath = path.resolve(args.pin ?? new URL('../tests/canon.pin.json', import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1'));
const pin = JSON.parse(fs.readFileSync(pinPath, 'utf8'));
if (!/^[0-9a-f]{40}$/.test(pin.sha ?? '')) fail('the pin has no 40-hex commit sha');
const url = args.url ?? `https://github.com/${pin.repo}.git`;
const dest = path.join(path.resolve(args.out), 'JuQode-Private');
if (fs.existsSync(dest)) fail(`${dest} already exists; refusing to reuse an unverified directory`);

const env = { ...process.env, GIT_TERMINAL_PROMPT: '0' };
const git = (cwd, ...a) => spawnSync('git', a, { cwd, env, encoding: 'utf8' });
const must = (cwd, ...a) => {
  const r = git(cwd, ...a);
  if (r.status !== 0) throw new Error(`git ${a.join(' ')} failed: ${(r.stderr || r.stdout || '').trim().slice(0, 300)}`);
  return r.stdout.trim();
};

try {
  fs.mkdirSync(dest, { recursive: true });
  must(dest, 'init', '-q');
  must(dest, 'remote', 'add', 'origin', url);
  must(dest, 'sparse-checkout', 'init', '--no-cone');
  must(dest, 'sparse-checkout', 'set', ...Object.keys(pin.files));
  /* protocol v2 (a per-command option, nothing is written to any config) lets a server serve an exact reachable commit */
  must(dest, '-c', 'protocol.version=2', 'fetch', '-q', '--depth', '1', 'origin', pin.sha);
  must(dest, 'checkout', '-q', '--detach', 'FETCH_HEAD');

  const head = must(dest, 'rev-parse', 'HEAD');
  if (head !== pin.sha) throw new Error(`HEAD ${head} != pinned ${pin.sha}`);
  const manifest = { repo: pin.repo, sha: head, files: {} };
  for (const [file, want] of Object.entries(pin.files)) {
    const blob = must(dest, 'rev-parse', `HEAD:${file}`);
    const sha256 = crypto.createHash('sha256').update(fs.readFileSync(path.join(dest, file))).digest('hex');
    if (blob !== want.blob) throw new Error(`${file}: blob ${blob} != pinned ${want.blob}`);
    if (sha256 !== want.sha256) throw new Error(`${file}: sha256 ${sha256} != pinned ${want.sha256}`);
    manifest.files[file] = { blob, sha256 };
  }
  console.log(JSON.stringify(manifest, null, 2));
  console.error(`canon-checkout: ok -> JUQODE_PRIVATE=${dest}`);
} catch (e) {
  fs.rmSync(dest, { recursive: true, force: true });
  fail(e.message);
}
