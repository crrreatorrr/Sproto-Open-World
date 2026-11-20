// Bundle the pure Free/Wager 1v1 PvP sim (Sim v3, no Second Wind) for Nakama Goja ES2020.
// Enforces 100% purity: zero Rapier, zero Three.js, zero DOM, zero Math.random, zero timers.

import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import vm from 'node:vm';
import * as esbuild from 'esbuild';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const PLACEHOLDER = '0000000000000000000000000000000000000000';

/** Only these pure source paths may enter the Goja PvP bundle. */
export const ALLOWED_INPUT_PREFIXES = [
  'src/sim/pvp/',
  'src/net/pvpProtocol.ts',
];

const BANNED_OUTPUT_PATTERNS = [
  /\bMath\.random\b/,
  /\bDate\.now\b/,
  /\bperformance\.now\b/,
  /\bwindow\./,
  /\bdocument\./,
  /\blocalStorage\b/,
  /\bsetTimeout\b/,
  /\bsetInterval\b/,
  /\brequestAnimationFrame\b/,
  /@dimforge/,
  /\brapier3d\b/i,
];

function git(args) {
  return execFileSync('git', args, { cwd: root, encoding: 'utf8' }).trim();
}

export function simCommit() {
  const forced = process.env.SHOOTER_SIM_COMMIT || '';
  if (forced) {
    if (!/^[0-9a-f]{40}$/.test(forced)) throw new Error('SHOOTER_SIM_COMMIT must be a 40-hex commit');
    return forced;
  }
  try {
    return git(['rev-parse', 'HEAD']);
  } catch {
    return PLACEHOLDER;
  }
}

function inputsOutsideAllowed(metafile) {
  return Object.keys(metafile.inputs).filter(
    (file) => !ALLOWED_INPUT_PREFIXES.some((prefix) => file === prefix || file.startsWith(prefix)),
  );
}

function contentHashOf(metafile) {
  const hash = createHash('sha256');
  for (const file of Object.keys(metafile.inputs).sort()) {
    hash.update(`${file}\0`);
    hash.update(fs.readFileSync(path.join(root, file)));
    hash.update('\0');
  }
  return hash.digest('hex');
}

function stripComments(src) {
  return src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:])\/\/.*$/gm, '$1');
}

function assertPureOutput(src, outfile) {
  const stripped = stripComments(src);
  for (const re of BANNED_OUTPUT_PATTERNS) {
    if (re.test(stripped)) {
      throw new Error(`${outfile} failed purity check: matched ${re}`);
    }
  }
}

function evaluateGojaSandbox(src) {
  const sandbox = {};
  sandbox.globalThis = sandbox;
  const ctx = vm.createContext(sandbox);
  vm.runInContext(src, ctx, { filename: 'shooter-pvp-sim.js' });
  const api = sandbox.SprotoShooterPvp;
  if (!api || typeof api.createMatch !== 'function' || typeof api.stepMatch !== 'function') {
    throw new Error('Built bundle did not expose globalThis.SprotoShooterPvp API');
  }
  return api;
}

export async function buildPvpBundle(outDir = path.join(root, 'build')) {
  fs.mkdirSync(outDir, { recursive: true });
  const outfile = path.join(outDir, 'shooter-pvp-sim.js');
  const commit = simCommit();

  const result = await esbuild.build({
    metafile: true,
    absWorkingDir: root,
    entryPoints: ['src/sim/pvp/export.ts'],
    bundle: true,
    format: 'iife',
    globalName: 'SprotoShooterPvp',
    platform: 'neutral',
    target: 'es2020',
    outfile,
    legalComments: 'none',
    footer: { js: 'globalThis.SprotoShooterPvp = SprotoShooterPvp;' },
  });

  const disallowed = inputsOutsideAllowed(result.metafile);
  if (disallowed.length > 0) {
    throw new Error(`PvP bundle pulled disallowed inputs: ${disallowed.join(', ')}`);
  }

  let src = fs.readFileSync(outfile, 'utf8');
  if (!src.includes(PLACEHOLDER)) {
    throw new Error(`SOURCE_COMMIT placeholder missing from ${outfile}`);
  }
  src = src.split(PLACEHOLDER).join(commit);
  assertPureOutput(src, outfile);
  fs.writeFileSync(outfile, src);

  // Verify the IIFE executes cleanly in a bare ES2020 sandbox (no DOM, no Node globals).
  const api = evaluateGojaSandbox(src);

  const bundleSha256 = createHash('sha256').update(src).digest('hex');
  const sourceContentHash = contentHashOf(result.metafile);

  const pin = {
    artifact: 'shooter-pvp',
    game: api.rules.GAME_ID,
    protocol: api.PVP_PROTOCOL_VERSION,
    sim: api.PVP_SIM_VERSION,
    secondWind: false,
    contentFingerprint: api.CONTENT_FINGERPRINT,
    loadoutHash: api.LOADOUT_HASH,
    global: 'SprotoShooterPvp',
    sourceCommit: commit,
    sourceContentHash,
    bundlePath: 'build/shooter-pvp-sim.js',
    bundleBytes: Buffer.byteLength(src),
    bundleSha256,
    tickHz: api.TICK_HZ,
    matchSeconds: api.MATCH_SECONDS,
    matchTicks: api.MATCH_TICKS,
    leadInTicks: api.LEAD_IN_TICKS,
    rewind: api.REWIND,
    wager: api.WAGER,
    stockLoadout: api.STOCK_LOADOUT,
    limits: api.INPUT_LIMITS,
    matchmakerQueryFree: api.buildMatchmakerQuery('free', api.CONTENT_FINGERPRINT),
    matchmakerQueryWager: api.buildMatchmakerQuery('wager', api.CONTENT_FINGERPRINT),
  };

  const pinPath = path.join(outDir, 'shooter-pvp-sim.pin.json');
  fs.writeFileSync(pinPath, `${JSON.stringify(pin, null, 2)}\n`);
  return { outfile, pinPath, pin };
}

const isMain = process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (isMain) {
  const { outfile, pinPath, pin } = await buildPvpBundle();
  process.stdout.write(`${outfile}\n${pinPath}\nsha256=${pin.bundleSha256}\ncontent=${pin.contentFingerprint}\nsim=${pin.sim}\n`);
}
