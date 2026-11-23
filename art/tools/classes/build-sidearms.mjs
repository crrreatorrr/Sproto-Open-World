#!/usr/bin/env node
/**
 * The two sidearms Sproto Shooter has no model for: the Handgun and the Machine Pistol (the dual-wield
 * guns). Built here from boxes in the toy guns' colours, to the same contract as build-guns.mjs:
 * origin at the right hand's grip, +Z along the barrel, +Y up, metres, and a `muzzle` node at the
 * barrel tip. Sized as the real things: a 0.21 m pistol and a 0.30 m machine pistol.
 *
 *   node art/tools/classes/build-sidearms.mjs
 */
import { Document } from '@gltf-transform/core';
import fs from 'node:fs';
import { io } from './rig.mjs';

const OUT = 'public/assets/models/guns';
const BLUE = [0.1, 0.32, 0.85], RED = [0.85, 0.13, 0.12], YELLOW = [0.95, 0.72, 0.1], DARK = [0.12, 0.13, 0.16];
/** Boxes: [colour, centre x y z, size x y z, pitch about X in radians]. The grip is at the origin. */
const GUNS = {
  handgun: {
    muzzle: [0, 0.062, 0.165],
    boxes: [
      [YELLOW, [0, -0.012, -0.006], [0.034, 0.105, 0.05], -0.2],
      [BLUE, [0, 0.06, 0.055], [0.036, 0.046, 0.2], 0],
      [RED, [0, 0.062, 0.158], [0.026, 0.028, 0.024], 0],
      [DARK, [0, 0.024, 0.05], [0.012, 0.03, 0.052], 0],
      [RED, [0, 0.089, -0.03], [0.012, 0.012, 0.02], 0],
      [RED, [0, 0.089, 0.138], [0.008, 0.012, 0.012], 0],
    ],
  },
  machinepistol: {
    muzzle: [0, 0.066, 0.25],
    boxes: [
      [YELLOW, [0, -0.012, -0.006], [0.036, 0.11, 0.052], -0.2],
      [BLUE, [0, 0.064, 0.07], [0.042, 0.06, 0.25], 0],
      [RED, [0, 0.066, 0.215], [0.028, 0.03, 0.07], 0],
      [DARK, [0, 0.026, 0.052], [0.012, 0.03, 0.054], 0],
      [YELLOW, [0, -0.045, 0.1], [0.026, 0.15, 0.034], 0.1],
      [RED, [0, 0.1, -0.03], [0.012, 0.012, 0.02], 0],
      [RED, [0, 0.1, 0.17], [0.008, 0.012, 0.012], 0],
      [DARK, [0, 0.064, -0.075], [0.03, 0.04, 0.04], 0],
    ],
  },
};

/** A flat-shaded box: 24 vertices, 12 triangles, turned about X through its own centre. */
function box(centre, size, pitch) {
  const [hx, hy, hz] = size.map((v) => v / 2);
  const faces = [
    [[1, 0, 0], [[hx, -hy, -hz], [hx, hy, -hz], [hx, hy, hz], [hx, -hy, hz]]],
    [[-1, 0, 0], [[-hx, -hy, hz], [-hx, hy, hz], [-hx, hy, -hz], [-hx, -hy, -hz]]],
    [[0, 1, 0], [[-hx, hy, -hz], [-hx, hy, hz], [hx, hy, hz], [hx, hy, -hz]]],
    [[0, -1, 0], [[-hx, -hy, hz], [-hx, -hy, -hz], [hx, -hy, -hz], [hx, -hy, hz]]],
    [[0, 0, 1], [[hx, -hy, hz], [hx, hy, hz], [-hx, hy, hz], [-hx, -hy, hz]]],
    [[0, 0, -1], [[-hx, -hy, -hz], [-hx, hy, -hz], [hx, hy, -hz], [hx, -hy, -hz]]],
  ];
  const c = Math.cos(pitch), s = Math.sin(pitch);
  const turn = ([x, y, z]) => [x, y * c - z * s, y * s + z * c];
  const positions = [], normals = [], indices = [];
  for (const [normal, corners] of faces) {
    const at = positions.length / 3;
    for (const corner of corners) {
      const p = turn(corner);
      positions.push(p[0] + centre[0], p[1] + centre[1], p[2] + centre[2]);
      normals.push(...turn(normal));
    }
    indices.push(at, at + 1, at + 2, at, at + 2, at + 3);
  }
  return { positions, normals, indices };
}

fs.mkdirSync(OUT, { recursive: true });
for (const [id, gun] of Object.entries(GUNS)) {
  const doc = new Document();
  const buffer = doc.createBuffer();
  const mesh = doc.createMesh(`gun_${id}`);
  const byColour = new Map();
  for (const [colour, centre, size, pitch] of gun.boxes) {
    const key = colour.join(',');
    if (!byColour.has(key)) byColour.set(key, { colour, positions: [], normals: [], indices: [] });
    const part = byColour.get(key), made = box(centre, size, pitch), base = part.positions.length / 3;
    part.positions.push(...made.positions);
    part.normals.push(...made.normals);
    part.indices.push(...made.indices.map((i) => i + base));
  }
  for (const part of byColour.values()) {
    const material = doc.createMaterial().setBaseColorFactor([...part.colour, 1]).setRoughnessFactor(0.55).setMetallicFactor(0.05);
    mesh.addPrimitive(doc.createPrimitive()
      .setAttribute('POSITION', doc.createAccessor().setType('VEC3').setArray(new Float32Array(part.positions)).setBuffer(buffer))
      .setAttribute('NORMAL', doc.createAccessor().setType('VEC3').setArray(new Float32Array(part.normals)).setBuffer(buffer))
      .setIndices(doc.createAccessor().setType('SCALAR').setArray(new Uint16Array(part.indices)).setBuffer(buffer))
      .setMaterial(material));
  }
  const root = doc.createNode(`gun_${id}`).setMesh(mesh);
  root.setExtras({ contract: 'origin = right-hand grip, +Z = barrel (muzzle end), +Y = top of the gun, metres; parent under socket_weapon with an identity transform' });
  root.addChild(doc.createNode('muzzle').setTranslation(gun.muzzle));
  doc.createScene().addChild(root);
  doc.getRoot().setDefaultScene(doc.getRoot().listScenes()[0]);
  const file = `${OUT}/gun_${id}.glb`;
  fs.writeFileSync(file, await io.writeBinary(doc));
  console.log(`wrote ${file}: ${(fs.statSync(file).size / 1024).toFixed(1)} KiB, ${gun.boxes.length * 12} triangles`);
}
