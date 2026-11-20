import fs from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

/**
 * M3 acceptance 4 (plan §2.2 "commands carry intents, not effects"): every gameplay mutation goes
 * through a command. A static check over the client folders (render, ui, app, camera, input, and
 * audio / world / debug / main.ts for good measure), comments stripped:
 *  - no writes to sim entity or world state (`.progress.x =`, `.vitals.hp -=`, `.combat = …`,
 *    `.world.flags[k] = …`, `push` into sim arrays, `delete` of sim fields);
 *  - SimWorld is driven only through its lifecycle / streaming / save / read API (tick, loadCell,
 *    unloadCell, populate*, startWaves, toSave, applySave, spawnPlayer, teleportPlayer — the
 *    dev-only QA teleport and respawn placement — view, dispose, plus read-only queries);
 *  - nothing imports the sim's systems (rpg, combat, ai) or physics to call them directly.
 */
const SRC = path.resolve(__dirname, '../../src');
const CLIENT = ['render', 'ui', 'app', 'camera', 'input', 'audio', 'world', 'debug'];

function files(dir: string): string[] {
  if (!fs.existsSync(dir)) return [];
  return fs.readdirSync(dir, { withFileTypes: true }).flatMap((e) => {
    const p = path.join(dir, e.name);
    return e.isDirectory() ? files(p) : /\.(ts|tsx)$/.test(e.name) ? [p] : [];
  });
}
const rel = (f: string) => path.relative(SRC, f).split(path.sep).join('/');
/** Source with comments removed (string contents kept: a rule in a comment doesn't trip it). */
const code = (f: string) => fs.readFileSync(f, 'utf8').replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:'"`])\/\/.*$/gm, '$1');
const client = CLIENT.flatMap((d) => files(path.join(SRC, d))).concat(fs.existsSync(path.join(SRC, 'main.ts')) ? [path.join(SRC, 'main.ts')] : []);

/** Line number of a match, for the failure message. */
const lineOf = (src: string, index: number) => src.slice(0, index).split('\n').length;

/** Sim-state fields on an entity (sim/entity.ts) and on the world. */
const ENTITY_FIELDS = 'progress|vitals|combat|brain|statuses|interactable|pickup|npc|loco|projectile';
const TF_FIELDS = 'pos|prevPos|vel|yaw|prevYaw';
const ASSIGN = String.raw`\s*(?:=(?![=>])|[+\-*/%]=|\+\+|--|\|\|=|&&=|\?\?=)`;
const PATH = String.raw`(?:[!?]*\.[\w$]+|[!?]*\[[^\]\n]*\])*`;
const WRITE_RULES: [string, RegExp][] = [
  ['entity state assignment', new RegExp(String.raw`\.(?:${ENTITY_FIELDS})\b${PATH}${ASSIGN}`, 'g')],
  ['transform assignment', new RegExp(String.raw`\.tf\.(?:${TF_FIELDS})\b${PATH}${ASSIGN}`, 'g')],
  ['world state assignment', new RegExp(String.raw`\.world\.(?:flags|openedChests|killedUniques)\b${PATH}${ASSIGN}`, 'g')],
  ['sim array mutation', new RegExp(String.raw`\.(?:progress|world|combat|vitals|statuses)\b${PATH}\.(?:push|pop|shift|unshift|splice|sort|reverse|fill|copyWithin)\(`, 'g')],
  ['delete of sim state', new RegExp(String.raw`\bdelete\s+[\w$.!?\[\]'"]*\.(?:${ENTITY_FIELDS}|statuses|flags|inventory|quests)\b`, 'g')],
  ['entities list mutation', /\.entities\.(?:push|pop|shift|unshift|splice|sort|reverse|length\s*=)/g],
];

/** SimWorld members a client may use: lifecycle, streaming, save, the dev teleport, and reads. */
const ALLOWED_SIM = new Set([
  'tick', 'loadCell', 'unloadCell', 'populate', 'populateWorld', 'startWaves', 'startDungeon', 'toSave', 'applySave', 'spawnPlayer', 'teleportPlayer', 'view', 'dispose',
  // read-only
  'now', 'entities', 'events', 'get', 'playerEntity', 'hash', 'cellReady', 'cellAnchors', 'waitingForGround', 'world', 'wave', 'locate', 'level', 'seed', 'streamed', 'gunRuntime', 'gunEvents', 'dungeonEvents',
]);

describe('every gameplay mutation goes through a command (M3 acceptance 4)', () => {
  it('scans a real client tree', () => {
    expect(client.length).toBeGreaterThan(10);
    expect(client.some((f) => rel(f) === 'app/App.ts')).toBe(true);
  });

  it('the client never writes sim entity or world state', () => {
    const found: string[] = [];
    for (const f of client) {
      const src = code(f);
      for (const [name, re] of WRITE_RULES) for (const m of src.matchAll(re)) found.push(`${rel(f)}:${lineOf(src, m.index!)} ${name}: ${m[0].trim()}`);
    }
    expect(found).toEqual([]);
  });

  it('SimWorld is used only through its lifecycle, streaming, save and read API', () => {
    const found: string[] = [];
    const seen = new Set<string>();
    for (const f of client) {
      const src = code(f);
      // Names bound to a SimWorld in this file: `sim`, plus `x: SimWorld` / `new SimWorld(` bindings.
      const names = new Set(['sim']);
      for (const m of src.matchAll(/\b([\w$]+)\s*[?!]?:\s*SimWorld\b/g)) names.add(m[1]);
      for (const m of src.matchAll(/\b([\w$]+)\s*=\s*new\s+SimWorld\b/g)) names.add(m[1]);
      for (const n of names) {
        const re = new RegExp(String.raw`(?:\bthis\.|(?<![\w$.]))${n.replace(/\$/g, '\\$')}\s*[!?]?\s*\??\.\s*([\w$]+)`, 'g');
        for (const m of src.matchAll(re)) {
          seen.add(m[1]);
          if (!ALLOWED_SIM.has(m[1])) found.push(`${rel(f)}:${lineOf(src, m.index!)} ${m[0]}`);
        }
      }
    }
    expect(found).toEqual([]);
    // Not vacuous: the scan does see the app driving the sim.
    expect(seen.has('tick')).toBe(true);
    expect(seen.has('spawnPlayer')).toBe(true);
  });

  it('the client reaches no sim internals: no physics access through the sim, no system / combat / ai imports, no restore', () => {
    const found: string[] = [];
    for (const f of client) {
      const src = code(f);
      for (const m of src.matchAll(/\bsim\s*[!?]?\s*\??\.\s*physics\b/g)) found.push(`${rel(f)}:${lineOf(src, m.index!)} ${m[0]}`);
      for (const m of src.matchAll(/\.restore\(\s*[\w$]*[Ss]nap/g)) found.push(`${rel(f)}:${lineOf(src, m.index!)} ${m[0]}`);
      for (const m of src.matchAll(/\bfrom\s+['"]([^'"]+)['"]/g)) {
        const imp = m[1];
        if (!imp.startsWith('.')) continue;
        const target = rel(path.resolve(path.dirname(f), imp));
        if (/^sim\/(systems|combat|ai)\//.test(target)) found.push(`${rel(f)} imports ${target}`);
      }
    }
    expect(found).toEqual([]);
  });

  it('the rules catch what they are meant to catch (self-test on snippets)', () => {
    const hits = (s: string) => WRITE_RULES.filter(([, re]) => new RegExp(re.source, 'g').test(s)).map(([n]) => n);
    expect(hits('p.progress.sprouts = 999;')).toEqual(['entity state assignment']);
    expect(hits('e.vitals!.hp -= 5;')).toEqual(['entity state assignment']);
    expect(hits('sim.playerEntity(0)!.progress!.points++;')).toEqual(['entity state assignment']);
    expect(hits('player.progress?.inventory["staff_nobu"] = 1;')).toEqual(['entity state assignment']);
    expect(hits('e.combat.action = null;')).toEqual(['entity state assignment']);
    expect(hits('e.tf.pos.x += 2;')).toEqual(['transform assignment']);
    expect(hits("view.world.flags['gate'] = 1;")).toEqual(['world state assignment']);
    expect(hits('p.progress.spells.push("blast");')).toEqual(['sim array mutation']);
    expect(hits('delete e.statuses;')).toEqual(['delete of sim state']);
    // Reads and comparisons are fine.
    expect(hits('const hp = e.vitals.hp; if (e.vitals.hp === 0 || e.vitals!.hp != 1 || e.combat.action !== null) {}')).toEqual([]);
    expect(hits('const n = p.progress.spells.slice().length; const f = (x = e.vitals) => x;')).toEqual([]);
    expect(hits('mesh.position.x = e.tf.pos.x; const t = p.progress?.tracked ?? null;')).toEqual([]);
    expect(hits('this.progressBar = 1; el.style.width = `${e.vitals.hp}%`;')).toEqual([]);
  });
});
