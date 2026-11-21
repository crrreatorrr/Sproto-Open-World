/**
 * Contact sheet of a playable body's layered poses, drawn with the game's own loader pieces
 * (prepareRig, Animator and its upper/lower split), so a cell shows what the game would.
 * Dev server only: http://localhost:5180/tools/qa/sheet.html?body=player_pepe&weapon=gun_mg
 *
 *   body    a MODELS key (player, player_soldier, player_pepe, player_pepe_warrior)
 *   weapon  a MODELS key (gun_* mounts on socket_weapon, anything else on socket_staff)
 *   rows    comma list of base[+upper] states, e.g. idle+aim,run+reload,slide
 *   view    front | side | back | q (three-quarter, the default) | top
 *   cols    samples per row (default 6)
 *   weapons comma list: one column per weapon instead of per time sample (each row at its `at` fraction)
 *   views   comma list: one column per view instead (each row at its `at` fraction)
 *   zoom    magnify each cell about `y` metres up the body (hands: zoom=2.6&y=1.05)
 *   at      clip fraction for `weapons` and `views` columns (default 0)
 */
import * as THREE from 'three';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { MeshoptDecoder } from 'three/examples/jsm/libs/meshopt_decoder.module.js';
import { clone as cloneSkinned } from 'three/examples/jsm/utils/SkeletonUtils.js';
import { MODELS, STAFF_SOCKET, WEAPON_SOCKET, type ModelKey } from '../../src/assets/manifest';
import { prepareRig } from '../../src/assets/rig';
import { Animator } from '../../src/render/anim/Animator';
import { leftHandGrips, relaxHand, squareGun } from '../../src/render/anim/gunPose';

const params = new URLSearchParams(location.search);
const bodyKey = (params.get('body') ?? 'player_pepe') as ModelKey;
const weaponKey = (params.get('weapon') ?? 'gun_mg') as ModelKey;
const isGun = weaponKey.startsWith('gun_');
const rows = (params.get('rows') ?? (isGun
  ? 'idle+hold,run+hold,idle+aim,run+aim,idle+shoot,idle+reload,slide+hold,dash+hold'
  : 'idle,run,cast,attack_light_1,block,slide,dash')).split(',');
const weaponKeys = params.get('weapons')?.split(',') as ModelKey[] | undefined;
const viewList = params.get('views')?.split(',');
const cols = weaponKeys?.length ?? viewList?.length ?? Number(params.get('cols') ?? 6);
const fixedAt = Number(params.get('at') ?? 0);
const zoom = Number(params.get('zoom') ?? 1);
const zoomY = Number(params.get('y') ?? 0.9);
const view = params.get('view') ?? 'q';

const renderer = new THREE.WebGLRenderer({ antialias: true, preserveDrawingBuffer: true });
renderer.setPixelRatio(1);
renderer.setSize(innerWidth, innerHeight);
document.body.appendChild(renderer.domElement);
const scene = new THREE.Scene();
scene.background = new THREE.Color(0x8a93a0);
scene.add(new THREE.HemisphereLight(0xffffff, 0x556070, 2.2));
const sun = new THREE.DirectionalLight(0xffffff, 2);
sun.position.set(2, 5, 4);
scene.add(sun);

const loader = new GLTFLoader().setMeshoptDecoder(MeshoptDecoder);
const load = async (key: ModelKey) => loader.loadAsync(`/assets/${MODELS[key].path}`);
const [body, ...weapons] = await Promise.all([load(bodyKey), ...(weaponKeys ?? [weaponKey]).map(load)]);
prepareRig(body.scene, body.animations);

const CELL_W = 2.3, CELL_H = 2.4;
const missing = new Set<string>();
for (const [r, row] of rows.entries()) {
  const [base, upper] = row.split('+');
  for (let c = 0; c < cols; c++) {
    const root = cloneSkinned(body.scene);
    const anim = new Animator(root, body.animations);
    const u = weaponKeys || viewList ? fixedAt : cols > 1 ? c / (cols - 1) : 0;
    const weapon = weapons[weaponKeys ? c : 0]!;
    if (!anim.scrub(base!, u * anim.duration(base!) * 0.999, 0)) missing.add(base!);
    if (upper && !anim.upper(upper, u * anim.duration(upper) * 0.999, 0)) missing.add(upper);
    anim.update(0);
    anim.update(1);
    const socket = root.getObjectByName(isGun ? WEAPON_SOCKET : STAFF_SOCKET) ?? root.getObjectByName(STAFF_SOCKET);
    socket?.add(weapon.scene.clone(true));
    if (upper?.startsWith('dual')) root.getObjectByName('socket_weapon_l')?.add(weapon.scene.clone(true));
    if (upper) squareGun(root, upper);
    relaxHand(root, 'Left', leftHandGrips(upper ?? null) ? 0 : 1);
    const cell = new THREE.Group();
    cell.add(root);
    cell.scale.setScalar(zoom);
    cell.position.set((c - (cols - 1) / 2) * CELL_W, -r * CELL_H + (zoom > 1 ? CELL_H / 2 - 0.25 - zoomY * zoom : 0), 0);
    // Each cell turns to the camera's view instead of the camera orbiting the grid.
    cell.rotation.y = { front: 0, side: -Math.PI / 2, left: Math.PI / 2, back: Math.PI, q: -Math.PI / 5, bq: Math.PI * 0.8, top: 0 }[viewList?.[c] ?? view] ?? 0;
    if ((viewList?.[c] ?? view) === 'top') cell.rotation.x = Math.PI / 2.6;
    scene.add(cell);
    const floor = new THREE.Mesh(new THREE.PlaneGeometry(CELL_W * 0.9, 0.01), new THREE.MeshBasicMaterial({ color: 0x30363f }));
    floor.position.set(cell.position.x, cell.position.y - 0.005, 0);
    if (zoom === 1) scene.add(floor);
  }
}
const w = cols * CELL_W, h = rows.length * CELL_H;
const aspect = innerWidth / innerHeight;
const halfH = Math.max(h / 2, w / 2 / aspect) * 1.02;
const cam = new THREE.OrthographicCamera(-halfH * aspect, halfH * aspect, halfH, -halfH, 0.1, 100);
cam.position.set(0, -h / 2 + CELL_H - 0.25, 20);
cam.lookAt(0, cam.position.y, 0);
renderer.render(scene, cam);
document.getElementById('label')!.textContent = `${bodyKey} + ${weaponKey} (${view})\n${rows.map((r, i) => `${i + 1}. ${r}`).join('\n')}${missing.size ? `\nMISSING: ${[...missing].join(', ')}` : ''}`;
(window as unknown as { __sheet: unknown }).__sheet = { ready: true, missing: [...missing] };
