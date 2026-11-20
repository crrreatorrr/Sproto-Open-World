import { describe, expect, it } from 'vitest';
import { ITEMS } from '../../src/content/items';
import { MERCHANTS } from '../../src/content/loot';
import type { UiAction } from '../../src/sim/commands';
import { BTN } from './combatHelpers';
import { choose, evs, interact, standBy, tick1, ui, village } from './m3Helpers';

/** Plan §5 the merchant: buy{merchant, item}, only while its shop is open, stock and price enforced. */

const buy = (item: string): UiAction => ({ kind: 'buy', merchant: 'merchant_village', item });

async function shopOpen(sprouts = 1000) {
  const v = await village();
  v.prog().sprouts = sprouts;
  standBy(v.w, 'merchant_village');
  const e1 = tick1(v.w, interact());
  expect(evs(e1, 'talk')).toMatchObject([{ npc: 'merchant_village', node: 'hello' }]);
  const e2 = tick1(v.w, choose(0)); // "Show me your wares."
  expect(evs(e2, 'dialogueEnd').length).toBe(1);
  expect(v.prog().shop).toBe('merchant_village');
  expect(v.prog().dialogue).toBeNull();
  return v;
}

describe('the merchant (plan §5)', () => {
  it('sells Nobu, two charms, +1 Tonic charge and (after Scrapjaw) the Seeker Swarm tome', () => {
    expect(Object.keys(MERCHANTS.merchant_village.stock).sort()).toEqual(['charm_quick_step', 'charm_second_wind', 'staff_brick_phone', 'staff_nobu', 'tome_seeker_swarm', 'tonic_upgrade']);
  });

  it('buy is refused while the shop is closed, even standing next to the merchant', async () => {
    const { w, prog } = await village();
    prog().sprouts = 1000;
    standBy(w, 'merchant_village');
    const e = tick1(w, ui([buy('staff_nobu')]));
    expect(evs(e, 'refused')).toMatchObject([{ action: 'buy', reason: 'That shop is not open.' }]);
    expect(prog().inventory.staff_nobu).toBeUndefined();
    expect(prog().sprouts).toBe(1000);
    w.dispose();
  });

  it('"Not today." does not open the shop', async () => {
    const { w, prog } = await village();
    standBy(w, 'merchant_village');
    tick1(w, interact());
    tick1(w, choose(1));
    expect(prog().shop).toBeNull();
    expect(prog().dialogue).toBeNull();
    w.dispose();
  });

  it('with the shop open: the price is deducted, the item arrives, the stock runs out', async () => {
    const { w, prog } = await shopOpen(300);
    const e = tick1(w, ui([buy('staff_nobu')]));
    expect(evs(e, 'bought')).toMatchObject([{ merchant: 'merchant_village', item: 'staff_nobu', price: ITEMS.staff_nobu.price }]);
    expect(evs(e, 'itemGained')).toMatchObject([{ item: 'staff_nobu', count: 1 }]);
    expect(prog().sprouts).toBe(300 - 120);
    expect(prog().inventory.staff_nobu).toBe(1);
    // One in stock: the second is sold out, and costs nothing.
    const e2 = tick1(w, ui([buy('staff_nobu')]));
    expect(evs(e2, 'refused')).toMatchObject([{ action: 'buy', reason: 'Sold out.' }]);
    expect(prog().sprouts).toBe(180);
    expect(prog().inventory.staff_nobu).toBe(1);
    w.dispose();
  });

  it('an item the merchant does not stock is refused', async () => {
    const { w, prog } = await shopOpen();
    const e = tick1(w, ui([buy('staff_fighters_might')]));
    expect(evs(e, 'refused')).toMatchObject([{ action: 'buy' }]);
    expect(prog().inventory.staff_fighters_might).toBeUndefined();
    expect(prog().sprouts).toBe(1000);
    w.dispose();
  });

  it('not enough Sprouts is refused and changes nothing', async () => {
    const { w, prog } = await shopOpen(79);
    const e = tick1(w, ui([buy('charm_quick_step')]));
    expect(evs(e, 'refused')).toMatchObject([{ action: 'buy', reason: 'Not enough Sprouts.' }]);
    expect(prog().sprouts).toBe(79);
    expect(prog().inventory.charm_quick_step).toBeUndefined();
    expect(w.world.flags['bought:merchant_village:charm_quick_step'] ?? 0).toBe(0);
    w.dispose();
  });

  it('the Tonic Flask raises the tonic maximum by one, for good', async () => {
    const { w, prog } = await shopOpen();
    tick1(w, ui([buy('tonic_upgrade')]));
    expect(prog().tonics).toEqual({ charges: 4, max: 4 });
    w.dispose();
  });

  it('a shop for another merchant is refused', async () => {
    const { w, prog } = await shopOpen();
    const e = tick1(w, ui([{ kind: 'buy', merchant: 'merchant_elsewhere', item: 'staff_nobu' }]));
    expect(evs(e, 'refused')).toMatchObject([{ action: 'buy', reason: 'That shop is not open.' }]);
    expect(prog().sprouts).toBe(1000);
    w.dispose();
  });

  it('closeMenu closes the shop: buying is refused again and gameplay input works', async () => {
    const { w, p, prog } = await shopOpen();
    // While the shop is open, attack input is ignored.
    tick1(w, ui([], BTN.light));
    expect(p.combat!.action).toBeNull();
    tick1(w, ui([{ kind: 'closeMenu' }]));
    expect(prog().shop).toBeNull();
    const e = tick1(w, ui([buy('staff_nobu')]));
    expect(evs(e, 'refused')).toMatchObject([{ action: 'buy', reason: 'That shop is not open.' }]);
    tick1(w, ui([], BTN.light));
    expect(p.combat!.action?.kind).toBe('attack');
    w.dispose();
  });

  it('several purchases in one tick are each validated in order', async () => {
    const { w, prog } = await shopOpen(200);
    const e = tick1(w, ui([buy('staff_nobu'), buy('charm_quick_step'), buy('charm_second_wind')]));
    expect(evs(e, 'bought').map((b) => b.item)).toEqual(['staff_nobu', 'charm_quick_step']);
    expect(evs(e, 'refused')).toMatchObject([{ action: 'buy', reason: 'Not enough Sprouts.' }]);
    expect(prog().sprouts).toBe(0);
    w.dispose();
  });
});
