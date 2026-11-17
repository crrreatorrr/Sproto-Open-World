import { BLOCK, CHARGE, PLAYER_MOVES, ROLL, clipTiming, type PlayerMoveId } from '../content/combat';
import type { Entity } from '../sim/entity';

/**
 * The frame-data timeline for the debug overlay (plan §8): the current action's startup, active,
 * recovery and cancel markers against its clock, plus the buffer, i-frames, parry window and
 * hit-stop. One character per tick, so a press can be read off against the bar.
 *
 *   S startup   A active   r recovery (no cancel)   c cancellable   ^ now
 */
export function frameDataLines(e: Readonly<Entity> | undefined): string[] {
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
      lines.push(`active [${tm.activeStart},${tm.activeEnd})   dodge ≥${tm.activeEnd}   combo ≥${tm.cancel}   end ${tm.end}${def.hyperArmorFrom !== undefined ? `   armor ≥${def.hyperArmorFrom}` : ''}   hits ${a.hit.length}`);
    } else lines.push(`action: attack ${a.move} t ${a.t}`);
  } else if (a.kind === 'dodge') {
    const bar: string[] = [];
    for (let t = 0; t < ROLL.ticks; t++) bar.push(t >= ROLL.iframeStart && t <= ROLL.perfectEnd ? 'P' : t >= ROLL.iframeStart && t <= ROLL.iframeEnd ? 'I' : t >= ROLL.attackFrom ? 'c' : '-');
    const inv = a.t >= ROLL.iframeStart && a.t <= ROLL.iframeEnd;
    lines.push(`action: dodge   t ${a.t}/${ROLL.ticks}   ${inv ? (a.t <= ROLL.perfectEnd ? 'I-FRAMES (perfect)' : 'I-FRAMES') : 'vulnerable'}`);
    lines.push(`|${bar.join('')}|`, ` ${' '.repeat(Math.min(ROLL.ticks, a.t))}^`);
    lines.push(`P perfect [${ROLL.iframeStart},${ROLL.perfectEnd}]   I i-frames ≤${ROLL.iframeEnd}   c roll attack ≥${ROLL.attackFrom}`);
  } else if (a.kind === 'block') {
    const parry = Math.max(0, a.parryTicks - a.t);
    lines.push(`action: block   t ${a.t}   ${parry > 0 ? `PARRY window ${parry} left (of ${a.parryTicks})` : 'guarding'}   raised ≥${BLOCK.raised}`);
  } else if (a.kind === 'hitstun' || a.kind === 'stagger') {
    lines.push(`action: ${a.kind}${a.kind === 'hitstun' && a.knockdown ? ' (knockdown)' : ''}   t ${a.t}/${a.dur}`);
  } else lines.push(`action: dead   t ${a.t}`);
  lines.push(status.join('   '));
  return lines;
}
