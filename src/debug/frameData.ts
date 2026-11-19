import { BLOCK, CHARGE, PLAYER_MOVES, clipTiming, type PlayerMoveId } from '../content/combat';
import { PLUNGE, dodgeFrames } from '../content/packs/m7';
import { SPELLS, WOVEN, type SpellId } from '../content/spells';
import type { Entity } from '../sim/entity';

/**
 * The frame-data timeline for the debug overlay (plan §8): the current action's startup, active,
 * recovery and cancel markers against its clock, plus the buffer, i-frames, parry window and
 * hit-stop. One character per tick, so a press can be read off against the bar.
 *
 *   S startup   A active   r recovery (no cancel)   c cancellable   ^ now
 *
 * A cast shows its wind-up (w when woven), the release tick R and its recovery, then the spell
 * cooldowns and whether the woven window is open. `now` is the sim tick.
 */
export function frameDataLines(e: Readonly<Entity> | undefined, now = 0): string[] {
  const c = e?.combat;
  if (!c) return ['combat: (no combat state)'];
  const a = c.action;
  const lines: string[] = [];
  const b = c.buffer;
  const status = [
    `hit-stop ${c.hitstop}`,
    `buffer ${b ? `${b.action} ${b.untilCancel ? 'until cancel' : `ttl ${b.ttl}`}` : '—'}`,
    `lock ${c.lock ?? '—'}`,
    c.critNext ? 'crit next' : '',
  ].filter(Boolean);
  if (!a) {
    lines.push('action: free (locomotion)');
  } else if (a.kind === 'attack') {
    const def = PLAYER_MOVES[a.move as PlayerMoveId];
    if (def) {
      const tm = clipTiming(def.clip);
      const bar: string[] = [];
      for (let t = 0; t < tm.end; t++) {
        let ch = t < tm.activeStart ? 'S' : t < tm.activeEnd ? 'A' : t < tm.cancel ? 'r' : 'c';
        if (t < def.entry) ch = ' ';
        if (tm.chargeStart !== undefined && t >= tm.chargeStart && t < tm.chargeEnd && def.chargeable) ch = ch === 'S' ? 'h' : ch;
        bar.push(ch);
      }
      const cursor = ' '.repeat(Math.max(0, Math.min(tm.end, a.clipT))) + '^';
      const charge = def.chargeable ? `   charge [${tm.chargeStart},${tm.chargeEnd}) held ${a.charge}/${CHARGE.full}${a.charging ? ' charging' : ''}${a.charged ? ' CHARGED' : ''}` : '';
      lines.push(`action: ${a.move} (${def.clip})   t ${a.t}   clip ${a.clipT}/${tm.end}${charge}`);
      lines.push(`|${bar.join('')}|`, ` ${cursor}`);
      lines.push(`active [${tm.activeStart},${tm.activeEnd})   dodge ≥${tm.activeEnd}${def.whiffLock && !a.connected ? ` (whiff +${def.whiffLock})` : ''}   combo ≥${tm.cancel}   end ${tm.end}${def.hyperArmorFrom !== undefined ? `   armor ≥${def.hyperArmorFrom}` : ''}   hits ${a.hit.length}`);
    } else lines.push(`action: attack ${a.move} t ${a.t}`);
  } else if (a.kind === 'dodge') {
    const f = dodgeFrames(a);
    const bar: string[] = [];
    for (let t = 0; t < f.ticks; t++) bar.push(t >= f.iframeStart && t <= f.perfectEnd ? 'P' : t >= f.iframeStart && t <= f.iframeEnd ? 'I' : t >= f.attackFrom ? 'c' : '-');
    const inv = a.t >= f.iframeStart && a.t <= f.iframeEnd;
    lines.push(`action: ${a.back ? 'backstep' : 'dodge'}   t ${a.t}/${f.ticks}   ${inv ? (a.t <= f.perfectEnd ? 'I-FRAMES (perfect)' : 'I-FRAMES') : 'vulnerable'}`);
    lines.push(`|${bar.join('')}|`, ` ${' '.repeat(Math.min(f.ticks, a.t))}^`);
    lines.push(`P perfect [${f.iframeStart},${f.perfectEnd}]   I i-frames ≤${f.iframeEnd}   c roll attack ≥${f.attackFrom}`);
  } else if (a.kind === 'plunge') {
    lines.push(a.landT < 0 ? `action: plunge   diving   t ${a.t}   from y ${a.fromY.toFixed(1)}` : `action: plunge   recovery ${a.landT}/${PLUNGE.recovery}   cancel ≥${PLUNGE.cancelFrom}`);
  } else if (a.kind === 'block') {
    const parry = Math.max(0, a.parryTicks - a.t);
    lines.push(`action: block   t ${a.t}   ${parry > 0 ? `PARRY window ${parry} left (of ${a.parryTicks})` : 'guarding'}   raised ≥${BLOCK.raised}`);
  } else if (a.kind === 'cast') {
    const def = SPELLS[a.spell];
    const end = a.release + def.recovery;
    const bar: string[] = [];
    for (let t = 0; t < end; t++) bar.push(t < a.release ? (a.woven ? 'w' : 'S') : t === a.release ? 'R' : 'r');
    lines.push(`action: cast ${a.spell} (${def.clip})   t ${a.t}/${end}   release ${a.release}${a.woven ? ' WOVEN' : ''}${a.released ? '   released' : ''}`);
    lines.push(`|${bar.join('')}|`, ` ${' '.repeat(Math.max(0, Math.min(end, a.t)))}^`);
  } else if (a.kind === 'hitstun' || a.kind === 'stagger' || a.kind === 'frozen') {
    lines.push(`action: ${a.kind}${a.kind === 'hitstun' && a.knockdown ? ' (knockdown)' : ''}   t ${a.t}/${a.dur}`);
  } else lines.push(`action: dead   t ${a.t}`);
  lines.push(status.join('   '));
  const cds = (Object.keys(SPELLS) as SpellId[]).map((id) => `${id} ${c.cooldowns?.[id] ?? 0}`).join('  ');
  const since = now - (c.lastHitTick ?? -Infinity);
  lines.push(`cooldowns ${cds}   woven ${since <= WOVEN.window ? `open (${WOVEN.window - since} left)` : 'closed'}`);
  return lines;
}

/** The locked target's action and active statuses (plan §4.7), for the debug overlay. */
export function targetLines(t: Readonly<Entity> | undefined): string[] {
  if (!t) return ['target: —'];
  const a = t.combat?.action;
  const act = !a ? 'free' : a.kind === 'attack' ? `attack ${a.move} t ${a.t}` : 'dur' in a ? `${a.kind} t ${a.t}/${a.dur}` : `${a.kind} t ${a.t}`;
  const s = t.statuses;
  const parts: string[] = [];
  if (s?.burn) parts.push(`burn ${s.burn.ticks}t (${s.burn.perTick.toFixed(2)} hp/t)`);
  if (s?.chill) parts.push(`chill ×${s.chill.stacks} ${s.chill.ticks}t`);
  if (s?.shock) parts.push(`shock ${s.shock.ticks}t`);
  if (a?.kind === 'frozen') parts.push(`FROZEN ${a.dur - a.t}t`);
  return [
    `target #${t.id} ${t.brain?.def ?? t.view.model}   hp ${t.vitals?.hp.toFixed(0) ?? '?'}/${t.vitals?.hpMax ?? '?'}   poise ${t.combat?.poise.toFixed(0) ?? '?'}   ${act}`,
    `statuses: ${parts.length ? parts.join('   ') : 'none'}`,
  ];
}
