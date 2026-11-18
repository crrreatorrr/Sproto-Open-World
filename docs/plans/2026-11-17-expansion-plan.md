# Sproto Open World: Expansion Plan

Status: **plan only, nothing built yet.** Revision 4, 2026-11-17.

- **Revision 4** folds in the owner's answers (§12):
  - powers swap anywhere through a **spell selector** in the main menu;
  - the only Part B option is a **two-branch skill tree, Magic and Combat**, which replaces the four
    attributes;
  - the level cap goes to **15**;
  - **C1 starts alongside M4**.
- **Revision 3:** attacks don't need to come from sproto-duel, only the staff models.
- **Revision 2:** fixed revision 1's factual errors, found by an architect and QA review against the
  code and the sibling repos (§11).

This plan extends `2026-11-17-first-area-plan.md` (the "slice plan"), and § numbers like §4.6 point
into it.

The owner asked for:
- more quests;
- more powers, where you equip only some and can change them at pause;
- a better menu;
- more weapons: the other staffs from sproto-duel;
- more enemies: the huge monsters from sproto-shooter;
- ideas for more, such as a skill tree.

**"Expand without adding features"** is read as: grow by content on the systems that exist, and add
new mechanics only where a request needs one. So the plan has two parts:
- **Part A, the core:** exactly what was asked, built mostly from existing mechanics. Where new code
  is needed it's marked **(new code)** with an honest size.
- **Part B, options:** the skill tree and other ideas, each a new feature priced on its own. **The
  owner chose the skill tree only** (§7); the rest is kept as a backlog (§8).

## 0. Where this fits

The slice comes first. **M4 (Sproutvale content) and M5 (Scrapjaw) are unchanged**, except that M4's
XP check now uses the skill tree's levels and the cap of 15. Part A starts after M5, except **C1
(the loadout, the spell selector, the skill tree and the menu), which runs alongside M4** (owner's
answer 5), because it touches combat and the UI, not the map.

| System | Today (after M3) | Part A adds |
|---|---|---|
| Powers | 4 spells (Bolt, Blast, Frost Nova, Chain Zap), each fixed to its slot | 8 new powers; **4 slots you fill**; swap at pause |
| Staffs | 5 defined (stats only); the Gourd is planned in M4 | 9 staffs (models from sproto-duel), each with a **trait** |
| Enemies | Grunt, Slinger, Wisp, Brute; the Gatekeeper and Scrapjaw are planned | 2 robot elites, 2 new huge bosses, scaled giant variants |
| Quests | `q_wake_up`; M4 plans main M1–M4 and side S1–S3 | 12 more, using only the existing objective kinds |
| Menus | Pause → Character / Quest log / Settings | one tabbed menu with 2-D navigation |

## Part A: the core

## 1. Powers and the loadout

### 1.1 The rule

- You **learn** powers (quests, bosses, the trader) and **equip four**: LT + X / Y / B / A on pad,
  or 1–4 / E R Z X on keyboard (today's keys).
- **Swap powers anywhere in the main menu with the spell selector** (the Powers tab), any time,
  mid-fight included (owner's answer 1). A power you swap in gets cooldown = `max(remaining, max(full, 180 ticks))`. So a swap
  never makes a cooldown shorter, and a fresh swap waits at least 3 s. Cooldowns are kept per
  power, so a power you swap out keeps counting down (that's how the sim already stores them).
- **Gear (staff, robe, charms) changes only out of combat**: no enemy has targeted you for 5 s, or
  you're at a shrine. Without this, pause-swapping staffs per situation (Moonward for spells, Shooter
  for Bolts…) would beat the power rule.
- **These rules hold with the sim running.** In single player the pause menu's intents ride a tick
  (`App.pausedTick`); in co-op there is no pause at all. So the rule lives in the sim (validated
  `UiAction`s), never in the menu.
- At a shrine, swapping skips the cooldown.

### 1.2 The twelve powers

The current four stay. **The eight new ones are original designs for this game** (owner, revision
3: only the staff *models* come from sproto-duel; attacks don't need to). Each new power answers a
specific enemy or situation in this plan, and reuses a mechanic that exists where it can. The
numbers are a first pass, tuned by the bot balance check.

| Power | Does (first pass) | Answers | Cost / cooldown | Reuses | New code |
|---|---|---|---|---|---|
| Arcane Bolt | fast projectile | Wisps, poke | 6 / 18-tick fire rate | today | – |
| Blast | exploding orb, Burn, knockdown | groups, Grunts | 30 / 3 s | today | – |
| Frost Nova | ring, Chill ×2, push | being swarmed | 25 / 8 s | today | – |
| Chain Zap | 3 jumps, Shock | Slingers, robots | 35 / 6 s | today | – |
| **Mirror Ward** | a 0.8 s bubble; its first 0.2 s **reflects** projectiles (×1.5 damage), the rest blocks them | Rivet Gunners, the Burrowmother's spit, the Drake's fireballs | 12 / 5 s | the parry-reflect planned for Scrapjaw's throw (§4.10) | small |
| **Static Snare** | a projectile that roots for 1.5 s (bosses 0.3 s); a rooted target takes +30% | kiting robots, Wisps, a giant's windup | 15 / 9 s | Bolt's projectile, the Stunned state, the status multiplier path | small |
| **Seeker Swarm** | for 6 s your Bolts home on the locked target | the flying Drake, fast Wisps | 20 / 20 s | enemy projectiles already support `homing` | small |
| **Bramble Wall** | grow a 5 m thorn wall for 6 s: it blocks movement and projectiles; enemies touching it take damage; **a charging giant that hits it is stunned**, like Scrapjaw's pillars | charges (Scrapjaw, Burrowmother, the Colossus), Lens Warden's beam | 30 / 15 s | the pillar-stun rule (§4.10) | moderate (a temporary collider) |
| **Vine Pull** | a vine to the locked target: pulls a light enemy to you, or pulls you to a heavy one | Slingers at the back, gap-closing on giants | 15 / 6 s | lunge and push motion | small |
| **Healing Bloom** | a 2.5 m flower patch for 6 s that heals 3% HP/s while you stand in it; casting pauses it 1 s | long fights; saves tonics | 30 / 22 s | a stationary area (like Frost Nova's test), vitals | small |
| **Ember Breath** | a 2 s channel: a 6 m cone, damage each tick, Burn; you walk at 35% | Broken bosses, packed groups | 30 / 18 s | Frost Nova's area test, Burn | moderate (channel state, hold on pad) |
| **Sprout Surge** | a meter fills as you deal and take damage (perfect Mirror Wards add 10%); release an expanding wave | the big moment of a boss fight | meter / – | Frost Nova's ring | moderate (meter, HUD) |

Notes:
- **No new player clips.** Ward, Snare, Swarm, Pull and Bloom use `cast`. Bramble Wall and Surge use
  `cast_big`. Ember Breath holds `cast`'s last frame.
- **New props:** the thorn wall and the bloom patch reuse `grove_root_wall` and the crops /
  pumpkin art, tinted. There are no new imports.
- **Blink is not a power.** It's the Momentum staff's trait (§2), so the two don't overlap.

### 1.3 Where each power comes from (all before the last boss)

| Power | Source | Gate |
|---|---|---|
| Bolt | start | – |
| Blast, Frost Nova, Chain Zap | the M4 quests (Chain Zap is optional content, as the slice plans) | – |
| Mirror Ward | quest A1 "The Rivet Volley" | after M2 of the main chain |
| Static Snare | quest A2 "Lens Flare" | needs Mirror Ward (prereq) |
| Seeker Swarm | the trader, 150 Sprouts | after Scrapjaw |
| Vine Pull | quest A4 "Pumpkin Strength" | – |
| Healing Bloom | the Elder, quest A5 | after Scrapjaw |
| Bramble Wall | quest A7 "The Weaver's Thorns" | after Scrapjaw |
| Ember Breath | the Burrowmother (A9) | – |
| Sprout Surge | quest A10, before the Drake | Burrowmother beaten |

### 1.4 Sim changes (new code, about 1 unit)

- `progress.loadout: [SpellId | null] ×4`. `progress.spells` stays as the list of known powers.
- A new intent: `UiAction { kind: 'equipSpell'; slot; spell }`. The sim checks that the power is
  known, that you're alive, that you're not mid-cast, and that it isn't in another slot (it moves
  there). It then applies the cooldown rule.
- `equip` (gear) gains the out-of-combat check (§1.1).
- `playerCombat` reads the loadout, not `SPELLS[id].slot`. Woven casts work from any slot.
- **Save schema 3:** v2 → v3 puts the known spells in their old slots. `validate()` checks the
  loadout: 4 entries, each null or known, no duplicates.
- **Tests:**
  - every swap rule, including that a swap never shortens a cooldown;
  - a swap during a cast is refused;
  - a gear swap in combat is refused;
  - the v2→v3 migration;
  - **a recorded replay with swaps made while paused hashes the same.**

## 2. Staffs from sproto-duel

### 2.1 Nine staffs, each with a trait

Only the **models** come from sproto-duel (`public/assets/models/staffs/`). Each staff keeps its
melee damage and spell power, and gets **one trait**, designed for this game, so a staff choice
means a play style. A trait is a small hook (most are a melee or Bolt modifier), and each one has a
test.

| Staff | Melee dmg / spell power | Trait | Plays like | Source |
|---|---|---|---|---|
| Sprout Staff | 20 / 1.00 | none: balanced | the start | start |
| Gourd (slice §4.6) | 22 / 1.00 | **Ember Swing**: L3 applies Burn (the slice's perk) | fire melee | S1 (M4) |
| Momentum | 22 / 0.90 | **Blink**: Sprint + Dodge becomes a 6 m blink with i-frames, 4 s cooldown; a plain dodge still rolls | the dodger | Thornwood (M4) |
| Nobu | 26 / 1.00 | **Shove**: heavies and Bolts knock light enemies back 1.5 m | spacing, crowd control | the trader (M4) |
| Moonward | 18 / 1.35 | **Moonlit**: spells cost 15% less | the caster | S3 chest (M4) |
| Fighter's Might | 32 / 1.10 | **Crusher**: +25% poise damage; a heavy that breaks poise stuns 0.5 s longer (the slice's perk, extended) | heavy hitter | Scrapjaw (M5) |
| **Shooter** | 21 / 1.05 | **Charged Bolt**: hold the Bolt button to charge, up to ×3 damage for ×2 mana | burst poke | quest A3 "Iron Gallery" |
| **Fighter** | 28 / 0.95 | **Brawler**: light strings get a 4th hit; spells ×0.9 | the melee purist | quest A6 "The Hollow Giant" |
| **Alien Ray** | 24 / 1.20 | **Abduct**: Bolt hits lift a light enemy for 1 s (it can't act) | control caster | **held back for area 2**, as the slice says (§4.6) |

- **Brawler's 4th hit** reuses `attack_light_3`'s timing played faster. If that doesn't feel right,
  add `attack_light_4` through the Blender pipeline (`art/tools/melee_anim.py`), followed by
  `gen:moves` (+0.5 unit).
- **Charged Bolt** is a hold on whichever slot holds Bolt (LT + its face button on pad). It needs
  a hold test in the pad e2e.
- The slice's perks on Momentum (−1 startup on lights) and Moonward (+10% woven) are replaced. If a
  trait plays worse than its perk in the owner's playtest, keep the perk.

### 2.2 Notes

- **Balance gate (numbers, not taste):** each staff's sustained DPS in the bot's reference fight is
  within ±15% of the Sprout Staff's at equal level. Mana limits count. Each trait gets a test that
  measures Bolts per second and damage per mana.
- **Imports:** Shooter and Fighter. Duel only has their `-lod1` file (about 1 MB each), which becomes
  the only LOD. Alien Ray waits for area 2.
- **Loading:** a staff loads the first time you see one (chest, shop, drop). A save that continues
  with a non-starter staff equipped loads its **LOD1 at boot** (about 1 MB, below the critical
  headroom), and the full model streams in after.
- `check-assets` asserts `socket_staff` for each new staff.

## 3. Huge monsters from sproto-shooter

### 3.1 What's actually new

The models are in `sproto-shooter-bosses/dist/assets/models/characters/`, skinned, 18–20k
triangles each. Some are already in this game:

| Model | Status | Clips |
|---|---|---|
| `car_monster` | **Scrapjaw**, M5 | 10 |
| `sproto_monster` | **already the Brute** (`elites/brute.glb`) | kick, punch, walk (no idle) |
| `monster` | **the Gatekeeper**, planned for M4 | smash, walk (no idle) |
| `mole_monster` | **new: the Burrowmother boss** | charge, charge_start, idle, roar, shoot_loop, shoot_start, slam, smash, stunned, walk (no burrow) |
| `dragon` | **new: the Skyfire Drake boss** | **fireball, fly only** |
| `robot_shooter` | **new elite** (human-sized) | cast, cast_big, idle, run, stun |
| `robot_laser` | **new elite** (human-sized) | cast, idle, run, stun |

So the "huge monsters" in Part A are:
- the **two new bosses**;
- **giant variants** of the Brute and Gatekeeper models, scaled ×1.4–1.6 with their own stats. These
  are reskins, and say so, but they're huge, and their models are already in the download.

### 3.2 The roster

| Enemy | Model | Role | Weak / resist | Where |
|---|---|---|---|---|
| **Rivet Gunner** | `robot_shooter` | ranged elite; keeps 12–18 m away; bursts with `cast`, a charged shot with `cast_big` (Mirror Ward reflects it) | Chill weak, Shock resist | Orchard salvage camps |
| **Lens Warden** | `robot_laser` | a sweeping beam (`cast` looped) that you dodge or Ward through; slow | Physical weak, Arcane resist | the old mill |
| **Hollow Giant** | `monster` ×1.5 | a field giant that roams Thornwood on a leash; slow, huge reach | Shock weak | Thornwood |
| **Bramble Colossus** | `sproto_monster` ×1.6 | a camp boss; kick and punch strings | Burn weak | Bramble camps |
| **Burrowmother** (boss 2) | `mole_monster` | §3.4 | Chill weak, Burn resist | the Deep Seam pit |
| **Skyfire Drake** (boss 3) | `dragon` | §3.5 | Shock weak, Burn resist | over the Orchard |

### 3.3 Giant tech (new code, about 1.5 units; simpler than revision 1)

Revision 1 planned bone-baked hitboxes. That would have made the sim own an animation clock per
enemy and touched targeting, lunges, nova and chain ranges. This plan does the following instead:
- **One scaled body capsule** for movement, targeting and every existing range check
  (`body.radius`, unchanged code paths).
- **Weak-spot spheres** in the enemy's facing frame (forward / up / radius, as attack hitboxes are
  authored today), optionally per move. They're checked only when damage resolves, and multiply
  damage (×1.5).
- **Attack hitboxes** stay hand-authored spheres. Big ones sweep along a short path over their
  active frames (data, not bones).
- **A fixed `lockPoint` per enemy** (the weak spot or the chest) and a **`cameraScale`** that pulls
  the camera back.
- **At most 4 elite-tier skinned characters active**, as the slice rule. Field giants have a leash;
  bosses have arenas.
- **Idle:** giants without an idle clip hold walk's first frame, with a procedural breathe.

### 3.4 Burrowmother (boss 2)

- **Arena:** "the Deep Seam", an **open pit** carved into the quarry floor. A cell is a heightfield,
  so there are no caves; the bake's `carve` / `bowl` already makes pits.
- **Phases:**
  - **Phase 1:** smash, slam (ring telegraph), charge into a pillar → stunned.
  - **Phase 2:** "burrow". She sinks (a transform offset with a dust FX, since there's no clip),
    surfaces under a telegraphed decal, then `shoot_loop` spits Burn globs. Mirror Ward reflects
    them.
  - **Phase 3:** faster, plus 2 summoned Grunts.
- **Size:** 1.5 MB on the region's budget, not critical. Fight 3–8 min, as the slice's boss rule.

### 3.5 Skyfire Drake (boss 3): fought from the air

`dragon.glb` has only `fly` and `fireball`. Rather than author ground clips first, **the fight
happens in the air**:
- The Drake circles the Orchard at 12–20 m and dives along telegraphed lines, firing volleys
  (`fireball`).
- You hurt it with Bolts, Seeker Swarm, Chain Zap and Static Snare, and above all by **reflecting
  fireballs with Mirror Ward**. That teaches the A1 power, and every reflect builds Broken.
- **Broken:** it glides low over the field for 6 s (the `fly` clip at low altitude), which is the
  melee window.
- **Far LOD:** the Drake gets one (`dragon.glb` has no LOD; the pipeline makes it) for the flyover
  before the fight.
- **If the air fight is dull in the owner's playtest:** author `land`, `walk`, `bite` and `death`
  in Blender (+1.5 units), following the player's clip pipeline.

### 3.6 Variety without art: stat affixes (small)

Today enemy moves can't apply statuses, so the core affixes are stats only:

| Affix | Effect |
|---|---|
| Colossal | ×1.5 scale, ×2 HP, slower; counts as elite |
| Swift | +30% speed, −20% HP |
| Hardy | resists its weak element (×1 instead of ×1.5) |
| Frail | −30% HP, +20% XP (for early camps) |

- Rolled per camp from `hash(seed, campId, spawnGeneration)`. That doesn't depend on streaming
  order, and it's the same after a reload.
- Status affixes (Burning, Frosted, Charged, Warded) need status-on-hit for enemies: see Part B.

## 4. More quests (12, existing objective kinds only)

### 4.1 Rules

- **Only today's kinds:** `reach`, `kill`, `collect`, `talk`, `interact`. No new kinds in Part A.
- **Every quest has a `prereq`** (a quest done, a flag, a level), so none can be started out of
  order or soft-locked. **New code:** a `level` condition and a `questDone` condition (small).
- **Every quest gives something you use:** a power, a staff, a charm or a robe. No duplicates of
  slice rewards.
- **Each quest teaches or tests one thing.**
- **Short dialogue:** at most 3 lines before a choice.
- **A content test checks:**
  - every id a quest names exists;
  - every reward is unique;
  - every prereq can be met;
  - no quest needs a power that's only given later.

### 4.2 The quests

| # | Quest | Prereq | Steps (objective kinds) | Teaches | Reward |
|---|---|---|---|---|---|
| A1 | The Rivet Volley | main M2 done | talk to the Watch Captain → reach the salvage camp → kill 3 Rivet Gunners → talk | reflecting projectiles | **Mirror Ward** |
| A2 | Lens Flare | A1 | reach the mill → kill the Lens Warden → interact with the lens | Ward or dodge through a beam | **Static Snare** |
| A3 | Iron Gallery | A1 | kill 8 Rivet Gunners in the Orchard → collect 5 Rivets → talk | ranged pressure | **Shooter** staff |
| A4 | Pumpkin Strength | S1 done | collect 3 Giant Pumpkins (Bramble camps) → talk | the Bramble Colossus | **Vine Pull** |
| A5 | The Elder's Garden | Scrapjaw | talk → interact with 3 shrines → talk | the shrine network | **Healing Bloom** |
| A6 | The Hollow Giant | level 6 | follow 4 track marks (reach ×4) through Thornwood → kill the Hollow Giant | a giant's tells and weak spot | **Fighter** staff |
| A7 | The Weaver's Thorns | Scrapjaw | talk to the Weaver → collect 4 Thorn Seeds from Wisps → talk | Wisps; walling a charge | **Bramble Wall** |
| A8 | Tremors | Scrapjaw | talk to 3 quarry miners (talk ×3) → reach the Deep Seam | – | charm Seam Lamp |
| A9 | The Deep Seam | A8 | reach the pit floor → kill the Burrowmother | burrow tells, reflecting spit | **Ember Breath**, robe Moleskin |
| A10 | Smoke on the Hills | A9 | interact with 5 burning haystacks (5 objects) → talk | – | **Sprout Surge** |
| A11 | Bait | A10 | collect 3 Sheep Decoys → interact with the bait post | – | charm Drake Scale |
| A12 | Skyfire | A11 | kill the Skyfire Drake → talk to the Elder | the whole kit | end card 2, staff-slot charm |

Notes:
- "Interact ×5" means five interactable objects, each its own objective; that works today.
- **XP:** the cap is 15 (owner's answer 4). The slice ends around level 7; these quests and their
  camps are tuned so you reach about 12 at the Burrowmother and 14–15 at the Drake.

## 5. A better menu (new code, about 2 units)

- **One tabbed menu** replaces today's separate Character and Quest log screens. LB / RB (Q / E on
  keyboard) switch tabs; Start or Esc opens and closes it; pad Back / View still opens it on Quests
  (today's binding).
- **Navigation:** `MenuNav` is a 1-D list today. **New code:** a 2-D grid mode (D-pad in 4
  directions, with focus memory per tab) for the Powers grid. The e2e tours every tab with the
  simulated pad.

| Tab | Contents |
|---|---|
| **Powers** (the spell selector) | 4 slots and a grid of learned powers; pick a slot, pick a power; cooldowns; "Ready in N s"; the swap rule in one line |
| **Gear** | staff, robe, 2 charms; a side-by-side compare with green / red deltas; the trait in words; "locked in combat" when it is |
| **Skills** | the Magic and Combat branches (§7): ranks, the next rank's effect, milestone perks, points left |
| **Quests** | active / tracked / done, the steps, Track |
| **Settings** | today's settings, plus camera distance and an invert option |

- **HUD:** the 4 slots show the loadout's icons with the cooldown sweep and the Surge meter.
- **Title:** Continue, New game (asks before overwriting the one save), Settings.

## 6. Part A milestones (1 unit ≈ one focused engineer-week)

| # | Milestone | Size | Contents | Accept |
|---|---|---|---|---|
| **C1** | Loadout, spell selector, skill tree, menu | 6.5 | §1.1, §1.4, the gear lock; the skill tree (§7) replacing attributes; level cap 15; save v3; the tabbed menu with 2-D nav (Powers, Skills, Gear, Quests, Settings); HUD slots | a swap and a skill spend by pad in the e2e; the swap and skill rules in sim tests; the paused-swap replay hashes the same; the v2→v3 migration; every tab pad-only |
| **C2** | Staffs | 2 | the trait path, Momentum's blink, imports (Shooter, Fighter), boot LOD1 | the ±15% DPS gate; a test per trait; `socket_staff` checks |
| **C3** | New powers | 3.5 | the 8 powers (§1.2); the channel state; the meter; Bramble Wall's temporary collider | a test per power; Ember Breath and Charged Bolt held by pad in the e2e; a charging giant stunned by Bramble Wall |
| **C4** | Robots and affixes | 2 | Rivet Gunner, Lens Warden, giant variants, stat affixes; quests A1–A4, A6–A7 | camps deterministic across reloads; `test:balance` camp gates |
| **C5** | Burrowmother | 3.5 | giant tech (§3.3), the Deep Seam pit, the boss; quests A5, A8–A9 | the owner wins in 3–8 tries; budgets hold with the boss and 2 adds |
| **C6** | Skyfire Drake | 3 | the air fight, the far LOD, the flyover; quests A10–A12 | the owner signs off; the flyover holds the streaming budgets |
| **C7** | Content pass | 1 | the quest content test, XP curve, audio for the new powers, a full pad-only run | a fresh save reaches the Drake by pad with no debug use |

**Part A total: 21.5 units** (C1 now includes the skill tree), about the size of the whole slice. C5 is the riskiest. C1 can run
alongside M4.

## Part B: the skill tree (the owner's pick)

## 7. Skill tree: Magic and Combat (part of C1, about 2.5 units)

The owner's design (answer 3):
- monsters drop XP, and certain XP totals give skill points;
- you spend skill points on whatever you like;
- **Magic** raises spell damage and the strength of protection spells;
- **Combat** raises attack and defense.

The tree **replaces the four attributes** (Might, Arcana, Vitality, Endurance), and points are spent
on a new **Skills tab, anywhere** (not only at shrines).

### 7.1 Points

- XP and levels stay as they are (`round(60·L^1.45)`); **the cap rises from 10 to 15** (owner's
  answer 4). XP to reach L10 is 6,075; L15 is **17,139**.
- **2 skill points per level-up**, so 28 by level 15. Each boss also gives +1, which makes 31 with
  Scrapjaw, the Burrowmother and the Drake.
- The fixed growth per level (HP, stamina, mana) stays, so a player who never spends still grows.

### 7.2 The two branches

Each skill has ranks 0–10 and costs 1 point per rank. Effects are first-pass numbers, tuned by the
bot balance check. They replace the attribute numbers in `content/progression.ts`.

| Branch | Skill | Per rank | Covers |
|---|---|---|---|
| **Magic** | **Spell Power** | +4% spell damage (as Arcana's +4% spell power today) | Bolt, Blast, Chain Zap, Ember Breath, Static Snare, Seeker Swarm, Sprout Surge |
| | **Protection** | +8% protection-spell strength | Mirror Ward (reflect window, reflect damage), Bramble Wall (wall HP, duration), Healing Bloom (heal per second), Frost Nova's push |
| | **Focus** | +5 max mana, +3% mana regen | casting more often |
| **Combat** | **Attack** | +4% melee damage (as Might today) | every staff attack, ripostes |
| | **Defense** | +1 defense (both kinds) and +10 max HP | taking hits |
| | **Stamina** | +5 max stamina | rolls, blocks, sprint |

**Milestone perks** come free when a branch's total ranks reach 10 and 20, so a focused build gets
something a split build doesn't:
- Magic 10: woven casts cost 15% less.
- Magic 20: protection spells also cleanse one status.
- Combat 10: parries restore 5% HP.
- Combat 20: you can't be knocked down while attacking.

### 7.3 Rules and code

- **Spend anywhere** on the Skills tab: `UiAction { kind: 'spendSkill'; skill }`, validated by the sim
  (a point available, rank < 10). It works while paused and in co-op (it rides a tick).
- **Respec at a shrine** for Sprouts (100 × level): `UiAction { kind: 'respecSkills' }`, which is
  refused anywhere else.
- **Save schema 3** (shared with the loadout):
  - v2 → v3 maps the old attributes: Might → Attack, Arcana → Spell Power, Vitality → Defense,
    Endurance → Stamina, rank for point;
  - the player is given the points the new rate would have given (2 per level), so nobody loses
    points.
- The shrine's "Level up" entry becomes "Skills" (or is dropped, since the tab works anywhere). The
  level-up toast says "+2 skill points".
- **Tests:**
  - every skill's effect, and both milestone perks per branch;
  - spending refused with no points or at rank 10;
  - respec refused away from a shrine;
  - the v2→v3 migration keeps total power;
  - determinism (spends in a replay hash the same).
- **Balance:** a bot that puts everything into Magic and one that puts everything into Combat both
  clear the M4 camp gates and Scrapjaw inside the fight-length window.

## 8. Ideas not chosen (backlog)

The owner chose only the skill tree. The rest stays here for later, with its sizes:

| Idea | Size | Notes |
|---|---|---|
| Bestiary (weakness journal) | 1.5 | reveals saved; a portrait comes with M7's render-to-texture |
| Staff tempering | 1.5 | must stay inside the ±15% staff gate |
| Shrine trials | 2.5 | needs a `waves` objective (the wave runner is sandbox-only today) |
| Fast travel between shrines | 1 | a travel veil like the teleport's |
| Bounty board | 1.5 | repeatable quests are new; rolls from `hash(seed, restCount)` |
| Status affixes | 1.5 | enemy moves would need to apply statuses |
| Quick-swap radial | 1 | not on Back / View (that opens Quests) |
| Accessibility pack | 1.5 | text size, hold vs toggle, colour-blind telegraphs, less shake |
| Likeness bosses | 2–3 each | **saved for area 2** (owner's answer 2) |
| World events, day / night, second area, co-op | – | each its own plan |

## 9. Testing, saves and budgets

- **Determinism:** snapshot / restore / hash cover the loadout, cooldowns, the Surge meter, skill ranks
  and affixes; the paused-swap replay is part of the suite.
- **Save:**
  - v3: loadout and skills.
  - v3 also carries the skill tree (§7.3); backlog items would add their own fields later.
  - Each version gets a migration test and the corrupt fallback.
  - Per-player state lives in `Progress`, not world flags (co-op).
- **Budgets:**
  - The critical download is 7,448 of 8,192 KiB (7.27 MiB). JS counts toward it, so Part A's code
    and data are checked each milestone.
  - Models live under `assets/`, which `check-budgets.mjs` doesn't walk today. **New check:** a
    per-region model budget, with an assertion that no expansion model is in the critical set.
  - The budget lap gets a boss spot.
- **e2e (pad only):**
  - a power swap;
  - a gear swap refused in combat;
  - a tour of every tab;
  - Ember Breath held;
  - the Drake's reflect loop on a scripted volley.

## 10. Risks

| Risk | Mitigation |
|---|---|
| The Drake's air fight is dull | the owner's check at C6; the Blender clip fallback (+1.5) |
| Pause swapping trivializes fights | the cooldown rule, the gear lock, tuning in data; open question 1 |
| A staff or power dominates | the ±15% DPS gate, a test per trait, the bot balance check |
| Giant hitboxes feel unfair | weak spots and attack sweeps tuned in data with the timeline view; the owner's check at C5 |
| Asset weight | everything new is region assets; the new model budget check; LOD1 at boot |
| The core grows into Part B | Part B items only on the owner's pick; `docs/plans/backlog.md` for the rest |

## 11. What revision 2 fixed (from the architect and QA review)

- **Powers:** revision 1 credited duel with spells it doesn't have. Revision 2 switched to duel's
  real spells; revision 3 (owner) makes the eight new powers original designs, each answering an
  enemy in this plan.
- **Staff traits:** only the staff models come from duel (owner, revision 3). Traits are original,
  the Gourd is counted (nine staffs), and Alien Ray stays held for area 2.
- **Giants:**
  - `sproto_monster` (the Brute) and `monster` (the Gatekeeper) were already in the game; they're
    now honest variants.
  - The dragon's missing clips led to the air fight.
  - The mole's missing burrow clip is covered by a transform offset.
- **Giant tech:** bone-baked hitboxes were dropped for weak-spot spheres plus one capsule.
- **The mine:** a cell is a heightfield, so caves are impossible; the Deep Seam is now an open pit.
- **Gear swaps:** gear swaps now have a combat lock, and the swap rule is stated for a running sim
  and co-op.
- **New quest objectives:** `waves` and repeatable bounties were not small; they moved to Part B
  with their real cost.
- **Quests:** every quest now has a prereq, unique rewards, and every power arrives before the last
  boss; a content test enforces it.
- **Smaller facts:** the keyboard spell keys are E R Z X (Q is block), the kind is `collect`, and
  7,448 KiB is 7.27 MiB.
- **Budgets:** the claim that the budget script covers models was false; a model budget check is
  added. Boot loads the equipped staff's LOD1.
- **Sizes:** the milestones were resized (Part A is 19 units), and the plan is split into a
  content-first core and priced options, so "without adding features" is honest.

## 12. The owner's answers (2026-11-17)

1. **Swapping powers:** anywhere in the main menu, through a spell selector. The cooldown rule
   (§1.1) stays, so swapping isn't a free reset.
2. **Likeness bosses:** saved for area 2.
3. **Part B:** only the skill tree, with Magic and Combat branches; points come from XP; spend them
   on anything; Magic raises spells, spell damage and protection spells; Combat raises defense and
   attack (§7).
4. **Level cap:** raised to 15.
5. **Order:** C1 starts alongside M4.
