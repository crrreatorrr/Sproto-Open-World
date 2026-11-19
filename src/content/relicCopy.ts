/**
 * Card text for totems and relics. The sim does not import this. The menu fetches
 * public/ui/relic-copy.json, so these strings stay out of the boot script.
 *
 * Placed GLBs, from the Blender spec: public/assets/models/totems/<id>.glb.
 * Not committed here. The Mac build lands them on main; the view uses a stand-in until then.
 */
export interface RelicCopy {
  flavour: string;
  clue: string;
  effect: string;
  cap: string | null;
  /** How a bonus relic is earned early. Null when the quest step is the only way. */
  bonus: string | null;
  /** Provisional GLB under public/assets. Null for relics (no placed model). */
  model: string | null;
  /** Placed height in metres. 0 for a relic. */
  height: number;
}

const relic = (flavour: string, clue: string, effect: string, cap: string | null, bonus: string | null = null): RelicCopy =>
  ({ flavour, clue, effect, cap, bonus, model: null, height: 0 });

const totem = (id: string, flavour: string, clue: string, effect: string, cap: string | null, height: number): RelicCopy =>
  ({ flavour, clue, effect, cap, bonus: null, model: `models/totems/${id}.glb`, height });

export const RELIC_COPY: Record<string, RelicCopy> = {
  relic_drowned_coins: relic(
    'Minted in the lost kingdom before the mud came. They still know the way home.',
    'A watchman once kept something under the bell.',
    'Parry window +4 ticks (200 → 267 ms).', 'Cap: parry window never above 300 ms.', 'Reflect 3 coins into Slingers'),
  relic_gatekeepers_grip: relic(
    'Taken from the hand that held Thornwood shut.',
    'The hand that held the wood shut left something behind.',
    'Spam-parry window 4 → 8 ticks (67 → 133 ms).', 'Cap: spam-parry window never above 8 ticks.'),
  relic_hopeglass: relic(
    'Filled with the green elixir the old folk called hope. Time drinks it slowly.',
    'Something green slept in the beast under the quarry.',
    'On a parry, the world runs at half speed for 0.5 s. 5 s cooldown.', 'Cap: one trigger per 5 s.'),
  relic_sprotos_stride: relic(
    'Wraps of the beast-hero Sproto, who was never where the blow fell.',
    'The giant prints remember a lighter step.',
    'Roll i-frames end 17 → 20; a perfect dodge ends 9 → 12.', 'Cap: i-frames never end after tick 21; a perfect dodge never after 12.', '3 perfect dodges against the Hollow Giant in one fight'),
  relic_tinubus_broken_seal: relic(
    "Pried from the tyrant's hoard. It holds the moment open, and never again for him.",
    "The mill wheel once held a tyrant's mark.",
    'Attack input buffer 10 → 14 ticks; chain grace 8 → 12.', 'Cap: +4 ticks at most on each.'),
  relic_oracles_eye: relic(
    'A chip of the Speaking Stone. It shows the blow before the blow.',
    'The ridge glass still looks a moment ahead.',
    'Parryable wind-ups close a gold ring on the parry frame.', null),
  relic_deepbreath_bellows: relic(
    'The deep seam breathes for those who listen.',
    'The deep earth breathes for those who listen.',
    'Stamina lost per blocked blow −25%.', 'Cap: block stamina never cut by more than 35%.'),
  relic_elder_iron_rivet: relic(
    'Iron from the lost kingdom. Strike it, and it answers.',
    'Struck iron from the old camps answers back.',
    '10% chance a blocked melee blow fires a free Guard Counter. 3 s cooldown.', 'Cap: the chance never passes 15%.', 'Fell 2 Gunners with their own reflected charged shot'),
  relic_surgebriar: relic(
    'Grown where the wild surge runs closest to the ground. Blows lose their nerve in it.',
    "The weaver's hedge keeps a living cuff.",
    "8% chance an unguarded hit is reduced to a block's chip. 4 s cooldown.", 'Cap: the chance never passes 10%. Never on unblockables.'),
  relic_drakeplume: relic(
    "A drake's feather. The ground comes up gently to meet it.",
    'What fell out of the sky still softens a landing.',
    'Sprint stamina −30% (12 → 8.4 per second); plunge landings recover twice as fast.', 'Cap: sprint never costs less than 7 per second.'),
  totem_elders_hearth: totem('totem_elders_hearth', 'Sit. The fire keeps you.',
    'The first fire you rest beside keeps a seat.',
    'Heals 1% of max health per second for 20 s, within 6 m.', "Heal totems don't stack.", 0.5),
  totem_field_warden: totem('totem_field_warden', "The Grunts can't look away from it. Nobody knows why.",
    "Something in the orchard holds the small ones' gaze.",
    'Draws normal enemies within 10 m for 4 s. Elites ignore it.', 'One active.', 1.6),
  totem_seekers_lantern: totem('totem_seekers_lantern', 'It shows what the valley hid in plain sight.',
    'The valley hid a light for what sits in plain sight.',
    'Chests and hidden pickups within 40 m shimmer for 30 s.', null, 1.2),
  totem_turnstone: totem('totem_turnstone', 'Plant it, and it turns one shot around.',
    'A stone in the salvage yard turns a shot around.',
    'Reflects one projectile every 4 s inside 5 m, for 20 s.', 'Does not stack with Mirror Ward. In co-op, every 6 s.', 1),
  totem_elders_seed: totem('totem_elders_seed', "A piece of the Elder's garden, for the road.",
    'The garden stones remember a seed for the road.',
    'Refills one Sprout Tonic charge, then a heal circle for 10 s. Once per shrine rest.', 'Once per shrine rest.', 0.35),
  totem_earthspeaker_stake: totem('totem_earthspeaker_stake', 'Drive it in, and the ground speaks a little early.',
    'The quarry crew left a stake that hears the ground.',
    'Ground attacks within 12 m show their mark 10 ticks early; enemies inside move 15% slower.', 'Slow never passes 15%. In co-op, the mark only.', 0.9),
  totem_ember_quench_pail: totem('totem_ember_quench_pail', 'For hayfires, and for worse.',
    'Smoke on the hills left a pail that puts fire out.',
    'Clears Burn within 6 m and grants Burn immunity for 3 s.', 'Once per placement.', 0.5),
  totem_skylure_post: totem('totem_skylure_post', "Flyers come down to look. That's enough.",
    'An ugly little post still brings flyers down to look.',
    'A flying enemy within 30 m glides low for 2 s, once per placement. Bosses: once per phase.', null, 2),
};

export const relicCopy = (id: string): RelicCopy | undefined => RELIC_COPY[id];
