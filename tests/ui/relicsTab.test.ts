import { describe, expect, it } from 'vitest';
import { KEEPSAKES } from '../../src/content/relics';
import { newProgress } from '../../src/sim/systems/rpg';
import { KEEPSAKE_ICONS } from '../../src/ui/icons';
import { pressCard, relicKey, relicPad, relicsModel } from '../../src/ui/relicsTab';

describe('relics tab', () => {
  it('hides keepsakes from quests the player has not seen, and silhouettes the rest', () => {
    const p = newProgress(['bolt']);
    p.relics!.owned = ['totem_elders_hearth'];
    const seen = (q: string) => q === 'q_wake_up' || q === 'q_watchtower';
    const model = relicsModel(p, seen, false, null);
    expect(model.found).toBe(1);
    expect(model.cards.map((c) => c.id)).toEqual(['relic_drowned_coins', 'totem_elders_hearth']);
    const coins = model.cards[0];
    expect(coins.name).toBe('????');
    expect(coins.locked).toBe(true);
    expect(coins.clue).toContain('bell');
    expect(model.cards[1].name).toBe("Elder's Hearth");
    expect(model.cards[1].equipped).toBe(false);
  });

  it('equips into an empty socket, then asks for a replacement when all three are full', () => {
    const p = newProgress(['bolt']);
    p.relics!.owned = ['relic_drowned_coins', 'relic_gatekeepers_grip', 'relic_hopeglass', 'relic_drakeplume'];
    p.relics!.sockets = ['relic_drowned_coins', 'relic_gatekeepers_grip', 'relic_hopeglass'];
    const open = pressCard(p, 'relic_drakeplume', false, null);
    expect(open.replace).toBe(true);
    expect(open.action).toBeNull();
    const placed = pressCard(p, 'relic_drakeplume', false, 1);
    expect(placed.action).toEqual({ kind: 'equipRelic', item: 'relic_drakeplume', socket: 1 });
    expect(pressCard(p, 'relic_drakeplume', true, null).message).toContain('Locked in combat');
  });

  it('pad compare is X and jump is Y; keyboard compare is C', () => {
    expect(relicPad('x')).toBe('compare');
    expect(relicPad('y')).toBe('jump');
    expect(relicPad('a')).toBeNull();
    expect(relicKey('KeyC')).toBe('compare');
    expect(relicKey('Tab')).toBe('jump');
    expect(relicKey('KeyF')).toBe('equip');
  });

  it('has a 24px silhouette for every keepsake', () => {
    for (const k of KEEPSAKES) {
      expect(KEEPSAKE_ICONS[k.id], k.id).toContain('<svg');
      expect(KEEPSAKE_ICONS[k.id]).toContain('currentColor');
    }
  });
});
