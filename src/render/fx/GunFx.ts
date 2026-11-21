import * as THREE from 'three';
import type { GunElement, GunType } from '../../content/guns';
import { glowTexture } from './textures';

type P3 = { x: number; y: number; z: number };

/** How long each mark of a shot stays (s), and its width (m). */
const TRACER = { life: 0.06, sniperLife: 0.16, width: 0.022, max: 48 } as const;
const BEAM = { life: 0.16, core: 0.035, glow: 0.12 } as const;
const FLASH = { life: 0.05, max: 6 } as const;
/** Flash size (m) by gun: small for the rapid ones, big for the heavy ones. */
const FLASH_SIZE: Partial<Record<GunType, number>> = { mg: 0.28, machinepistol: 0.24, handgun: 0.28, raygun: 0.26, bigbullets: 0.9, bazooka: 0.8 };
const FLASH_DEFAULT = 0.55;

const COLOR: Record<GunElement | 'none', number> = { none: 0xfff1b8, fire: 0xff8a3c, shock: 0x7fe9ff, goo: 0x9dff6a };

interface Streak {
  mesh: THREE.Mesh<THREE.BufferGeometry, THREE.MeshBasicMaterial>;
  age: number;
  life: number;
  width: number;
}

const Z = new THREE.Vector3(0, 0, 1);

/**
 * What a gun shot looks like (gun shooting design §2): a short bright streak from the barrel to
 * where each hitscan ray ended, a flash at the barrel, and the raygun's beam. All pooled.
 */
export class GunFx {
  readonly root = new THREE.Group();
  private readonly streaks: Streak[] = [];
  private readonly flashes: (THREE.Sprite & { age: number })[] = [];
  private next = 0;
  private nextFlash = 0;
  private readonly a = new THREE.Vector3();
  private readonly b = new THREE.Vector3();
  private readonly q = new THREE.Quaternion();

  constructor() {
    // A unit bar along +Z, two crossed planes so it reads from any side.
    const geo = new THREE.BufferGeometry();
    const v = new Float32Array([
      -0.5, 0, 0, 0.5, 0, 0, 0.5, 0, 1, -0.5, 0, 0, 0.5, 0, 1, -0.5, 0, 1,
      0, -0.5, 0, 0, 0.5, 0, 0, 0.5, 1, 0, -0.5, 0, 0, 0.5, 1, 0, -0.5, 1,
    ]);
    geo.setAttribute('position', new THREE.BufferAttribute(v, 3));
    for (let i = 0; i < TRACER.max; i++) {
      const mesh = new THREE.Mesh(geo, new THREE.MeshBasicMaterial({ color: COLOR.none, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, side: THREE.DoubleSide, fog: false }));
      mesh.visible = false;
      mesh.frustumCulled = false;
      mesh.renderOrder = 6;
      this.streaks.push({ mesh, age: 0, life: 0, width: TRACER.width });
      this.root.add(mesh);
    }
    for (let i = 0; i < FLASH.max; i++) {
      const s = new THREE.Sprite(new THREE.SpriteMaterial({ map: glowTexture(), color: COLOR.none, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, fog: false })) as THREE.Sprite & { age: number };
      s.age = FLASH.life;
      s.visible = false;
      s.renderOrder = 7;
      this.flashes.push(s);
      this.root.add(s);
    }
  }

  /** One shot's marks. `from` is the barrel; each of `ends` is where a ray stopped. */
  shot(gun: GunType, element: GunElement | null, from: P3, ends: readonly P3[]): void {
    const color = COLOR[element ?? 'none'];
    const flash = this.flashes[this.nextFlash++ % FLASH.max];
    flash.position.set(from.x, from.y, from.z);
    flash.scale.setScalar(FLASH_SIZE[gun] ?? FLASH_DEFAULT);
    flash.material.color.setHex(color);
    flash.material.opacity = 1;
    flash.material.rotation = (this.nextFlash * 2.399) % (Math.PI * 2);
    flash.age = 0;
    flash.visible = true;
    for (const end of ends) {
      if (gun === 'raygun') {
        this.streak(from, end, color, BEAM.life, BEAM.glow, 0.45);
        this.streak(from, end, 0xffffff, BEAM.life, BEAM.core, 1);
      } else {
        this.streak(from, end, color, gun === 'sniper' ? TRACER.sniperLife : TRACER.life, gun === 'sniper' ? TRACER.width * 1.6 : TRACER.width, 0.9);
      }
    }
  }

  private streak(from: P3, to: P3, color: number, life: number, width: number, opacity: number): void {
    this.a.set(from.x, from.y, from.z);
    this.b.set(to.x, to.y, to.z).sub(this.a);
    const len = this.b.length();
    if (len < 0.05) return;
    const s = this.streaks[this.next++ % TRACER.max];
    s.mesh.position.copy(this.a);
    s.mesh.quaternion.copy(this.q.setFromUnitVectors(Z, this.b.multiplyScalar(1 / len)));
    s.mesh.scale.set(width, width, len);
    s.mesh.material.color.setHex(color);
    s.mesh.material.opacity = opacity;
    s.mesh.userData.opacity = opacity;
    s.mesh.visible = true;
    s.age = 0;
    s.life = life;
    s.width = width;
  }

  update(dt: number): void {
    for (const s of this.streaks) {
      if (!s.mesh.visible) continue;
      s.age += dt;
      const k = 1 - s.age / s.life;
      if (k <= 0) {
        s.mesh.visible = false;
        continue;
      }
      s.mesh.material.opacity = (s.mesh.userData.opacity as number) * k;
      s.mesh.scale.x = s.mesh.scale.y = s.width * (0.4 + 0.6 * k);
    }
    for (const f of this.flashes) {
      if (!f.visible) continue;
      f.age += dt;
      if (f.age >= FLASH.life) f.visible = false;
      else f.material.opacity = 1 - f.age / FLASH.life;
    }
  }

  clear(): void {
    for (const s of this.streaks) s.mesh.visible = false;
    for (const f of this.flashes) f.visible = false;
  }
}
