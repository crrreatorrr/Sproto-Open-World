/**
 * Lightweight Free 1v1 PvP Arena runner (`?pvp=1` or Title Screen "Free 1v1 Arena").
 *
 * Drives the pure deterministic 30 Hz zero-Rapier PvP sim (`src/sim/pvp/sim.ts`, Sim v3 — no
 * Second Wind) with Seat 0 controlled by keyboard/mouse or gamepad and Seat 1 driven by a
 * deterministic sparring bot.
 */
import * as THREE from 'three';
import { ARENA_R, ARENA_SOLIDS, ARENA_WALL_H } from '../sim/pvp/arena';
import { DT, MATCH_TICKS, PVP_SIM_VERSION, PVP_TUNING, STOCK_GUNS } from '../sim/pvp/rules';
import { createMatch, stepMatch, yawTo, type PartialPvpWish, type PvpMatchState, type PvpShotEvent } from '../sim/pvp/sim';

function botWish(state: PvpMatchState): PartialPvpWish {
  const me = state.players[1];
  const opp = state.players[0];
  const dx = opp.x - me.x;
  const dz = opp.z - me.z;
  const dist = Math.hypot(dx, dz) || 1;
  const yaw = yawTo(me, opp);
  const dy = (opp.y + 1.1) - (me.y + 1.6);
  const pitch = Math.atan2(dy, dist);
  const strafe = Math.sin(state.tick * 0.05) >= 0 ? 1 : -1;
  const advance = dist > 18 ? 1 : dist < 9 ? -0.6 : 0;
  return {
    yaw,
    pitch,
    moveX: strafe * 0.75,
    moveZ: advance,
    fire: dist < 34 && state.tick % 6 < 3,
    dash: dist < 14 && state.tick % 90 === 0,
    jump: state.tick % 75 === 0,
    reload: me.mag[me.slot] === 0,
    slot: dist > 26 ? 2 : dist < 10 ? 1 : 0,
  };
}

export function startPvpArena(host: HTMLElement): () => void {
  const renderer = new THREE.WebGLRenderer({ antialias: true });
  renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
  renderer.setSize(window.innerWidth, window.innerHeight);
  host.replaceChildren(renderer.domElement);

  const scene = new THREE.Scene();
  scene.background = new THREE.Color(0x161d2e);
  scene.fog = new THREE.Fog(0x161d2e, 40, 120);

  const camera = new THREE.PerspectiveCamera(75, window.innerWidth / window.innerHeight, 0.1, 200);

  scene.add(new THREE.HemisphereLight(0xcbe2ff, 0x2a2433, 0.9));
  const sun = new THREE.DirectionalLight(0xfff1d6, 1.1);
  sun.position.set(22, 38, 16);
  scene.add(sun);

  const floor = new THREE.Mesh(
    new THREE.CircleGeometry(ARENA_R, 48),
    new THREE.MeshStandardMaterial({ color: 0x2b3347, roughness: 0.9 }),
  );
  floor.rotation.x = -Math.PI / 2;
  scene.add(floor);

  const wall = new THREE.Mesh(
    new THREE.CylinderGeometry(ARENA_R, ARENA_R, ARENA_WALL_H, 48, 1, true),
    new THREE.MeshStandardMaterial({ color: 0x3b4661, side: THREE.BackSide, roughness: 0.85 }),
  );
  wall.position.y = ARENA_WALL_H / 2;
  scene.add(wall);

  const pillarMat = new THREE.MeshStandardMaterial({ color: 0x5c6b8a, roughness: 0.75 });
  for (const box of ARENA_SOLIDS) {
    const sx = box.max[0] - box.min[0];
    const sy = box.max[1] - box.min[1];
    const sz = box.max[2] - box.min[2];
    const mesh = new THREE.Mesh(new THREE.BoxGeometry(sx, sy, sz), pillarMat);
    mesh.position.set((box.min[0] + box.max[0]) / 2, (box.min[1] + box.max[1]) / 2, (box.min[2] + box.max[2]) / 2);
    scene.add(mesh);
  }

  const oppMat = new THREE.MeshStandardMaterial({ color: 0xff5a5f, emissive: 0x3a0c10, roughness: 0.5 });
  const oppMesh = new THREE.Mesh(new THREE.CapsuleGeometry(PVP_TUNING.playerRadius, 1.0, 6, 12), oppMat);
  scene.add(oppMesh);

  // HUD overlay
  const hud = document.createElement('div');
  hud.style.cssText = 'position:fixed;inset:0;pointer-events:none;font:600 14px/1.4 system-ui,sans-serif;color:#eef3ff;text-shadow:0 1px 3px #000';
  const topBar = document.createElement('div');
  topBar.style.cssText = 'position:absolute;top:14px;left:50%;transform:translateX(-50%);background:rgba(12,16,28,.75);padding:6px 14px;border-radius:8px;white-space:nowrap';
  const botBar = document.createElement('div');
  botBar.style.cssText = 'position:absolute;bottom:18px;left:50%;transform:translateX(-50%);background:rgba(12,16,28,.75);padding:8px 16px;border-radius:8px;white-space:nowrap';
  const cross = document.createElement('div');
  cross.textContent = '+';
  cross.style.cssText = 'position:absolute;top:50%;left:50%;transform:translate(-50%,-50%);font-size:20px;opacity:.85';
  const banner = document.createElement('div');
  banner.style.cssText = 'position:absolute;top:36%;left:50%;transform:translate(-50%,-50%);display:none;flex-direction:column;align-items:center;gap:10px;background:rgba(12,16,28,.9);padding:20px 28px;border-radius:12px;pointer-events:auto';
  hud.append(topBar, botBar, cross, banner);
  host.append(hud);

  let seed = 7;
  let state = createMatch(seed);
  let yaw = state.players[0].yaw;
  let pitch = 0;
  let slot = 0;
  let firing = false;
  let zooming = false;
  let hitFlash = 0;
  const keys = new Set<string>();

  const exitToTitle = () => {
    const url = new URL(window.location.href);
    url.searchParams.delete('pvp');
    window.location.assign(url.toString());
  };

  const resetMatch = () => {
    seed += 1;
    state = createMatch(seed);
    yaw = state.players[0].yaw;
    pitch = 0;
    slot = 0;
    banner.style.display = 'none';
  };

  const onKeyDown = (e: KeyboardEvent) => {
    keys.add(e.code);
    if (e.code === 'Digit1') slot = 0;
    else if (e.code === 'Digit2') slot = 1;
    else if (e.code === 'Digit3') slot = 2;
    else if (e.code === 'Escape' && state.phase === 'done') exitToTitle();
    else if (e.code === 'KeyR' && state.phase === 'done') resetMatch();
  };
  const onKeyUp = (e: KeyboardEvent) => keys.delete(e.code);
  const onMouseDown = (e: MouseEvent) => {
    if (document.pointerLockElement !== renderer.domElement && state.phase === 'live') {
      renderer.domElement.requestPointerLock?.();
    }
    if (e.button === 0) firing = true;
    if (e.button === 2) zooming = true;
  };
  const onMouseUp = (e: MouseEvent) => {
    if (e.button === 0) firing = false;
    if (e.button === 2) zooming = false;
  };
  const onMouseMove = (e: MouseEvent) => {
    if (document.pointerLockElement !== renderer.domElement) return;
    const sens = zooming ? 0.0014 : 0.0024;
    yaw -= e.movementX * sens;
    pitch = Math.max(-1.35, Math.min(1.35, pitch - e.movementY * sens));
  };
  const onContext = (e: Event) => e.preventDefault();
  const onResize = () => {
    camera.aspect = window.innerWidth / window.innerHeight;
    camera.updateProjectionMatrix();
    renderer.setSize(window.innerWidth, window.innerHeight);
  };

  window.addEventListener('keydown', onKeyDown);
  window.addEventListener('keyup', onKeyUp);
  window.addEventListener('mousedown', onMouseDown);
  window.addEventListener('mouseup', onMouseUp);
  window.addEventListener('mousemove', onMouseMove);
  window.addEventListener('contextmenu', onContext);
  window.addEventListener('resize', onResize);

  let acc = 0;
  let last = performance.now();
  let raf = 0;
  let prevPadStart = false;

  const loop = (now: number) => {
    raf = requestAnimationFrame(loop);
    const dt = Math.min(0.1, (now - last) / 1000);
    last = now;

    // Gamepad polling
    const pad = navigator.getGamepads?.().find((g) => g?.connected) ?? null;
    let moveX = (keys.has('KeyD') ? 1 : 0) - (keys.has('KeyA') ? 1 : 0);
    let moveZ = (keys.has('KeyW') ? 1 : 0) - (keys.has('KeyS') ? 1 : 0);
    let padFire = false;
    let padZoom = false;
    let padJump = false;
    let padDash = false;
    let padReload = false;
    let padSlide = false;
    if (pad) {
      const dead = (v: number) => (Math.abs(v) < 0.16 ? 0 : v);
      moveX = Math.max(-1, Math.min(1, moveX + dead(pad.axes[0] ?? 0)));
      moveZ = Math.max(-1, Math.min(1, moveZ - dead(pad.axes[1] ?? 0)));
      yaw -= dead(pad.axes[2] ?? 0) * dt * (zooming ? 1.5 : 2.6);
      pitch = Math.max(-1.35, Math.min(1.35, pitch - dead(pad.axes[3] ?? 0) * dt * (zooming ? 1.2 : 2.0)));
      padFire = (pad.buttons[7]?.value ?? 0) > 0.35;
      padZoom = (pad.buttons[6]?.value ?? 0) > 0.35;
      padJump = Boolean(pad.buttons[0]?.pressed);
      padDash = Boolean(pad.buttons[1]?.pressed);
      padReload = Boolean(pad.buttons[2]?.pressed);
      padSlide = Boolean(pad.buttons[4]?.pressed);
      const startNow = Boolean(pad.buttons[9]?.pressed);
      if (startNow && !prevPadStart) exitToTitle();
      prevPadStart = startNow;
      if (state.phase === 'done') {
        if (pad.buttons[0]?.pressed) resetMatch();
        if (pad.buttons[1]?.pressed) exitToTitle();
      }
    }

    acc += dt;
    while (acc >= DT) {
      acc -= DT;
      if (state.phase === 'live') {
        const events: PvpShotEvent[] = [];
        stepMatch(state, [{
          yaw,
          pitch,
          moveX,
          moveZ,
          fire: firing || padFire,
          zoom: zooming || padZoom,
          sprint: keys.has('ShiftLeft'),
          jump: keys.has('Space') || padJump,
          dash: keys.has('KeyQ') || padDash,
          reload: keys.has('KeyR') || padReload,
          slide: keys.has('KeyC') || padSlide,
          slot,
        }, botWish(state)], events);
        if (events.some((ev) => ev.shooter === 0 && ev.hits > 0)) hitFlash = 0.14;
      }
    }

    const p0 = state.players[0];
    const p1 = state.players[1];
    camera.fov = p0.zooming ? (p0.slot === 2 ? 32 : 55) : 75;
    camera.updateProjectionMatrix();
    camera.position.set(p0.x, p0.y + (p0.slideT > 0 ? 0.9 : 1.6), p0.z);
    camera.rotation.order = 'YXZ';
    camera.rotation.y = p0.yaw;
    camera.rotation.x = p0.pitch;

    oppMesh.visible = p1.alive;
    oppMesh.position.set(p1.x, p1.y + 0.9, p1.z);
    hitFlash = Math.max(0, hitFlash - dt);
    oppMat.emissive.setHex(hitFlash > 0 ? 0xffffff : 0x3a0c10);

    const secsLeft = Math.max(0, Math.ceil((MATCH_TICKS - state.tick) * DT));
    const gun = STOCK_GUNS[p0.slot]!;
    topBar.textContent = `FREE 1v1 ARENA (SIM v${PVP_SIM_VERSION})  ·  ${secsLeft}s  ·  BOT HP ${Math.ceil(p1.hp / 1000)} / SH ${Math.ceil(p1.shield / 1000)}`;
    botBar.textContent = `HP ${Math.ceil(p0.hp / 1000)}  SH ${Math.ceil(p0.shield / 1000)}  ·  [${p0.slot + 1}] ${gun.name} ${p0.mag[p0.slot]}/${gun.stats.magSize}  ·  Click to aim · 1/2/3 Guns · Esc Exit`;

    if (state.phase === 'done' && banner.style.display === 'none') {
      document.exitPointerLock?.();
      const title = state.winner === 0 ? 'VICTORY' : state.winner === 1 ? 'DEFEAT' : 'DRAW';
      banner.replaceChildren();
      const h = document.createElement('div');
      h.textContent = `${title} (${state.reason ?? state.outcome ?? 'end'})`;
      h.style.fontSize = '24px';
      const again = document.createElement('button');
      again.textContent = 'Rematch (R / A)';
      again.onclick = resetMatch;
      const back = document.createElement('button');
      back.textContent = 'Back to Title (Esc / B)';
      back.onclick = exitToTitle;
      banner.append(h, again, back);
      banner.style.display = 'flex';
    }

    renderer.render(scene, camera);
  };
  raf = requestAnimationFrame(loop);

  return () => {
    cancelAnimationFrame(raf);
    window.removeEventListener('keydown', onKeyDown);
    window.removeEventListener('keyup', onKeyUp);
    window.removeEventListener('mousedown', onMouseDown);
    window.removeEventListener('mouseup', onMouseUp);
    window.removeEventListener('mousemove', onMouseMove);
    window.removeEventListener('contextmenu', onContext);
    window.removeEventListener('resize', onResize);
    renderer.dispose();
  };
}
