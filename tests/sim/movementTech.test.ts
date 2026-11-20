import { describe, expect, it } from 'vitest';
import { defaultAbilities, type MovementAbilities } from '../../src/sim/entity';
import {
  createMovementTechState,
  MOVEMENT_TECH,
  stepMovementTech,
  type MovementRaycastFn,
  type MovementTechInput,
} from '../../src/sim/systems/movementTech';

const ALL_ABILITIES: MovementAbilities = {
  slide: true,
  dash: true,
  doubleJump: true,
  grapple: true,
};

function makeInput(overrides: Partial<MovementTechInput> = {}): MovementTechInput {
  return {
    pos: { x: 0, y: 0, z: 0 },
    vel: { x: 0, y: 0, z: 0 },
    yaw: 0,
    wishX: 0,
    wishZ: 1,
    grounded: true,
    sprinting: false,
    slidePressed: false,
    dashPressed: false,
    jumpPressed: false,
    grappleHeld: false,
    ...overrides,
  };
}

describe('movementTech', () => {
  it('exposes the exact tuned MOVEMENT_TECH constants', () => {
    expect(MOVEMENT_TECH.slideBoost).toBe(16);
    expect(MOVEMENT_TECH.slideCruise).toBe(8);
    expect(MOVEMENT_TECH.slideDrag).toBe(2.4);
    expect(MOVEMENT_TECH.slideTicks).toBe(42);
    expect(MOVEMENT_TECH.slideHopBoost).toBe(1.12);
    expect(MOVEMENT_TECH.dashSpeed).toBe(24);
    expect(MOVEMENT_TECH.dashTicks).toBe(9);
    expect(MOVEMENT_TECH.dashCooldownTicks).toBe(120);
    expect(MOVEMENT_TECH.dashInvulnTicks).toBe(7);
    expect(MOVEMENT_TECH.doubleJumpVel).toBe(7.0);
    expect(MOVEMENT_TECH.grappleRange).toBe(16);
    expect(MOVEMENT_TECH.grappleSpeed).toBe(12.5);
    expect(MOVEMENT_TECH.grapplePull).toBe(54);
    expect(MOVEMENT_TECH.grappleArrive).toBe(1.35);
    expect(MOVEMENT_TECH.grappleReleaseSpeed).toBe(8.5);
    expect(MOVEMENT_TECH.grappleCooldownTicks).toBe(360);
  });

  describe('ability gates', () => {
    it('blocks slide, dash, double-jump, and grapple when abilities are locked', () => {
      const locked = defaultAbilities();
      const state = createMovementTechState();
      const hitWall: MovementRaycastFn = () => ({ point: { x: 0, y: 2, z: 10 }, dist: 10 });

      const slideRes = stepMovementTech(
        state,
        makeInput({ sprinting: true, slidePressed: true, vel: { x: 0, y: 0, z: 8 } }),
        locked,
        false,
      );
      expect(slideRes.active).toBeNull();
      expect(state.slidingTicks).toBe(0);

      const dashRes = stepMovementTech(state, makeInput({ dashPressed: true }), locked, false);
      expect(dashRes.active).toBeNull();
      expect(state.dashTicks).toBe(0);

      const djRes = stepMovementTech(
        state,
        makeInput({ grounded: false, jumpPressed: true }),
        locked,
        false,
      );
      expect(djRes.doubleJumped).toBe(false);
      expect(state.doubleJumpUsed).toBe(false);

      const grapRes = stepMovementTech(
        state,
        makeInput({ grappleHeld: true }),
        locked,
        false,
        1,
        hitWall,
      );
      expect(grapRes.active).toBeNull();
      expect(state.grapple).toBeNull();
    });
  });

  describe('mount disable', () => {
    it('disables all movement tech while mounted and cancels active tech', () => {
      const state = createMovementTechState();
      // Start a dash while unmounted
      const start = stepMovementTech(state, makeInput({ dashPressed: true }), ALL_ABILITIES, false);
      expect(start.active).toBe('dash');
      expect(state.dashTicks).toBeGreaterThan(0);

      // Mounting cancels active dash and blocks new tech
      const mountedRes = stepMovementTech(
        state,
        makeInput({
          grounded: false,
          sprinting: true,
          slidePressed: true,
          dashPressed: true,
          jumpPressed: true,
          grappleHeld: true,
        }),
        ALL_ABILITIES,
        true,
        1,
        () => ({ point: { x: 0, y: 2, z: 10 }, dist: 10 }),
      );
      expect(mountedRes.active).toBeNull();
      expect(mountedRes.overrideHorizontal).toBe(false);
      expect(mountedRes.suppressGravity).toBe(false);
      expect(mountedRes.doubleJumped).toBe(false);
      expect(mountedRes.invulnTicks).toBe(0);
      expect(state.dashTicks).toBe(0);
      expect(state.slidingTicks).toBe(0);
      expect(state.grapple).toBeNull();
    });
  });

  describe('slide & slide-hop', () => {
    it('boosts to slideBoost when sprinting, decays toward slideCruise, and ends after slideTicks', () => {
      const state = createMovementTechState();
      const vel = { x: 0, y: 0, z: 7.5 };
      const first = stepMovementTech(
        state,
        makeInput({ vel, sprinting: true, slidePressed: true }),
        ALL_ABILITIES,
        false,
      );
      expect(first.active).toBe('slide');
      expect(first.events).toContain('slideStart');
      expect(first.vel.z).toBeGreaterThan(14);
      expect(state.slidingTicks).toBe(MOVEMENT_TECH.slideTicks - 1);

      let ended = false;
      for (let i = 0; i < MOVEMENT_TECH.slideTicks + 2; i++) {
        const res = stepMovementTech(state, makeInput({ vel, grounded: true }), ALL_ABILITIES, false);
        if (res.events.includes('slideEnd')) {
          ended = true;
          break;
        }
      }
      expect(ended).toBe(true);
      expect(state.slidingTicks).toBe(0);
      expect(Math.hypot(vel.x, vel.z)).toBeLessThan(MOVEMENT_TECH.slideBoost);
      expect(Math.hypot(vel.x, vel.z)).toBeGreaterThanOrEqual(MOVEMENT_TECH.slideCruise - 0.5);
    });

    it('gains extra speed when sliding downhill via groundSlopeFn', () => {
      const flatState = createMovementTechState();
      const slopeState = createMovementTechState();
      const flatVel = { x: 0, y: 0, z: 8 };
      const slopeVel = { x: 0, y: 0, z: 8 };

      stepMovementTech(flatState, makeInput({ vel: flatVel, sprinting: true, slidePressed: true }), ALL_ABILITIES, false);
      stepMovementTech(
        slopeState,
        makeInput({ vel: slopeVel, sprinting: true, slidePressed: true }),
        ALL_ABILITIES,
        false,
        1,
        undefined,
        () => 0.35,
      );

      for (let i = 0; i < 15; i++) {
        stepMovementTech(flatState, makeInput({ vel: flatVel }), ALL_ABILITIES, false, 1, undefined, () => 0);
        stepMovementTech(slopeState, makeInput({ vel: slopeVel }), ALL_ABILITIES, false, 1, undefined, () => 0.35);
      }
      expect(slopeVel.z).toBeGreaterThan(flatVel.z + 1.5);
    });

    it('performs a slide-hop with slideHopBoost and applies slideHopCdTicks', () => {
      const state = createMovementTechState();
      const vel = { x: 0, y: 0, z: 8 };
      stepMovementTech(state, makeInput({ vel, sprinting: true, slidePressed: true }), ALL_ABILITIES, false);
      const speedBeforeHop = Math.hypot(vel.x, vel.z);

      const hop = stepMovementTech(state, makeInput({ vel, grounded: true, jumpPressed: true }), ALL_ABILITIES, false);
      expect(hop.slideHopped).toBe(true);
      expect(hop.events).toContain('slideHop');
      expect(state.slidingTicks).toBe(0);
      expect(state.slideHopCdTicks).toBe(MOVEMENT_TECH.slideHopCdTicks);
      expect(Math.hypot(vel.x, vel.z)).toBeCloseTo(speedBeforeHop * MOVEMENT_TECH.slideHopBoost, 5);
    });
  });

  describe('dash', () => {
    it('bursts at dashSpeed with i-frames, suppresses gravity, scales end speed, and respects cooldownMult', () => {
      const state = createMovementTechState();
      const vel = { x: 0, y: -5, z: 0 };
      const first = stepMovementTech(
        state,
        makeInput({ vel, grounded: false, wishX: 1, wishZ: 0, dashPressed: true }),
        ALL_ABILITIES,
        false,
        0.7, // Pepe Trickster Tempo rank 10 (-30% cooldown)
      );
      expect(first.active).toBe('dash');
      expect(first.events).toContain('dashStart');
      expect(first.suppressGravity).toBe(true);
      expect(first.vel.x).toBeCloseTo(MOVEMENT_TECH.dashSpeed, 5);
      expect(first.vel.y).toBe(0);
      expect(first.invulnTicks).toBe(MOVEMENT_TECH.dashInvulnTicks);
      expect(state.dashCdTicks).toBe(Math.round(MOVEMENT_TECH.dashCooldownTicks * 0.7));

      // Step through remaining dash ticks and verify invuln window expires before dash ends
      let sawZeroInvulnDuringDash = false;
      let ended = false;
      for (let i = 1; i < MOVEMENT_TECH.dashTicks; i++) {
        const res = stepMovementTech(state, makeInput({ vel, grounded: false }), ALL_ABILITIES, false, 0.7);
        if (res.invulnTicks === 0) sawZeroInvulnDuringDash = true;
        if (res.events.includes('dashEnd')) ended = true;
      }
      expect(sawZeroInvulnDuringDash).toBe(true);
      expect(ended).toBe(true);
      expect(state.dashTicks).toBe(0);
      expect(vel.x).toBeCloseTo(MOVEMENT_TECH.dashSpeed * MOVEMENT_TECH.dashEndScale, 5);
    });
  });

  describe('double-jump', () => {
    it('fires once per airtime and resets upon touching ground', () => {
      const state = createMovementTechState();
      const vel = { x: 0, y: -2, z: 0 };

      const dj1 = stepMovementTech(
        state,
        makeInput({ vel, grounded: false, jumpPressed: true }),
        ALL_ABILITIES,
        false,
      );
      expect(dj1.doubleJumped).toBe(true);
      expect(dj1.events).toContain('doubleJump');
      expect(vel.y).toBe(MOVEMENT_TECH.doubleJumpVel);
      expect(state.doubleJumpUsed).toBe(true);

      // Second mid-air jump is blocked
      vel.y = -1;
      const dj2 = stepMovementTech(
        state,
        makeInput({ vel, grounded: false, jumpPressed: true }),
        ALL_ABILITIES,
        false,
      );
      expect(dj2.doubleJumped).toBe(false);
      expect(vel.y).toBe(-1);

      // Landing resets doubleJumpUsed
      stepMovementTech(state, makeInput({ vel, grounded: true }), ALL_ABILITIES, false);
      expect(state.doubleJumpUsed).toBe(false);

      const dj3 = stepMovementTech(
        state,
        makeInput({ vel, grounded: false, jumpPressed: true }),
        ALL_ABILITIES,
        false,
      );
      expect(dj3.doubleJumped).toBe(true);
      expect(vel.y).toBe(MOVEMENT_TECH.doubleJumpVel);
    });
  });

  describe('grapple', () => {
    it('attaches to a solid raycast hit, pulls toward anchor, and releases on arrival with speed cap', () => {
      const state = createMovementTechState();
      const pos = { x: 0, y: 0, z: 0 };
      const vel = { x: 0, y: 0, z: 0 };
      const solidWall: MovementRaycastFn = (_origin, _dir, maxDist) => {
        if (maxDist >= 10) return { point: { x: 0, y: 2, z: 10 }, dist: 10, id: 'wall_1' };
        return null;
      };

      const attach = stepMovementTech(
        state,
        makeInput({ pos, vel, grappleHeld: true }),
        ALL_ABILITIES,
        false,
        0.7,
        solidWall,
      );
      expect(attach.active).toBe('grapple');
      expect(attach.events).toContain('grappleAttach');
      expect(attach.suppressGravity).toBe(true);
      expect(state.grapple?.active).toBe(true);
      expect(state.grappleCdTicks).toBe(Math.round(MOVEMENT_TECH.grappleCooldownTicks * 0.7));
      expect(vel.z).toBeGreaterThan(0);

      // Pull several ticks and check speed caps at grappleSpeed
      for (let i = 0; i < 20; i++) {
        stepMovementTech(state, makeInput({ pos, vel, grappleHeld: true }), ALL_ABILITIES, false, 1, () => null);
      }
      expect(Math.hypot(vel.x, vel.y, vel.z)).toBeLessThanOrEqual(MOVEMENT_TECH.grappleSpeed + 1e-4);

      // Move within arrive distance -> grapple arrives and clamps release speed
      pos.x = 0;
      pos.y = 1.1;
      pos.z = 9.5;
      const arrive = stepMovementTech(
        state,
        makeInput({ pos, vel, grappleHeld: true }),
        ALL_ABILITIES,
        false,
        1,
        () => null,
      );
      expect(arrive.events).toContain('grappleArrive');
      expect(state.grapple).toBeNull();
      expect(Math.hypot(vel.x, vel.y, vel.z)).toBeLessThanOrEqual(MOVEMENT_TECH.grappleReleaseSpeed + 1e-4);
    });

    it('snaps to grappleAnchors and rejects hooks inside noGrapple boxes', () => {
      const state = createMovementTechState();
      const anchors = [{ id: 'hook_a', at: [0.6, 2.0, 9.0] as const, r: 2.0 }];
      const attach = stepMovementTech(
        state,
        makeInput({ grappleHeld: true, grappleAnchors: anchors }),
        ALL_ABILITIES,
        false,
      );
      expect(attach.events).toContain('grappleAttach');
      expect(state.grapple?.anchor).toEqual({ x: 0.6, y: 2.0, z: 9.0 });
      expect(state.grapple?.anchorId).toBe('hook_a');

      // Now block that same anchor with a noGrapple box
      const blockedState = createMovementTechState();
      const miss = stepMovementTech(
        blockedState,
        makeInput({
          grappleHeld: true,
          grappleAnchors: anchors,
          noGrapple: [{ min: [-2, 0, 7], max: [2, 4, 11] }],
        }),
        ALL_ABILITIES,
        false,
      );
      expect(miss.events).toContain('grappleMiss');
      expect(blockedState.grapple).toBeNull();
    });

    it('releases grapple when line of sight is broken', () => {
      const state = createMovementTechState();
      const vel = { x: 0, y: 0, z: 0 };
      const attach = stepMovementTech(
        state,
        makeInput({ vel, grappleHeld: true, grappleAnchors: [{ id: 'a', at: [0, 2, 10] }] }),
        ALL_ABILITIES,
        false,
        1,
        () => null,
      );
      expect(attach.events).toContain('grappleAttach');

      // Obstruction appears 4 m in front of player (closer than anchor at 10 m)
      const losBlocked: MovementRaycastFn = () => ({ point: { x: 0, y: 1.8, z: 4 }, dist: 4 });
      const broken = stepMovementTech(
        state,
        makeInput({ vel, grappleHeld: true }),
        ALL_ABILITIES,
        false,
        1,
        losBlocked,
      );
      expect(broken.events).toContain('grappleRelease');
      expect(state.grapple).toBeNull();
    });
  });
});
