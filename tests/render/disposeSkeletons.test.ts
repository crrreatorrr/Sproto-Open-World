import * as THREE from 'three';
import { describe, expect, it, vi } from 'vitest';
import { disposeSkeletons } from '../../src/assets/AssetLoader';

describe('a skinned copy gives back its GPU bone texture', () => {
  it('disposes the skeleton of every skinned mesh under the root, and leaves other meshes alone', () => {
    const root = new THREE.Group();
    const skinned = new THREE.SkinnedMesh(new THREE.BufferGeometry(), new THREE.MeshBasicMaterial());
    const bone = new THREE.Bone();
    skinned.add(bone);
    skinned.bind(new THREE.Skeleton([bone]));
    const spy = vi.spyOn(skinned.skeleton, 'dispose');
    root.add(skinned, new THREE.Mesh(new THREE.BufferGeometry(), new THREE.MeshBasicMaterial()));
    disposeSkeletons(root);
    expect(spy).toHaveBeenCalledTimes(1);
  });
});
