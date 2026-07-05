// Vista e interacción: three.js sincronizado con el modelo puro.
// La escena nunca es la fuente de verdad: tras cada mutación se hace
// un diff modelo→meshes (sync) y listo.

import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { RoomEnvironment } from 'three/addons/environments/RoomEnvironment.js';
import { Structure, posOf, rodEnds } from './structure.js';

const BALL_R = 0.22;
const ROD_R = 0.06;

const COLORS = {
  amarillo: 0xffc93c,
  rojo: 0xe5484d,
  azul: 0x3e63dd,
  verde: 0x30a46c,
};

const structure = new Structure();
let currentColor = 'amarillo';
let selected = null; // key de la bola seleccionada, o null

// ---------------------------------------------------------------- escena

const renderer = new THREE.WebGLRenderer({ antialias: true });
renderer.setPixelRatio(Math.min(devicePixelRatio, 2));
renderer.setSize(innerWidth, innerHeight);
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = THREE.PCFSoftShadowMap;
renderer.toneMapping = THREE.ACESFilmicToneMapping;
document.getElementById('app').appendChild(renderer.domElement);

const scene = new THREE.Scene();
scene.background = new THREE.Color(0x10131a);
scene.fog = new THREE.Fog(0x10131a, 18, 45);
scene.environment = new THREE.PMREMGenerator(renderer).fromScene(
  new RoomEnvironment(),
  0.04
).texture;

const camera = new THREE.PerspectiveCamera(50, innerWidth / innerHeight, 0.1, 100);
camera.position.set(4.5, 3.5, 7);

const controls = new OrbitControls(camera, renderer.domElement);
controls.target.set(0, 0.8, 0);
controls.enableDamping = true;
controls.maxDistance = 30;

scene.add(new THREE.HemisphereLight(0xbfd4ff, 0x3a3226, 0.6));
const sun = new THREE.DirectionalLight(0xffffff, 1.8);
sun.position.set(5, 9, 4);
sun.castShadow = true;
sun.shadow.mapSize.set(2048, 2048);
for (const [k, v] of Object.entries({ left: -12, right: 12, top: 12, bottom: -12 }))
  sun.shadow.camera[k] = v;
scene.add(sun);

const grid = new THREE.GridHelper(40, 40, 0x2a3040, 0x1b202c);
grid.position.y = -BALL_R - 0.02;
scene.add(grid);

const floor = new THREE.Mesh(
  new THREE.PlaneGeometry(60, 60),
  new THREE.ShadowMaterial({ opacity: 0.3 })
);
floor.rotation.x = -Math.PI / 2;
floor.position.y = grid.position.y - 0.001;
floor.receiveShadow = true;
scene.add(floor);

// ------------------------------------------------------ geometrías y materiales

const ballGeo = new THREE.SphereGeometry(BALL_R, 32, 16);
const rodGeo = new THREE.CylinderGeometry(1, 1, 1, 20); // unitario, se escala

const ballMat = new THREE.MeshStandardMaterial({
  color: 0xd9dbe3, metalness: 1.0, roughness: 0.2,
});
const rodMats = Object.fromEntries(
  Object.entries(COLORS).map(([name, hex]) => [
    name,
    new THREE.MeshStandardMaterial({ color: hex, metalness: 0.4, roughness: 0.35 }),
  ])
);
const ghostMat = new THREE.MeshBasicMaterial({
  color: 0xffffff, transparent: true, opacity: 0.18, depthWrite: false,
});
const ghostLinkMat = new THREE.MeshBasicMaterial({
  color: 0x4ade80, transparent: true, opacity: 0.4, depthWrite: false,
});
const previewMat = new THREE.MeshBasicMaterial({
  transparent: true, opacity: 0.45, depthWrite: false,
});

// ----------------------------------------------------------- modelo → meshes

const world = new THREE.Group();
scene.add(world);
const ballMeshes = new Map(); // key -> Mesh
const rodMeshes = new Map(); // rodKey -> Mesh

const worldPos = (key) => new THREE.Vector3(...posOf(key));
const UP = new THREE.Vector3(0, 1, 0);

function makeRodMesh(rk, color) {
  const [a, b] = rodEnds(rk).map(worldPos);
  const dir = b.clone().sub(a);
  const mesh = new THREE.Mesh(rodGeo, rodMats[color] ?? rodMats.amarillo);
  mesh.position.copy(a).add(b).multiplyScalar(0.5);
  mesh.quaternion.setFromUnitVectors(UP, dir.clone().normalize());
  mesh.scale.set(ROD_R, dir.length(), ROD_R);
  mesh.castShadow = true;
  mesh.userData = { kind: 'rod', rk, color, base: mesh.scale.clone() };
  return mesh;
}

function sync() {
  for (const [key, mesh] of ballMeshes)
    if (!structure.balls.has(key)) {
      world.remove(mesh);
      ballMeshes.delete(key);
    }
  for (const key of structure.balls)
    if (!ballMeshes.has(key)) {
      const mesh = new THREE.Mesh(ballGeo, ballMat);
      mesh.position.copy(worldPos(key));
      mesh.castShadow = true;
      mesh.userData = { kind: 'ball', key, base: mesh.scale.clone() };
      world.add(mesh);
      ballMeshes.set(key, mesh);
    }

  for (const [rk, mesh] of rodMeshes)
    if (structure.rods.get(rk) !== mesh.userData.color) {
      world.remove(mesh);
      rodMeshes.delete(rk);
    }
  for (const [rk, color] of structure.rods)
    if (!rodMeshes.has(rk)) {
      const mesh = makeRodMesh(rk, color);
      world.add(mesh);
      rodMeshes.set(rk, mesh);
    }

  if (selected && !structure.balls.has(selected)) select(null);
  refreshGhosts();
  updateHud();
  localStorage.setItem('geomag-autosave', JSON.stringify(structure.toJSON()));
}

// ------------------------------------------------------------------ fantasmas

const ghosts = new THREE.Group();
scene.add(ghosts);

const marker = new THREE.Mesh(
  new THREE.SphereGeometry(BALL_R * 1.35, 24, 12),
  new THREE.MeshBasicMaterial({ color: 0xffffff, wireframe: true, transparent: true, opacity: 0.25 })
);
marker.visible = false;
scene.add(marker);

const previewRod = new THREE.Mesh(rodGeo, previewMat);
previewRod.visible = false;
scene.add(previewRod);

function refreshGhosts() {
  ghosts.clear();
  previewRod.visible = false;
  marker.visible = Boolean(selected);
  if (!selected) return;
  marker.position.copy(worldPos(selected));
  for (const c of structure.candidates(selected)) {
    const mesh = new THREE.Mesh(ballGeo, c.links ? ghostLinkMat : ghostMat);
    mesh.position.copy(worldPos(c.toKey));
    mesh.scale.setScalar(c.links ? 1.3 : 0.8);
    mesh.userData = { kind: 'ghost', ...c, base: mesh.scale.clone() };
    ghosts.add(mesh);
  }
}

function select(key) {
  selected = key;
  refreshGhosts();
}

// ---------------------------------------------------------------- interacción

const raycaster = new THREE.Raycaster();
const pointer = new THREE.Vector2();
let hovered = null;
let downAt = null;

function pick(event) {
  const rect = renderer.domElement.getBoundingClientRect();
  pointer.set(
    ((event.clientX - rect.left) / rect.width) * 2 - 1,
    -((event.clientY - rect.top) / rect.height) * 2 + 1
  );
  raycaster.setFromCamera(pointer, camera);
  const hit = raycaster.intersectObjects(
    [...ghosts.children, ...ballMeshes.values(), ...rodMeshes.values()]
  )[0];
  return hit?.object ?? null;
}

function setHover(mesh) {
  if (hovered === mesh) return;
  if (hovered) hovered.scale.copy(hovered.userData.base);
  hovered = mesh;
  previewRod.visible = false;
  if (mesh) {
    const bump = mesh.userData.kind === 'rod'
      ? new THREE.Vector3(1.6, 1, 1.6)
      : new THREE.Vector3(1.18, 1.18, 1.18);
    mesh.scale.copy(mesh.userData.base).multiply(bump);
    if (mesh.userData.kind === 'ghost' && selected) {
      const a = worldPos(selected);
      const b = mesh.position;
      previewMat.color.setHex(COLORS[currentColor]);
      previewRod.position.copy(a).add(b).multiplyScalar(0.5);
      previewRod.quaternion.setFromUnitVectors(UP, b.clone().sub(a).normalize());
      previewRod.scale.set(ROD_R, a.distanceTo(b), ROD_R);
      previewRod.visible = true;
    }
  }
  document.body.style.cursor = mesh ? 'pointer' : 'default';
}

renderer.domElement.addEventListener('pointermove', (e) => setHover(pick(e)));
renderer.domElement.addEventListener('pointerdown', (e) => {
  downAt = { x: e.clientX, y: e.clientY, button: e.button };
});
renderer.domElement.addEventListener('pointerup', (e) => {
  const wasClick =
    downAt && Math.hypot(e.clientX - downAt.x, e.clientY - downAt.y) < 6;
  downAt = null;
  if (!wasClick) return;
  const mesh = pick(e);
  setHover(null);

  if (e.button === 2) {
    if (mesh?.userData.kind === 'ball') structure.removeBall(mesh.userData.key);
    if (mesh?.userData.kind === 'rod') structure.removeRod(mesh.userData.rk);
    if (mesh) sync();
    return;
  }
  if (!mesh) return select(null);
  const { kind } = mesh.userData;
  if (kind === 'ball') select(mesh.userData.key);
  if (kind === 'ghost') {
    const toKey = structure.grow(selected, mesh.userData.step, currentColor);
    select(toKey ?? selected); // encadena: la bola nueva queda seleccionada
    sync();
  }
});
renderer.domElement.addEventListener('contextmenu', (e) => e.preventDefault());

addEventListener('keydown', (e) => {
  if ((e.metaKey || e.ctrlKey) && e.key === 'z') {
    e.preventDefault();
    if (structure.undo()) sync();
    return;
  }
  if (e.key === 'Escape') select(null);
  const names = Object.keys(COLORS);
  if (names[Number(e.key) - 1]) setColor(names[Number(e.key) - 1]);
});

// ------------------------------------------------------------------------ HUD

const hud = {
  count: document.getElementById('count'),
  swatches: document.getElementById('swatches'),
};

function setColor(name) {
  currentColor = name;
  for (const el of hud.swatches.children)
    el.classList.toggle('active', el.dataset.color === name);
}

for (const [name, hex] of Object.entries(COLORS)) {
  const el = document.createElement('button');
  el.className = 'swatch';
  el.dataset.color = name;
  el.title = name;
  el.style.background = '#' + hex.toString(16).padStart(6, '0');
  el.addEventListener('click', () => setColor(name));
  hud.swatches.appendChild(el);
}
setColor(currentColor);

function updateHud() {
  hud.count.textContent = `${structure.balls.size} bolas · ${structure.rods.size} barras`;
}

document.getElementById('undo').addEventListener('click', () => {
  if (structure.undo()) sync();
});
document.getElementById('reset').addEventListener('click', () => {
  if (confirm('¿Empezar de cero? (puedes deshacer con ⌘Z)')) {
    structure.reset();
    select(null);
    sync();
  }
});
document.getElementById('export').addEventListener('click', () => {
  const blob = new Blob([JSON.stringify(structure.toJSON(), null, 2)], {
    type: 'application/json',
  });
  const a = Object.assign(document.createElement('a'), {
    href: URL.createObjectURL(blob),
    download: 'geomag.json',
  });
  a.click();
  URL.revokeObjectURL(a.href);
});
const fileInput = document.getElementById('file');
document.getElementById('import').addEventListener('click', () => fileInput.click());
fileInput.addEventListener('change', async () => {
  const file = fileInput.files[0];
  if (!file) return;
  try {
    structure.load(JSON.parse(await file.text()));
    select(null);
    sync();
  } catch {
    alert('Ese archivo no parece un geomag.json válido.');
  }
  fileInput.value = '';
});

// ----------------------------------------------------------------- arranque

try {
  const saved = localStorage.getItem('geomag-autosave');
  if (saved) structure.restore(JSON.parse(saved));
} catch { /* autosave corrupto: empezamos de cero */ }

addEventListener('resize', () => {
  camera.aspect = innerWidth / innerHeight;
  camera.updateProjectionMatrix();
  renderer.setSize(innerWidth, innerHeight);
});

sync();
renderer.setAnimationLoop(() => {
  controls.update();
  renderer.render(scene, camera);
});

// Para trastear desde la consola.
window.geomag = { structure, sync, select, camera, scene, renderer };
