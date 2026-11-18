import * as THREE from 'three';
import { describe, expect, it } from 'vitest';
import { Animator, ENTRY_FADE } from '../../src/render/anim/Animator';

/** The bone moves from 0 to 1 over the clip's second, so its position reads as the pose shown. */
function rig() {
  const bone = new THREE.Object3D();
  const clip = new THREE.AnimationClip('swing', 1, [new THREE.VectorKeyframeTrack('.position', [0, 1], [0, 0, 0, 1, 0, 0])]);
  const anim = new Animator(bone, [clip]);
  anim.scrub('swing', 0.9);
  anim.update(1);
  return { bone, anim };
}

describe('starting over the clip already showing', () => {
  it('crossfades from the old pose instead of snapping to the new one', () => {
    const { bone, anim } = rig();
    expect(bone.position.x).toBeCloseTo(0.9, 3);
    anim.scrub('swing', 0, ENTRY_FADE, true);
    anim.update(ENTRY_FADE / 2);
    expect(bone.position.x).toBeGreaterThan(0.3);
    expect(bone.position.x).toBeLessThan(0.6);
  });

  it('ends fully on the new pose, and keeps following the scrub', () => {
    const { bone, anim } = rig();
    anim.scrub('swing', 0, ENTRY_FADE, true);
    anim.update(ENTRY_FADE * 2);
    anim.scrub('swing', 0.25);
    anim.update(0);
    expect(bone.position.x).toBeCloseTo(0.25, 3);
    expect(anim.currentClip).toBe('swing');
  });

  it('can start over again and again', () => {
    const { bone, anim } = rig();
    for (const t of [0.1, 0.2, 0.3]) {
      anim.scrub('swing', t, ENTRY_FADE, true);
      anim.update(ENTRY_FADE * 2);
      expect(bone.position.x).toBeCloseTo(t, 3);
    }
  });

  it('crossfades on the upper body too (attacks from the saddle)', () => {
    const bone = new THREE.Object3D();
    bone.name = 'mixamorigRightArm';
    const clip = new THREE.AnimationClip('swing', 1, [new THREE.VectorKeyframeTrack('mixamorigRightArm.position', [0, 1], [0, 0, 0, 1, 0, 0])]);
    const anim = new Animator(bone, [clip]);
    anim.upper('swing', 0.9, 0);
    anim.update(1);
    const before = bone.position.x;
    anim.upper('swing', 0, ENTRY_FADE, true);
    anim.update(ENTRY_FADE / 2);
    expect(bone.position.x).toBeGreaterThan(before * 0.3);
    expect(bone.position.x).toBeLessThan(before * 0.7);
  });

  it('without the flag, a scrub just moves the pose', () => {
    const { bone, anim } = rig();
    anim.scrub('swing', 0.4);
    anim.update(0);
    expect(bone.position.x).toBeCloseTo(0.4, 3);
  });
});
