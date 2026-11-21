/** A point in the world (m). Plain numbers, so the maths runs in Node tests without three. */
export interface Point3 {
  x: number;
  y: number;
  z: number;
}

/**
 * Move the shadow box's centre onto the shadow map's own texel grid.
 *
 * The sun's shadow box follows the player. Centred on them exactly, the map's texels slide over the
 * world by a fraction of a texel every frame, and every shadow edge crawls while the player moves.
 * Snapped, the box moves in whole texels and a shadow that isn't moving is drawn the same way every
 * frame. `sunOffset` is where the light sits from the box's centre (it looks back along it with +y
 * up, as three's DirectionalLight does); `texel` is the size of one shadow texel in the world (m).
 */
export function snapToShadowTexels(target: Readonly<Point3>, sunOffset: Readonly<Point3>, texel: number): Point3 {
  const l = Math.hypot(sunOffset.x, sunOffset.y, sunOffset.z);
  if (!(l > 1e-6) || !(texel > 0)) return { x: target.x, y: target.y, z: target.z };
  const dx = sunOffset.x / l, dy = sunOffset.y / l, dz = sunOffset.z / l;
  // The map's axes in the world: right = up × d, and the map's up = d × right.
  let rx = dz, rz = -dx;
  const rl = Math.hypot(rx, rz);
  // A sun straight overhead has no "right" from the up vector: any flat axis will do.
  if (rl < 1e-6) {
    rx = 1;
    rz = 0;
  } else {
    rx /= rl;
    rz /= rl;
  }
  const ux = dy * rz, uy = dz * rx - dx * rz, uz = -dy * rx;
  const u = target.x * rx + target.z * rz;
  const v = target.x * ux + target.y * uy + target.z * uz;
  const du = u - Math.round(u / texel) * texel;
  const dv = v - Math.round(v / texel) * texel;
  return { x: target.x - rx * du - ux * dv, y: target.y - uy * dv, z: target.z - rz * du - uz * dv };
}
