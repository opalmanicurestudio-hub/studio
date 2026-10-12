// @ts-nocheck — drawing code: three.js scene for Practice a shift (the salon, its furniture, plants and people).
// src/lib/practice/scene.ts. The game's rules live in ./sim (no drawing there); this file only draws.
import * as THREE from 'three';
import { RoundedBoxGeometry } from 'three/examples/jsm/geometries/RoundedBoxGeometry.js';
import { RoomEnvironment } from 'three/examples/jsm/environments/RoomEnvironment.js';

export function createSalon(host) {
const q = new URLSearchParams('');
const STYLE0 = 'warm'; const WARM = true; const STYLE = 'daylight';
let W = host.clientWidth || 800, H = host.clientHeight || 600;
const renderer = new THREE.WebGLRenderer({ antialias: true });
renderer.setPixelRatio(Math.min(2, window.devicePixelRatio || 1)); renderer.setSize(W, H);
renderer.shadowMap.enabled = true; renderer.shadowMap.type = THREE.PCFSoftShadowMap;
renderer.toneMapping = THREE.ACESFilmicToneMapping; renderer.toneMappingExposure = 0.95;
renderer.outputColorSpace = THREE.SRGBColorSpace;
renderer.domElement.style.display = 'block'; renderer.domElement.style.touchAction = 'none';
host.appendChild(renderer.domElement);
const scene = new THREE.Scene();
scene.background = new THREE.Color(WARM ? '#efe8df' : STYLE === 'evening' ? '#1d1c22' : STYLE === 'clay' ? '#e2ded8' : '#f3f1ee');
const pmrem = new THREE.PMREMGenerator(renderer);
scene.environment = pmrem.fromScene(new RoomEnvironment(renderer), 0.04).texture;
const ENVI = WARM ? 0.55 : STYLE === 'evening' ? 0.1 : STYLE === 'clay' ? 0.5 : 0.5;

const CLAY = STYLE === 'clay';
const clayTone = ['#f1ede7', '#e3ddd4', '#d8d0c5', '#f7f4ef'];
let ci = 0;
function mat(color, o = {}) {
  if (CLAY && !o.keep) color = o.ink ? '#24252a' : o.clay || clayTone[(ci++) % clayTone.length];
  const m = new THREE.MeshStandardMaterial({ color, roughness: CLAY ? 0.95 : (o.r ?? 0.6), metalness: CLAY ? 0 : (o.m ?? 0) });
  if (o.map && !CLAY) m.map = o.map;
  if (o.emissive) { m.emissive = new THREE.Color(o.emissive); m.emissiveIntensity = o.ei ?? 1; }
  return m;
}
function add(geo, m, x, y, z, o = {}) {
  const mesh = new THREE.Mesh(geo, m); mesh.position.set(x, y, z);
  if (o.ry) mesh.rotation.y = o.ry; if (o.rx) mesh.rotation.x = o.rx; if (o.rz) mesh.rotation.z = o.rz;
  mesh.castShadow = o.cast ?? true; mesh.receiveShadow = true; (o.parent || scene).add(mesh); return mesh;
}
const rbox = (w, h, d, r = 0.06) => new RoundedBoxGeometry(w, h, d, 3, Math.min(r, w / 2.1, h / 2.1, d / 2.1));
// box by min corner (x, z) and size, sitting at y
const B = (x, z, y, w, d, h, m, r = 0.05, o) => add(rbox(w, h, d, r), m, x + w / 2, y + h / 2, z + d / 2, o);

function oakTexture() {
  const c = document.createElement('canvas'); c.width = 1024; c.height = 1024; const g = c.getContext('2d');
  for (let i = 0; i < 32; i++) for (let j = 0; j < 5; j++) {
    const y = i * 32, off = (i * 211) % 256, x = j * 256 + off - 256;
    const t = 200 + ((i * 37 + j * 53) % 22); g.fillStyle = `rgb(${t + 22},${t + 2},${t - 30})`; g.fillRect(x, y, 256, 32);
    for (let k = 0; k < 6; k++) { g.strokeStyle = `rgba(150,110,70,${0.05 + (k % 3) * 0.02})`; g.beginPath(); g.moveTo(x, y + 4 + k * 5); g.bezierCurveTo(x + 80, y + 2 + k * 5, x + 170, y + 8 + k * 5, x + 256, y + 4 + k * 5); g.stroke(); }
    g.fillStyle = 'rgba(120,90,60,.35)'; g.fillRect(x, y, 256, 1); g.fillRect(x, y, 1, 32);
  }
  const t = new THREE.CanvasTexture(c); t.wrapS = t.wrapT = THREE.RepeatWrapping; t.repeat.set(3, 2); t.colorSpace = THREE.SRGBColorSpace; t.anisotropy = 8; return t;
}
const shelfM = mat('#cdb595', { r: 0.6 });
const POL = ['#d94f6b', '#f3a6b5', '#b3263f', '#7d1d3f', '#f6c9a8', '#e8875f', '#c9a26b', '#6f4ea0', '#3c5a99', '#2f8f83', '#16171a', '#f0e3d3', '#ff8fa3', '#a14d7a', '#e4b04a', '#f7e7e2', '#9b2335'];
let seed = 7; const rnd = () => (seed = (seed * 16807) % 2147483647) / 2147483647;
const bottleGeo = new THREE.CylinderGeometry(0.07, 0.08, 0.26, 14), capGeo = new THREE.CylinderGeometry(0.035, 0.035, 0.12, 10);
const capM = mat('#141414', { ink: true, r: 0.3, m: 0.2 });
// ── Furniture ────────────────────────────────────────────────────────
const white = mat('#fbfaf8', { r: 0.3 }), blush = mat('#e3b9b3', { r: 0.55 }), ink = mat('#1b1c20', { ink: true, r: 0.4, m: 0.3 }), steel = mat('#b9b9bf', { r: 0.3, m: 0.8 });
const lampLights = [];
function nailTable(x, z, lit) {
  B(x, z, 1.0, 2.6, 1.25, 0.08, white, 0.03);                         // top
  B(x + 0.15, z + 0.1, 0, 0.12, 1.05, 1.0, white, 0.03); B(x + 2.33, z + 0.1, 0, 0.12, 1.05, 1.0, white, 0.03);  // panel legs
  B(x + 0.9, z + 0.35, 1.08, 0.8, 0.5, 0.03, mat('#f1d3d8', { r: 0.95 }), 0.01);   // towel
  for (let i = 0; i < 4; i++) { const bm = CLAY ? mat('#fff') : new THREE.MeshPhysicalMaterial({ color: POL[(i * 5 + Math.floor(x)) % POL.length], roughness: 0.1, clearcoat: 1 }); add(bottleGeo, bm, x + 2.0 + i * 0.13, 1.21, z + 0.25); }
  // lamp: base, arm, head
  add(new THREE.CylinderGeometry(0.12, 0.14, 0.04, 24), ink, x + 0.35, 1.1, z + 0.25);
  add(new THREE.CylinderGeometry(0.018, 0.018, 1.0, 8), ink, x + 0.35, 1.6, z + 0.25);
  const arm = add(new THREE.CylinderGeometry(0.018, 0.018, 0.7, 8), ink, x + 0.55, 2.1, z + 0.45); arm.rotation.set(0.6, 0, -0.9);
  const head = add(new THREE.ConeGeometry(0.16, 0.22, 24, 1, true), ink, x + 0.8, 1.98, z + 0.6); head.material.side = THREE.DoubleSide;
  if (lit) {
    add(new THREE.SphereGeometry(0.06, 12, 12), new THREE.MeshStandardMaterial({ color: '#fff', emissive: '#fff4d6', emissiveIntensity: 3 }), x + 0.8, 1.9, z + 0.6, { cast: false });
    if (STYLE === 'evening') { const L = new THREE.PointLight('#ffd7a0', 9, 4.5, 2); L.position.set(x + 0.8, 1.75, z + 0.65); scene.add(L); }
  }
}
function chair(x, z, facing = -1) { // facing -1 = faces back wall
  B(x, z, 0.55, 0.9, 0.85, 0.16, blush, 0.06);
  B(x, facing < 0 ? z + 0.72 : z, 0.68, 0.9, 0.14, 0.7, blush, 0.06);
  add(new THREE.CylinderGeometry(0.05, 0.05, 0.55, 10), steel, x + 0.45, 0.28, z + 0.42);
  add(new THREE.CylinderGeometry(0.32, 0.32, 0.03, 24), steel, x + 0.45, 0.015, z + 0.42);
}
function stool(x, z) { add(new THREE.CylinderGeometry(0.28, 0.28, 0.1, 28), ink, x, 0.6, z); add(new THREE.CylinderGeometry(0.04, 0.04, 0.55, 10), steel, x, 0.28, z); add(new THREE.CylinderGeometry(0.25, 0.25, 0.03, 24), steel, x, 0.015, z); }
// Plants with real leaves: an olive tree (hundreds of small grey-green leaves), a fiddle-leaf fig (big glossy leaves),
// and a monstera. Leaves are instanced, each with its own angle and shade of green.
const _m = new THREE.Matrix4(), _q = new THREE.Quaternion(), _e = new THREE.Euler(), _s = new THREE.Vector3(), _p = new THREE.Vector3(), _c = new THREE.Color();
function leaves(n, geo, shades, place, rough = 0.55) {
  const m = new THREE.MeshStandardMaterial({ roughness: rough, metalness: 0, side: THREE.DoubleSide });
  const im = new THREE.InstancedMesh(geo, m, n); im.castShadow = true; im.receiveShadow = true;
  for (let i = 0; i < n; i++) { const t = place(i); _p.set(t.x, t.y, t.z); _e.set(t.rx, t.ry, t.rz); _q.setFromEuler(_e); _s.setScalar(t.s); _m.compose(_p, _q, _s); im.setMatrixAt(i, _m); _c.set(shades[i % shades.length]).offsetHSL(0, 0, (rnd() - 0.5) * 0.08); im.setColorAt(i, _c); }
  scene.add(im); return im;
}
function pot(x, z, kind, r = 0.32, h = 0.55) {
  const col = { terracotta: '#c4724f', white: '#f3efe9', basket: '#c9a27a', stone: '#d9d2c7' }[kind];
  add(new THREE.CylinderGeometry(r, r * 0.8, h, 32), mat(col, { r: kind === 'white' ? 0.3 : 0.85 }), x, h / 2, z);
  add(new THREE.CylinderGeometry(r * 0.94, r * 0.94, 0.02, 32), mat('#4a3628', { r: 1 }), x, h - 0.03, z);
}
const oliveLeaf = new THREE.SphereGeometry(1, 8, 4); oliveLeaf.scale(0.11, 0.012, 0.035);
const bigLeaf = new THREE.SphereGeometry(1, 16, 8); bigLeaf.scale(0.17, 0.012, 0.24);
const monLeaf = (() => { const s = new THREE.Shape(); s.moveTo(0, 0); s.bezierCurveTo(0.35, 0.05, 0.42, 0.45, 0, 0.62); s.bezierCurveTo(-0.42, 0.45, -0.35, 0.05, 0, 0); const g = new THREE.ShapeGeometry(s, 12); g.rotateX(-Math.PI / 2); return g; })();
function olive(x, z, h = 2.1, kind = 'terracotta') {
  pot(x, z, kind); const bark = mat('#7a6352', { r: 0.95 });
  const trunk = add(new THREE.CylinderGeometry(0.035, 0.06, h * 0.55, 8), bark, x, 0.55 + h * 0.27, z); trunk.rotation.z = 0.06;
  const tops = [[0.22, 0.12], [-0.18, 0.2], [0.05, -0.22]];
  for (const [dx, dz] of tops) { const b = add(new THREE.CylinderGeometry(0.018, 0.03, 0.55, 6), bark, x + dx * 0.5, 0.55 + h * 0.6, z + dz * 0.5); b.rotation.set(dz * 1.6, 0, -dx * 1.6); }
  const cl = [[0, 0, 0.38], [0.28, 0.15, 0.3], [-0.25, 0.22, 0.3], [0.1, -0.3, 0.3], [-0.1, 0.05, 0.28]];
  leaves(520, oliveLeaf, ['#7d8f6a', '#93a37f', '#6b7d5a', '#a3b08e', '#5f7350'], (i) => { const c = cl[i % cl.length]; const u = rnd() * Math.PI * 2, v = Math.acos(2 * rnd() - 1), r = c[2] * Math.cbrt(rnd());
    return { x: x + c[0] + r * Math.sin(v) * Math.cos(u), y: 0.55 + h * 0.72 + c[1] * 0.5 + r * Math.cos(v) * 0.75, z: z + c[0] * 0.3 + c[1] + r * Math.sin(v) * Math.sin(u), rx: rnd() * 3, ry: rnd() * 6.3, rz: rnd() * 3, s: 0.8 + rnd() * 0.5 }; }, 0.7);
}
function fiddle(x, z, h = 2.0, kind = 'white') {
  pot(x, z, kind, 0.3, 0.5); const stem = mat('#5b4a39', { r: 0.9 });
  add(new THREE.CylinderGeometry(0.025, 0.035, h, 8), stem, x, 0.5 + h / 2, z);
  leaves(46, bigLeaf, ['#2f5a2c', '#3b6b33', '#456f37', '#2a4f27'], (i) => { const y = 0.75 + (i / 46) * h * 0.95, a = i * 2.4; const out = 0.18 + (1 - i / 46) * 0.12;
    return { x: x + Math.cos(a) * out, y, z: z + Math.sin(a) * out, rx: -0.5 + rnd() * 0.3, ry: -a + Math.PI / 2, rz: 0.2, s: 0.8 + (1 - i / 46) * 0.5 }; }, 0.35);
}
function monstera(x, z, kind = 'basket') {
  pot(x, z, kind, 0.36, 0.42); const stem = mat('#4f7a3c', { r: 0.6 });
  leaves(14, monLeaf, ['#2e6b3a', '#357a42', '#2a5f33'], (i) => { const a = i * 0.45 + rnd() * 0.3, len = 0.5 + rnd() * 0.4;
    const st = add(new THREE.CylinderGeometry(0.012, 0.015, len, 6), stem, x + Math.cos(a) * len * 0.25, 0.42 + len * 0.45, z + Math.sin(a) * len * 0.25); st.rotation.set(Math.sin(a) * 0.6, 0, -Math.cos(a) * 0.6);
    return { x: x + Math.cos(a) * len * 0.55, y: 0.42 + len * 0.9, z: z + Math.sin(a) * len * 0.55, rx: 0.5, ry: -a + Math.PI / 2, rz: 0, s: 0.9 + rnd() * 0.5 }; }, 0.45);
}
const SK = { deep: '#5a3825', brown: '#8d5a3b', tan: '#b07a52', olive: '#c69472', light: '#f0c9a6', fair: '#f6dcc6', golden: '#d9a679' };

function hairFor(g, o, hip, hairM) {
  const top = hip + 0.89, hs = o.hs;
  const cap = () => { const hc = add(new THREE.SphereGeometry(0.158, 24, 20, 0, Math.PI * 2, 0, Math.PI * 0.55), hairM, 0, top, -0.01, { parent: g }); hc.rotation.x = -0.25; };
  if (hs === 'hijab') { const f = mat(o.scarf || '#7a5a8c', { r: 0.9 }); add(new THREE.SphereGeometry(0.175, 24, 20), f, 0, top + 0.01, -0.02, { parent: g }); add(new THREE.CapsuleGeometry(0.17, 0.18, 6, 16), f, 0, top - 0.2, -0.05, { parent: g }); return; }
  if (hs === 'afro') { add(new THREE.IcosahedronGeometry(0.235, 3), hairM, 0, top + 0.06, -0.04, { parent: g }); return; }
  if (hs === 'puff') { cap(); add(new THREE.IcosahedronGeometry(0.14, 2), hairM, 0, top + 0.18, -0.06, { parent: g }); return; }
  if (hs === 'curly') { cap(); for (let i = 0; i < 16; i++) { const a = i * 0.9, y = top - 0.05 + (i % 4) * 0.05; add(new THREE.SphereGeometry(0.06, 8, 6), hairM, Math.cos(a) * 0.16, y, Math.sin(a) * 0.14 - 0.03, { parent: g }); } return; }
  if (hs === 'braids' || hs === 'locs') { cap(); const n = hs === 'locs' ? 9 : 12, r = hs === 'locs' ? 0.028 : 0.018; for (let i = 0; i < n; i++) { const a = Math.PI * 0.15 + (i / (n - 1)) * Math.PI * 0.7; add(new THREE.CapsuleGeometry(r, 0.42, 4, 6), hairM, Math.cos(a) * 0.14, top - 0.28, -Math.sin(a) * 0.12, { parent: g }); } return; }
  if (hs === 'long') { cap(); add(new THREE.CapsuleGeometry(0.13, 0.26, 6, 12), hairM, 0, top - 0.17, -0.1, { parent: g }); return; }
  if (hs === 'bob') { const b = add(new THREE.SphereGeometry(0.175, 24, 16, 0, Math.PI * 2, 0, Math.PI * 0.62), hairM, 0, top + 0.01, -0.01, { parent: g }); b.rotation.x = -0.15; return; }
  if (hs === 'bun') { cap(); add(new THREE.SphereGeometry(0.08, 16, 12), hairM, 0, top + 0.13, -0.12, { parent: g }); return; }
  if (hs === 'gray') { cap(); return; }
  if (hs === 'fade') { const c = add(new THREE.SphereGeometry(0.155, 24, 20, 0, Math.PI * 2, 0, Math.PI * 0.42), hairM, 0, top + 0.005, -0.005, { parent: g }); c.rotation.x = -0.2; return; }
  cap();
}
function person(x, z, o) {
  const g = new THREE.Group(); g.position.set(x, 0, z); g.rotation.order = 'YXZ'; g.rotation.y = o.ry || 0; (o.parent || scene).add(g);
  const lying = o.pose === 'lie'; if (lying) { g.rotation.x = o.tilt ?? -Math.PI / 2; g.position.y = o.seat + 0.18; o = { ...o, pose: 'stand' }; }
  const skin = mat(o.skin, { r: 0.65 }), cloth = mat(o.outfit, { r: 0.85 }), hairM = mat(o.hair || '#1a1410', { r: 0.7 }), legM = mat(o.legs || '#2d2e33', { r: 0.8 });
  const sit = o.pose === 'sit' || o.pose === 'chair', seat = o.seat ?? 0.7, bw = o.build || 1, sh = o.male ? 1.12 : 1;
  const hip = sit ? seat + 0.12 : 0.95;
  if (o.pose === 'chair') { // wheelchair
    const metal = mat('#9aa0a8', { r: 0.3, m: 0.85 }), tyre = mat('#1d1e22', { r: 0.8 });
    for (const s of [-0.34, 0.34]) { const w = add(new THREE.TorusGeometry(0.3, 0.035, 10, 32), tyre, s, 0.33, -0.05, { parent: g }); w.rotation.y = Math.PI / 2; const r = add(new THREE.TorusGeometry(0.26, 0.012, 6, 32), metal, s * 1.08, 0.33, -0.05, { parent: g }); r.rotation.y = Math.PI / 2; }
    B(-0.3, -0.25, 0.55, 0.6, 0.55, 0.06, mat('#2b2c30', { r: 0.7 }), 0.03, { parent: g }); B(-0.3, -0.3, 0.6, 0.6, 0.06, 0.55, mat('#2b2c30', { r: 0.7 }), 0.03, { parent: g });
    for (const s of [-0.18, 0.18]) add(new THREE.CylinderGeometry(0.05, 0.05, 0.04, 12), tyre, s, 0.06, 0.45, { parent: g });
  }
  if (sit) {
    for (const s of [-0.11, 0.11]) { add(new THREE.CapsuleGeometry(0.085 * bw, 0.42, 6, 12), legM, s * bw, hip, 0.25, { rx: Math.PI / 2, parent: g }); add(new THREE.CapsuleGeometry(0.075 * bw, 0.42, 6, 12), legM, s * bw, hip - 0.3, 0.5, { parent: g }); }
    for (const s of [-0.11, 0.11]) add(new THREE.CapsuleGeometry(0.06, 0.1, 4, 8), mat(o.shoes || '#e9e2d8', { r: 0.6 }), s * bw, 0.06, 0.58, { rx: Math.PI / 2, parent: g });
  } else {
    g.userData.legs = []; for (const s of [-0.1, 0.1]) g.userData.legs.push(add(new THREE.CapsuleGeometry(0.085 * bw, 0.75, 6, 12), legM, s * bw, 0.5, 0, { parent: g }));
    for (const s of [-0.1, 0.1]) add(new THREE.CapsuleGeometry(0.06, 0.1, 4, 8), mat(o.shoes || '#e9e2d8', { r: 0.6 }), s * bw, 0.06, 0.06, { rx: Math.PI / 2, parent: g });
  }
  const torso = add(new THREE.CapsuleGeometry(0.2 * bw, 0.42, 8, 16), cloth, 0, hip + 0.33, 0, { parent: g }); torso.scale.x = sh;
  if (o.staff) { const ap = add(new THREE.CapsuleGeometry(0.205 * bw, 0.3, 6, 16, ), mat(o.apron || '#1b1c20', { r: 0.8 }), 0, hip + 0.22, 0.012, { parent: g }); ap.scale.set(sh * 0.98, 1, 0.98); }
  for (const s of [-1, 1]) { const a = add(new THREE.CapsuleGeometry(0.06, 0.42, 6, 10), o.sleeves === false ? skin : cloth, s * 0.25 * bw * sh, hip + 0.33, sit ? 0.12 : 0, { parent: g }); a.rotation.x = sit ? -0.7 : 0.05; a.rotation.z = s * 0.12;
    add(new THREE.SphereGeometry(0.055, 12, 10), skin, s * 0.27 * bw * sh, sit ? hip + 0.12 : hip + 0.05, sit ? 0.32 : 0.02, { parent: g }); }
  add(new THREE.CylinderGeometry(0.06, 0.07, 0.1, 12), skin, 0, hip + 0.72, 0, { parent: g });
  add(new THREE.SphereGeometry(0.15, 24, 20), skin, 0, hip + 0.88, 0, { parent: g });
  if (o.beard) { const bd = add(new THREE.SphereGeometry(0.135, 20, 12, 0, Math.PI * 2, Math.PI * 0.55, Math.PI * 0.4), hairM, 0, hip + 0.86, 0.02, { parent: g }); }
  if (o.glasses) { const gm = mat('#1b1c20', { r: 0.3 }); for (const s of [-0.06, 0.06]) { const r = add(new THREE.TorusGeometry(0.035, 0.007, 6, 18), gm, s, hip + 0.9, 0.145, { parent: g }); } }
  hairFor(g, o, hip, hairM);
  if (o.foils) { const fm = new THREE.MeshStandardMaterial({ color: '#d9dde2', roughness: 0.2, metalness: 1 }); for (let i = 0; i < 12; i++) { const a = (i / 12) * Math.PI * 2; const f = add(new THREE.BoxGeometry(0.09, 0.02, 0.2), fm, Math.cos(a) * 0.15, hip + 0.98 + (i % 3) * 0.03, Math.sin(a) * 0.15 - 0.02, { parent: g }); f.rotation.set(0.9, -a, 0); } }
  g.userData.hip = hip; return g;
}
// ── Full-service salon: hair, wash, barber, nails, pedicure, facials, lashes and brows ──
const RW = 30, RD = 18, WH = 4.2;
B(-0.3, -0.3, -0.52, RW + 0.6, RD + 0.6, 0.5, mat('#d9d2c8', { r: 0.9 }), 0.08);
const oakT = oakTexture(); oakT.repeat.set(3.6, 2.2);
add(new THREE.PlaneGeometry(RW, RD), mat('#e9dcc8', { map: oakT, r: 0.55 }), RW / 2, 0.001, RD / 2, { rx: -Math.PI / 2, cast: false });
const plaster = mat('#f4efe8', { r: 0.95 }), plaster2 = mat('#ece5dc', { r: 0.95 });
B(-0.3, -0.3, 0, RW + 0.3, 0.3, WH, plaster, 0.02); B(-0.3, -0.3, 0, 0.3, RD + 0.3, WH, plaster2, 0.02);
B(0, 0, 0, RW, 0.06, 0.25, mat('#ddd3c6'), 0.01, { cast: false }); B(0, 0, 0, 0.06, RD, 0.25, mat('#ddd3c6'), 0.01, { cast: false });
// Window on the left wall, behind the pedicure chairs
add(new THREE.PlaneGeometry(4.6, 2.6), new THREE.MeshStandardMaterial({ color: '#dbeaf2', emissive: '#cfe3ee', emissiveIntensity: 0.9, roughness: 0.1 }), 0.02, 2.4, 14.6, { ry: Math.PI / 2, cast: false });
B(0, 12.3, 1.05, 0.1, 4.6, 0.06, ink); B(0, 12.3, 3.7, 0.1, 4.6, 0.06, ink); B(0, 14.57, 1.1, 0.1, 0.06, 2.6, ink);
// Accent wall art and the studio mark
add(new THREE.PlaneGeometry(1.6, 1.1), mat('#e8b9b0', { r: 0.9 }), 0.02, 2.7, 3.2, { ry: Math.PI / 2, cast: false });
add(new THREE.CircleGeometry(0.5, 48), mat('#f2c9d1', { r: 0.9 }), 15.2, 2.9, 0.02, { cast: false });

// HAIR: four stations with big mirrors (one is a barber chair)
const leather = mat('#232428', { r: 0.45 }), oakM = mat('#c9a77f', { r: 0.45 });
const mirrorM = new THREE.MeshStandardMaterial({ color: '#e4ecef', roughness: 0.04, metalness: 0.95 });
function hairStation(x, barber) {
  B(x + 0.55, 0.02, 0.95, 1.7, 0.08, 2.5, oakM, 0.03);                                   // frame
  add(new THREE.PlaneGeometry(1.5, 2.3), mirrorM, x + 1.4, 2.2, 0.12, { cast: false });  // mirror
  B(x + 0.35, 0.05, 0.9, 2.1, 0.5, 0.07, oakM, 0.02);                                     // counter
  for (let i = 0; i < 5; i++) add(new THREE.CylinderGeometry(0.05, 0.055, 0.22 + (i % 2) * 0.08, 12), mat(['#f3efe9', '#1b1c20', '#d8b48a', '#e7c3c9', '#bcd3c4'][i], { r: 0.35 }), x + 0.5 + i * 0.16, 1.08, 0.3);
  const cx = x + 1.4, cz = 1.9;
  add(new THREE.CylinderGeometry(0.32, 0.36, 0.05, 32), steel, cx, 0.025, cz); add(new THREE.CylinderGeometry(0.07, 0.07, 0.45, 12), steel, cx, 0.27, cz);
  B(cx - 0.42, cz - 0.4, 0.5, 0.84, 0.8, 0.18, barber ? mat('#5a3b2a', { r: 0.4 }) : leather, 0.08);
  B(cx - 0.42, cz + 0.28, 0.66, 0.84, 0.16, barber ? 1.05 : 0.8, barber ? mat('#5a3b2a', { r: 0.4 }) : leather, 0.08);
  B(cx - 0.5, cz - 0.35, 0.66, 0.1, 0.65, 0.22, leather, 0.04); B(cx + 0.4, cz - 0.35, 0.66, 0.1, 0.65, 0.22, leather, 0.04);
  B(cx - 0.18, cz - 0.75, 0.15, 0.36, 0.3, 0.05, steel, 0.02);                              // footrest
}
[2.0, 5.4, 8.8, 12.2].forEach((x, i) => hairStation(x, i === 3));
// Trolley with tools between stations
for (const x of [4.95, 8.35]) { B(x, 2.6, 0, 0.42, 0.42, 0.85, mat('#f3efe9', { r: 0.4 }), 0.04); add(new THREE.CylinderGeometry(0.03, 0.03, 0.22, 8), ink, x + 0.15, 0.97, 2.75); }

// WASH: three backwash basins along the left wall
for (const z of [5.4, 7.4, 9.4]) {
  B(0.1, z, 0, 0.9, 1.3, 0.92, mat('#f6f3ee', { r: 0.35 }), 0.06);
  add(new THREE.SphereGeometry(0.42, 32, 16, 0, Math.PI * 2, Math.PI / 2, Math.PI / 2), leather, 0.6, 1.12, z + 0.65);
  add(new THREE.CylinderGeometry(0.03, 0.03, 0.3, 8), steel, 0.25, 1.15, z + 0.65);
  B(1.05, z + 0.15, 0.4, 1.2, 1.0, 0.16, leather, 0.08);
  const back = add(rbox(0.16, 0.9, 1.0, 0.06), leather, 1.05, 0.85, z + 0.65); back.rotation.z = -0.9;
  B(2.2, z + 0.3, 0.2, 0.6, 0.7, 0.12, leather, 0.05);
}
// COLOR BAR: a small counter with bowls
B(0.1, 11.0, 0, 0.8, 1.6, 0.95, oakM, 0.04); for (let i = 0; i < 3; i++) add(new THREE.CylinderGeometry(0.1, 0.07, 0.07, 16), mat(['#1b1c20', '#f3efe9', '#c97a92'][i], { r: 0.4 }), 0.5, 0.99, 11.3 + i * 0.45);

// NAILS: three manicure tables under a polish wall
for (let k = 0; k < 4; k++) {
  const y = 1.4 + k * 0.55; B(16.2, 0.02, y - 0.05, 12.2, 0.32, 0.05, shelfM, 0.01);
  for (let x = 16.4; x < 28.2; x += 0.21) { const col = POL[Math.floor(rnd() * POL.length)];
    add(bottleGeo, new THREE.MeshPhysicalMaterial({ color: col, roughness: 0.12, clearcoat: 1, clearcoatRoughness: 0.05 }), x, y + 0.13, 0.18); add(capGeo, capM, x, y + 0.32, 0.18); }
}
for (const x of [16.6, 20.8, 25.0]) { nailTable(x, 2.6, x < 24); stool(x + 1.3, 2.05); chair(x + 0.85, 4.15); }

// PEDICURE: platform with three chairs and blue water
B(0.4, 13.2, 0, 9.8, 4.5, 0.32, mat('#e9e1d6', { r: 0.8 }), 0.04);
const cream = mat('#e8dccb', { r: 0.6 }), stone = mat('#f6f5f2', { r: 0.15 });
for (const x of [1.0, 4.2, 7.4]) {
  B(x, 13.4, 0.32, 1.9, 1.5, 0.55, cream, 0.12); B(x + 0.1, 13.4, 0.87, 1.7, 1.25, 0.18, cream, 0.1);
  B(x, 13.4, 0.87, 1.9, 0.38, 1.25, cream, 0.12); B(x, 13.7, 0.87, 0.28, 1.2, 0.45, cream, 0.1); B(x + 1.62, 13.7, 0.87, 0.28, 1.2, 0.45, cream, 0.1);
  add(new THREE.CylinderGeometry(0.55, 0.45, 0.42, 40), stone, x + 0.95, 0.53, 15.65);
  add(new THREE.CircleGeometry(0.47, 40), new THREE.MeshStandardMaterial({ color: '#5fb6d6', roughness: 0.04, metalness: 0.05, emissive: '#2c7fa6', emissiveIntensity: 0.12 }), x + 0.95, 0.745, 15.65, { rx: -Math.PI / 2, cast: false });
}

// TREATMENT ROOMS: facials, and lashes & brows (cut away so you can see in)
const roomWall = mat('#f1ebe3', { r: 0.95 });
B(22.4, 6.6, 0, 7.6, 0.15, 2.2, roomWall, 0.02); B(22.4, 6.6, 0, 0.15, 6.6, 1.5, roomWall, 0.02); B(26.15, 6.6, 0, 0.15, 6.6, 1.5, roomWall, 0.02);
add(new THREE.PlaneGeometry(3.6, 6.4), mat('#efe3dc', { r: 1 }), 24.3, 0.004, 9.9, { rx: -Math.PI / 2, cast: false });
add(new THREE.PlaneGeometry(3.6, 6.4), mat('#e8eee6', { r: 1 }), 28.1, 0.004, 9.9, { rx: -Math.PI / 2, cast: false });
function bed(x, z) {
  B(x, z, 0, 0.9, 2.1, 0.55, mat('#f6f3ee', { r: 0.4 }), 0.05); B(x - 0.03, z - 0.03, 0.55, 0.96, 2.16, 0.16, mat('#efe6da', { r: 0.8 }), 0.07);
  B(x + 0.05, z + 1.2, 0.71, 0.86, 0.9, 0.03, mat('#e3c9c2', { r: 0.95 }), 0.02);  // blanket
}
bed(23.9, 7.6); bed(27.6, 7.6);
B(23.0, 7.2, 0, 0.5, 0.5, 0.8, mat('#f3efe9'), 0.04); add(new THREE.CylinderGeometry(0.1, 0.12, 0.5, 16), mat('#f3efe9', { r: 0.3 }), 23.25, 1.05, 7.45);  // steamer
add(new THREE.TorusGeometry(0.28, 0.035, 12, 40), new THREE.MeshStandardMaterial({ color: '#fff', emissive: '#fff6e8', emissiveIntensity: 1.6 }), 28.05, 1.65, 7.3, { cast: false });  // lash ring light
add(new THREE.CylinderGeometry(0.015, 0.015, 1.4, 8), steel, 28.05, 0.95, 7.0);

// LOUNGE, FRONT DESK, RETAIL
add(new THREE.CircleGeometry(2.6, 64), mat('#efe3dc', { r: 1 }), 15.6, 0.004, 9.6, { rx: -Math.PI / 2, cast: false });
const sage = mat('#a7b8a2', { r: 0.98 });
function sofa(x, z, w) { B(x, z, 0.12, w, 1.3, 0.48, sage, 0.14); B(x, z, 0.12, w, 0.38, 1.05, sage, 0.14); B(x, z + 0.3, 0.12, 0.3, 1.0, 0.72, sage, 0.12); B(x + w - 0.3, z + 0.3, 0.12, 0.3, 1.0, 0.72, sage, 0.12); }
sofa(13.4, 8.2, 4.2); sofa(18.6, 8.7, 1.4);
const trav = mat('#ddcdb4', { r: 0.7 });
add(new THREE.CylinderGeometry(0.75, 0.75, 0.08, 48), trav, 15.5, 0.46, 10.4); add(new THREE.CylinderGeometry(0.35, 0.42, 0.42, 32), trav, 15.5, 0.21, 10.4);
const deskM = mat('#f7f4ef', { r: 0.35 });
B(13.6, 14.2, 0, 4.8, 1.0, 1.02, deskM, 0.08); B(17.6, 12.6, 0, 1.0, 2.6, 1.02, deskM, 0.08);
B(13.55, 14.15, 1.02, 4.9, 1.1, 0.05, oakM, 0.02); B(17.55, 12.55, 1.02, 1.1, 2.7, 0.05, oakM, 0.02);
B(15.0, 14.3, 1.07, 0.9, 0.06, 0.55, ink, 0.02); B(15.4, 14.4, 1.07, 0.1, 0.1, 0.12, ink, 0.01);
add(new THREE.CylinderGeometry(0.16, 0.12, 0.22, 20), mat('#f2c9d1', { r: 0.4 }), 17.0, 1.18, 14.6);
add(new THREE.PlaneGeometry(4.2, 1.3), mat('#8b7d70', { r: 1 }), 21.0, 0.004, 17.2, { rx: -Math.PI / 2, cast: false });
for (const sx of [20.2, 22.8]) { B(sx, 14.6, 0, 1.8, 0.06, 1.9, oakM, 0.02); B(sx, 14.6, 0, 0.06, 0.5, 1.9, oakM, 0.02); B(sx + 1.74, 14.6, 0, 0.06, 0.5, 1.9, oakM, 0.02); for (let k = 0; k < 3; k++) { B(sx + 0.05, 14.62, 0.5 + k * 0.5, 1.7, 0.46, 0.03, mat('#f3efe9'), 0.01);
  for (let i = 0; i < 6; i++) add(new THREE.CylinderGeometry(0.06, 0.06, 0.2, 12), mat(['#d9b48a', '#1b1c20', '#f2c9d1', '#bcd3c4', '#f3efe9', '#c97a92'][(i + k) % 6], { r: 0.3 }), sx + 0.2 + i * 0.27, 0.64 + k * 0.5, 14.85); } }

plantsAll();
function plantsAll() {
  olive(21.0, 8.3, 2.2); fiddle(12.6, 7.6, 1.8); olive(0.8, 17.0, 2.3, 'stone'); monstera(29.0, 15.6); monstera(12.8, 11.4, 'terracotta'); fiddle(29.2, 4.6, 2.0, 'terracotta'); olive(15.9, 5.0, 1.7, 'white');
  leaves(60, oliveLeaf, ['#3f7a3a', '#4f8a44', '#5e9a52'], (i) => ({ x: 16.35 + (i % 2) * 11.9, y: 3.2 - (i / 60) * 1.8 + rnd() * 0.2, z: 0.25 + rnd() * 0.12, rx: rnd() * 3, ry: rnd() * 3, rz: rnd() * 3, s: 1.3 }), 0.5);
}
// ── Lights ───────────────────────────────────────────────────────────
const sun = new THREE.DirectionalLight(STYLE === 'evening' ? '#9fb3ff' : '#fff3e2', STYLE === 'evening' ? 0.15 : CLAY ? 2.6 : 2.6);
sun.position.set(20, 22, 26); sun.target.position.set(15, 0, 9); scene.add(sun.target);
if (WARM) { sun.color.set('#ffe6c8'); sun.intensity = 2.3; } sun.castShadow = true; sun.shadow.mapSize.set(4096, 4096); sun.shadow.radius = CLAY || WARM ? 9 : 4; sun.shadow.bias = -0.0004; sun.shadow.normalBias = 0.02;
Object.assign(sun.shadow.camera, { left: -30, right: 30, top: 30, bottom: -30, near: 0.5, far: 140 }); scene.add(sun);
scene.add(WARM ? new THREE.HemisphereLight('#fff4e6', '#e7d3bd', 0.75) : new THREE.HemisphereLight(STYLE === 'evening' ? '#6a6f8a' : '#ffffff', STYLE === 'evening' ? '#2a2420' : '#e8dccb', STYLE === 'evening' ? 0.18 : CLAY ? 0.7 : 0.6));
if (STYLE === 'evening') { const warm = new THREE.PointLight('#ffcf94', 26, 9, 2); warm.position.set(16, 3.2, 8.5); scene.add(warm); const desk2 = new THREE.PointLight('#ffd9a8', 10, 6, 2); desk2.position.set(19.5, 2.5, 11.5); scene.add(desk2); const ped = new THREE.PointLight('#ffd9a8', 10, 7, 2); ped.position.set(5, 3, 12.5); scene.add(ped); }

if (q.get('warm') === '1') { const w = new THREE.PointLight('#ffd2a1', 22, 10, 2); w.position.set(16, 3.4, 13); scene.add(w); }
sun.shadow.mapSize.set(2048, 2048);
const fixEnv = (root) => root.traverse((o) => { if (o.material && 'envMapIntensity' in o.material) o.material.envMapIntensity = ENVI; });
fixEnv(scene);
return { THREE, renderer, scene, person, add, mat, fixEnv, getSize: () => [W, H], setSize: (w, h) => { W = w; H = h; renderer.setSize(w, h); } };
}
