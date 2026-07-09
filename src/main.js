// Vista e interacción: three.js sincronizado con el modelo puro.
// La escena nunca es la fuente de verdad: tras cada mutación se hace un
// diff modelo→meshes (sync), y cada frame se copian las posiciones del
// modelo a los meshes (las bolas ahora se mueven: el solver manda).

import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { RoomEnvironment } from 'three/addons/environments/RoomEnvironment.js';
import { Structure, PANEL_TYPES, DIRECTION_MODES, rodEnds } from './structure.js';
import { relax, residual, Gravity, clampFloor } from './solver.js';

const BALL_R = 0.22;
const ROD_R = 0.06;
// El suelo vive en el centro de bola y=0 — coherente con el p[1]<0 que ya
// usaba la gravedad, y con la rejilla, que está pintada en y=-BALL_R.
const FLOOR_Y = 0;

const ROD_COLORS = {
  amarillo: 0xffc93c,
  rojo: 0xe5484d,
  azul: 0x3e63dd,
  verde: 0x30a46c,
};
// Los colores canónicos de la caja: cada forma tiene el suyo.
const PANEL_COLORS = {
  triangulo: 0x30a46c,
  cuadrado: 0x3e63dd,
  rombo: 0xffc93c,
  pentagono: 0xe5484d,
};

const structure = new Structure();
const gravity = new Gravity();
let gravityOn = false;
let floorOn = true; // la mesa invisible en y=0: se puede apagar para construir al vacío
let selected = null; // id de la bola seleccionada, o null
let mode = { kind: 'rod', color: 'amarillo' }; // o { kind: 'panel', type }
let dirMode = 'diagonales'; // qué juego de ejes sugieren los fantasmas
let orientMode = 'global'; // cómo se orienta ese juego de ejes: global, vista o local

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

// Dos cámaras que comparten posición y objetivo: la perspectiva es la que
// usamos para construir (da profundidad, como mirar la mesa de verdad); la
// ortográfica sirve para alinear piezas sin la fuga, como un plano técnico.
// `activeCamera` es la que de verdad se usa en cada sitio — render,
// picking, arrastre —; la otra queda sincronizada para cuando el usuario
// alterne entre ellas.
const perspCamera = new THREE.PerspectiveCamera(50, innerWidth / innerHeight, 0.1, 100);
perspCamera.position.set(4.5, 3.5, 7);

const orthoCamera = new THREE.OrthographicCamera(-1, 1, 1, -1, 0.1, 100);
orthoCamera.position.copy(perspCamera.position);

let activeCamera = perspCamera;
let projection = 'perspectiva'; // o 'ortográfica'

// El frustum de la ortográfica se recalcula a partir de la distancia
// cámara→objetivo y el fov vertical de la perspectiva, para que el
// encuadre no dé un salto al alternar entre las dos.
function syncOrthoFrustum(dist) {
  const aspect = innerWidth / innerHeight;
  const halfH = dist * Math.tan(THREE.MathUtils.degToRad(perspCamera.fov / 2));
  const halfW = halfH * aspect;
  orthoCamera.left = -halfW;
  orthoCamera.right = halfW;
  orthoCamera.top = halfH;
  orthoCamera.bottom = -halfH;
  orthoCamera.updateProjectionMatrix();
}

// OrbitControls no admite cambiar de cámara sobre la marcha: al alternar
// proyección los tiramos y creamos otros nuevos sobre la cámara activa,
// con el mismo objetivo. Encapsulado aquí para no duplicar su configuración.
function makeControls(cam, target) {
  const c = new OrbitControls(cam, renderer.domElement);
  c.target.copy(target);
  c.enableDamping = true;
  c.maxDistance = 30;
  // en modo vista los fantasmas siguen a la cámara: un flag basta, que el
  // bucle de animación consuma como mucho una vez por frame
  c.addEventListener('change', () => {
    if (orientMode === 'vista' && selected) ghostsDirty = true;
  });
  return c;
}

let controls = makeControls(perspCamera, new THREE.Vector3(0, 0.8, 0));
syncOrthoFrustum(perspCamera.position.distanceTo(controls.target));

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
  Object.entries(ROD_COLORS).map(([name, hex]) => [
    name,
    new THREE.MeshStandardMaterial({ color: hex, metalness: 0.4, roughness: 0.35 }),
  ])
);
const panelMats = Object.fromEntries(
  Object.entries(PANEL_COLORS).map(([name, hex]) => [
    name,
    new THREE.MeshStandardMaterial({
      color: hex, metalness: 0.1, roughness: 0.4,
      transparent: true, opacity: 0.5, side: THREE.DoubleSide,
    }),
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
const candMat = new THREE.MeshBasicMaterial({
  color: 0xffffff, transparent: true, opacity: 0.1,
  side: THREE.DoubleSide, depthWrite: false,
});
const candHotMat = new THREE.MeshBasicMaterial({
  color: 0xffffff, transparent: true, opacity: 0.35,
  side: THREE.DoubleSide, depthWrite: false,
});

// ----------------------------------------------------------- modelo → meshes

const world = new THREE.Group();
scene.add(world);
const ballMeshes = new Map(); // id -> Mesh
const rodMeshes = new Map(); // rodKey -> Mesh
const panelMeshes = new Map(); // panelKey -> Mesh (membrana)

const UP = new THREE.Vector3(0, 1, 0);
const va = new THREE.Vector3();
const vb = new THREE.Vector3();

function orientRod(mesh, aId, bId) {
  va.set(...structure.balls.get(aId));
  vb.set(...structure.balls.get(bId));
  mesh.position.copy(va).add(vb).multiplyScalar(0.5);
  vb.sub(va);
  const len = vb.length() || 1e-9;
  mesh.quaternion.setFromUnitVectors(UP, vb.divideScalar(len));
  mesh.scale.set(ROD_R, len, ROD_R);
}

// Una membrana es un abanico de triángulos alrededor del centroide del
// ciclo; se re-teje cada frame porque las bolas se mueven.
function makeMembrane(cycle, material, userData) {
  const n = cycle.length;
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.BufferAttribute(new Float32Array((n + 1) * 3), 3));
  geo.setIndex(
    Array.from({ length: n }, (_, i) => [0, 1 + i, 1 + ((i + 1) % n)]).flat()
  );
  const mesh = new THREE.Mesh(geo, material);
  mesh.userData = { cycle, base: mesh.scale.clone(), ...userData };
  return mesh;
}

function updateMembrane(mesh) {
  const { cycle } = mesh.userData;
  const pos = mesh.geometry.attributes.position;
  const c = [0, 0, 0];
  cycle.forEach((id, i) => {
    const p = structure.balls.get(id);
    pos.setXYZ(i + 1, ...p);
    c.forEach((_, k) => (c[k] += p[k] / cycle.length));
  });
  pos.setXYZ(0, ...c);
  pos.needsUpdate = true;
  mesh.geometry.computeVertexNormals();
  mesh.geometry.computeBoundingSphere();
}

function sync() {
  for (const [id, mesh] of ballMeshes)
    if (!structure.balls.has(id)) {
      world.remove(mesh);
      ballMeshes.delete(id);
    }
  for (const id of structure.balls.keys())
    if (!ballMeshes.has(id)) {
      const mesh = new THREE.Mesh(ballGeo, ballMat);
      mesh.castShadow = true;
      mesh.userData = { kind: 'ball', id, base: mesh.scale.clone() };
      world.add(mesh);
      ballMeshes.set(id, mesh);
    }

  for (const [rk, mesh] of rodMeshes)
    if (structure.rods.get(rk) !== mesh.userData.color) {
      world.remove(mesh);
      rodMeshes.delete(rk);
    }
  for (const [rk, color] of structure.rods)
    if (!rodMeshes.has(rk)) {
      const mesh = new THREE.Mesh(rodGeo, rodMats[color] ?? rodMats.amarillo);
      mesh.castShadow = true;
      mesh.userData = { kind: 'rod', rk, color, base: new THREE.Vector3(1, 1, 1) };
      world.add(mesh);
      rodMeshes.set(rk, mesh);
    }

  for (const [pk, mesh] of panelMeshes)
    if (!structure.panels.has(pk)) {
      world.remove(mesh);
      mesh.geometry.dispose();
      panelMeshes.delete(pk);
    }
  for (const [pk, panel] of structure.panels)
    if (!panelMeshes.has(pk)) {
      const mesh = makeMembrane(panel.cycle, panelMats[panel.type], {
        kind: 'panel', pk,
      });
      world.add(mesh);
      panelMeshes.set(pk, mesh);
    }

  for (const id of gravity.prev.keys())
    if (!structure.balls.has(id)) gravity.prev.delete(id);

  if (selected && !structure.balls.has(selected)) select(null);
  refreshGhosts();
  refreshCandidates();
  updateHud();
  localStorage.setItem('geomag-autosave', JSON.stringify(structure.toJSON()));
}

// ------------------------------------------------- fantasmas y candidatos

const ghosts = new THREE.Group();
scene.add(ghosts);
const candidates = new THREE.Group();
scene.add(candidates);

const marker = new THREE.Mesh(
  new THREE.SphereGeometry(BALL_R * 1.35, 24, 12),
  new THREE.MeshBasicMaterial({ color: 0xffffff, wireframe: true, transparent: true, opacity: 0.25 })
);
marker.visible = false;
scene.add(marker);

const previewRod = new THREE.Mesh(rodGeo, previewMat);
previewRod.visible = false;
scene.add(previewRod);

// El marco que orienta el juego de ejes de sugerencia. En global son los
// ejes del mundo tal cual; en vista, los de la cámara (derecha/arriba/
// adelante); en local, el esqueleto de barras que ya salen de la bola —
// así, sobre una estructura ya relajada donde la red original se ha
// deformado, los fantasmas siguen ofreciendo lo que de verdad encaja ahí.
function orientFrame(ballId) {
  if (orientMode === 'global') return new THREE.Quaternion();
  if (orientMode === 'vista') return activeCamera.quaternion.clone();

  const from = new THREE.Vector3(...structure.balls.get(ballId));
  const dirs = [];
  for (const rk of structure.rods.keys()) {
    const [a, b] = rodEnds(rk);
    if (a !== ballId && b !== ballId) continue;
    const other = a === ballId ? b : a;
    const v = new THREE.Vector3(...structure.balls.get(other)).sub(from);
    if (v.lengthSq() > 1e-9) dirs.push(v.normalize());
  }
  if (dirs.length === 0) return new THREE.Quaternion();

  const steps = DIRECTION_MODES[dirMode].map((s) => new THREE.Vector3(...s).normalize());
  const r1 = dirs[0];
  let i1 = 0, best = -Infinity;
  steps.forEach((s, i) => {
    const d = s.dot(r1);
    if (d > best) { best = d; i1 = i; }
  });
  const q1 = new THREE.Quaternion().setFromUnitVectors(steps[i1], r1);
  if (dirs.length < 2) return q1;

  // segunda barra: busca el paso (distinto del primero) que más se le
  // parece, y el "twist" alrededor de r1 que mejor alinea ambos.
  const r2 = dirs[1];
  let i2 = -1;
  best = -Infinity;
  steps.forEach((s, i) => {
    if (i === i1) return;
    const d = s.dot(r2);
    if (d > best) { best = d; i2 = i; }
  });
  if (i2 === -1) return q1;
  const s2 = steps[i2].clone().applyQuaternion(q1);
  const onPlane = (v) => v.clone().addScaledVector(r1, -v.dot(r1));
  const ps2 = onPlane(s2);
  const pr2 = onPlane(r2);
  if (ps2.lengthSq() < 1e-9 || pr2.lengthSq() < 1e-9) return q1;
  ps2.normalize();
  pr2.normalize();
  let angle = Math.acos(THREE.MathUtils.clamp(ps2.dot(pr2), -1, 1));
  if (new THREE.Vector3().crossVectors(ps2, pr2).dot(r1) < 0) angle = -angle;
  const twist = new THREE.Quaternion().setFromAxisAngle(r1, angle);
  return twist.multiply(q1);
}

function refreshGhosts() {
  ghosts.clear();
  previewRod.visible = false;
  marker.visible = Boolean(selected);
  if (!selected) return;
  const q = orientFrame(selected);
  const steps = DIRECTION_MODES[dirMode].map((s) =>
    new THREE.Vector3(...s).applyQuaternion(q).toArray()
  );
  for (const cand of structure.candidates(selected, steps)) {
    const link = cand.kind === 'link';
    const mesh = new THREE.Mesh(ballGeo, link ? ghostLinkMat : ghostMat);
    mesh.scale.setScalar(link ? 1.3 : 0.8);
    mesh.userData = { kind: 'ghost', cand, base: mesh.scale.clone() };
    ghosts.add(mesh);
  }
}

// En modo panel, cada hueco (ciclo abierto del tamaño de la pieza) se
// ofrece como membrana tenue clicable.
function refreshCandidates() {
  for (const m of candidates.children) m.geometry.dispose();
  candidates.clear();
  if (mode.kind !== 'panel') return;
  for (const cycle of structure.openCycles(PANEL_TYPES[mode.type].sides))
    candidates.add(makeMembrane(cycle, candMat, { kind: 'cand', cycle }));
}

function select(id) {
  selected = id;
  refreshGhosts();
}

// Copia modelo→meshes; corre cada frame porque el solver mueve las bolas.
function updateTransforms() {
  for (const [id, mesh] of ballMeshes) mesh.position.set(...structure.balls.get(id));
  for (const [rk, mesh] of rodMeshes) orientRod(mesh, ...rodEnds(rk));
  for (const mesh of panelMeshes.values()) updateMembrane(mesh);
  for (const mesh of candidates.children) updateMembrane(mesh);
  if (selected) {
    const from = structure.balls.get(selected);
    marker.position.set(...from);
    for (const g of ghosts.children) {
      const { cand } = g.userData;
      if (cand.kind === 'new') g.position.set(...from.map((v, i) => v + cand.step[i]));
      else g.position.set(...structure.balls.get(cand.to));
    }
  }
}

// ---------------------------------------------------------------- interacción

const raycaster = new THREE.Raycaster();
const pointer = new THREE.Vector2();
let hovered = null;
let downAt = null; // { x, y } al pulsar: si el puntero no se mueve, es un clic
let downBallId = null; // bola bajo el puntero al pulsar, candidata a arrastre
let dragging = null; // arrastre en curso, o null
let ghostsDirty = false; // en modo vista, la cámara mueve los fantasmas: una vez por frame

function pick(event) {
  const rect = renderer.domElement.getBoundingClientRect();
  pointer.set(
    ((event.clientX - rect.left) / rect.width) * 2 - 1,
    -((event.clientY - rect.top) / rect.height) * 2 + 1
  );
  raycaster.setFromCamera(pointer, activeCamera);
  const hit = raycaster.intersectObjects([
    ...ghosts.children,
    ...candidates.children,
    ...ballMeshes.values(),
    ...rodMeshes.values(),
    ...panelMeshes.values(),
  ])[0];
  return hit?.object ?? null;
}

function setHover(mesh) {
  if (hovered === mesh) return;
  if (hovered) {
    hovered.scale.copy(hovered.userData.base);
    if (hovered.userData.kind === 'cand') hovered.material = candMat;
  }
  hovered = mesh;
  previewRod.visible = false;
  if (mesh) {
    const { kind } = mesh.userData;
    if (kind === 'cand') mesh.material = candHotMat;
    else if (kind === 'rod') mesh.scale.multiply(new THREE.Vector3(1.6, 1, 1.6));
    else if (kind !== 'panel') mesh.scale.multiplyScalar(1.18);
    if (kind === 'ghost' && selected && mode.kind === 'rod') {
      previewMat.color.setHex(ROD_COLORS[mode.color]);
      previewRod.visible = true; // se orienta en updateTransforms… aquí:
      const a = new THREE.Vector3(...structure.balls.get(selected));
      const b = mesh.position.clone();
      previewRod.position.copy(a).add(b).multiplyScalar(0.5);
      previewRod.quaternion.setFromUnitVectors(UP, b.sub(a).normalize());
      previewRod.scale.set(ROD_R, a.distanceTo(mesh.position), ROD_R);
    }
  }
  document.body.style.cursor = mesh ? 'pointer' : 'default';
}

// --------------------------------------------------------- arrastrar bolas

// Punto de la recta (origin + t·dir) más cercano a una recta-rayo: la
// fórmula clásica del punto más próximo entre dos rectas que se cruzan
// en el espacio. Con ambas direcciones normalizadas se simplifica bastante.
function closestPointOnLine(origin, dir, ray, out) {
  const r = vDelta.subVectors(ray.origin, origin);
  const b = ray.direction.dot(dir);
  const dr1 = ray.direction.dot(r);
  const dr2 = dir.dot(r);
  const denom = b * b - 1;
  const s = Math.abs(denom) < 1e-6 ? 0 : (b * dr1 - dr2) / denom;
  out.copy(dir).multiplyScalar(s).add(origin);
}
const vDelta = new THREE.Vector3(); // vector reutilizable, para no crear basura cada frame
const dragHit = new THREE.Vector3();

function startDrag(id, e) {
  setHover(null);
  dragging = {
    id,
    axis: null, // null, 'x', 'y' o 'z': eje al que queda restringido el movimiento
    axisDir: new THREE.Vector3(),
    startPos: new THREE.Vector3(...structure.balls.get(id)),
    plane: new THREE.Plane(),
    target: new THREE.Vector3(...structure.balls.get(id)),
  };
  structure.snapshot(); // una sola instantánea: ⌘Z deshace el arrastre entero
  select(id);
  controls.enabled = false;
  renderer.domElement.setPointerCapture(e.pointerId);
  document.body.style.cursor = 'grabbing';
  // el plano de arrastre pasa por la bola y mira a la cámara (plano de pantalla)
  const normal = new THREE.Vector3();
  activeCamera.getWorldDirection(normal);
  dragging.plane.setFromNormalAndCoplanarPoint(normal, dragging.startPos);
  updateDragTarget(e);
}

function updateDragTarget(e) {
  const rect = renderer.domElement.getBoundingClientRect();
  pointer.set(
    ((e.clientX - rect.left) / rect.width) * 2 - 1,
    -((e.clientY - rect.top) / rect.height) * 2 + 1
  );
  raycaster.setFromCamera(pointer, activeCamera);
  if (dragging.axis) {
    closestPointOnLine(dragging.startPos, dragging.axisDir, raycaster.ray, dragHit);
    dragging.target.copy(dragHit);
  } else if (raycaster.ray.intersectPlane(dragging.plane, dragHit)) {
    dragging.target.copy(dragHit);
  }
  // no se puede arrastrar una bola bajo la mesa: el suelo también manda aquí
  if (floorOn) dragging.target.y = Math.max(dragging.target.y, FLOOR_Y);
}

const AXIS_VECTORS = {
  x: new THREE.Vector3(1, 0, 0),
  y: new THREE.Vector3(0, 1, 0),
  z: new THREE.Vector3(0, 0, 1),
};

function setAxisLock(axis) {
  if (!dragging) return;
  if (dragging.axis === axis) {
    dragging.axis = null;
    toast('eje libre');
    return;
  }
  const q = orientFrame(dragging.id);
  dragging.axisDir.copy(AXIS_VECTORS[axis]).applyQuaternion(q).normalize();
  dragging.axis = axis;
  toast(`eje ${axis.toUpperCase()}`);
}

function endDrag(e) {
  renderer.domElement.releasePointerCapture(e.pointerId);
  controls.enabled = true;
  dragging = null;
  downAt = null;
  downBallId = null; // si no, el siguiente movimiento re-agarraría la bola
  document.body.style.cursor = 'default';
  gravity.forget();
  settle();
  sync();
}

function settle() {
  if (!gravityOn) relax(structure, 80, undefined, floorOn ? FLOOR_Y : null);
}

function placePanel(cycle, type) {
  if (!structure.addPanel(cycle, type)) return;
  relax(structure, 150);
  if (residual(structure) > 0.08) {
    structure.undo();
    relax(structure, 40);
    toast('ese panel no encaja ahí');
  }
  gravity.forget();
  sync();
}

renderer.domElement.addEventListener('pointermove', (e) => {
  if (dragging) {
    updateDragTarget(e);
    return;
  }
  if (downBallId && Math.hypot(e.clientX - downAt.x, e.clientY - downAt.y) > 6) {
    startDrag(downBallId, e);
    return;
  }
  setHover(pick(e));
});
renderer.domElement.addEventListener('pointerdown', (e) => {
  downAt = { x: e.clientX, y: e.clientY };
  const mesh = e.button === 0 ? pick(e) : null;
  downBallId = mesh?.userData.kind === 'ball' ? mesh.userData.id : null;
});
renderer.domElement.addEventListener('pointerup', (e) => {
  if (dragging) {
    endDrag(e);
    return;
  }
  const wasClick =
    downAt && Math.hypot(e.clientX - downAt.x, e.clientY - downAt.y) < 6;
  downAt = null;
  downBallId = null;
  if (!wasClick) return;
  const mesh = pick(e);
  setHover(null);

  if (e.button === 2) {
    if (!mesh) return;
    const { kind, id, rk, pk } = mesh.userData;
    if (kind === 'ball') structure.removeBall(id);
    else if (kind === 'rod') structure.removeRod(rk);
    else if (kind === 'panel') structure.removePanel(pk);
    else return;
    settle();
    sync();
    return;
  }

  if (!mesh) return select(null);
  const { kind } = mesh.userData;
  if (kind === 'ball') select(mesh.userData.id);
  if (kind === 'cand') placePanel(mesh.userData.cycle, mode.type);
  if (kind === 'ghost' && selected) {
    const { cand } = mesh.userData;
    const color = mode.kind === 'rod' ? mode.color : 'amarillo';
    const to =
      cand.kind === 'new'
        ? structure.grow(selected, cand.step, color)
        : structure.link(selected, cand.to, color);
    settle();
    select(to ?? selected); // encadena: la bola nueva queda seleccionada
    sync();
  }
});
renderer.domElement.addEventListener('contextmenu', (e) => e.preventDefault());
renderer.domElement.addEventListener('pointercancel', (e) => {
  if (dragging) endDrag(e);
});

addEventListener('keydown', (e) => {
  // Deshacer: miramos la tecla física (e.code === 'KeyZ') además de e.key,
  // porque según la distribución del teclado o si hay mayúsculas de por
  // medio, e.key puede no ser exactamente 'z' y el atajo se escapaba.
  if ((e.metaKey || e.ctrlKey) && (e.code === 'KeyZ' || e.key === 'z' || e.key === 'Z')) {
    e.preventDefault();
    undo();
    return;
  }
  if (e.key === 'Escape') {
    select(null);
    setMode({ kind: 'rod', color: mode.color ?? 'amarillo' });
  }
  if (e.key === 'e') cycleAxes();
  if (e.key === 'o') cycleOrient();
  if (e.key === 'f') frameTarget();
  if (dragging && /^[xyz]$/i.test(e.key)) setAxisLock(e.key.toLowerCase());
  const rods = Object.keys(ROD_COLORS);
  const panels = Object.keys(PANEL_TYPES);
  const n = Number(e.key);
  if (rods[n - 1]) setMode({ kind: 'rod', color: rods[n - 1] });
  if (panels[n - 5]) setMode({ kind: 'panel', type: panels[n - 5] });
});

function undo() {
  if (!structure.undo()) return;
  gravity.forget();
  settle();
  sync();
}

// ------------------------------------------------------------------------ HUD

const hud = {
  count: document.getElementById('count'),
  rodTray: document.getElementById('rod-tray'),
  panelTray: document.getElementById('panel-tray'),
  toast: document.getElementById('toast'),
  gravity: document.getElementById('gravity'),
  floor: document.getElementById('floor'),
  projection: document.getElementById('projection'),
  frame: document.getElementById('frame'),
  axes: document.getElementById('axes'),
  orient: document.getElementById('orient'),
};

function cycleAxes() {
  const names = Object.keys(DIRECTION_MODES);
  dirMode = names[(names.indexOf(dirMode) + 1) % names.length];
  hud.axes.textContent = `ejes: ${dirMode}`;
  refreshGhosts();
}
hud.axes.addEventListener('click', cycleAxes);

const ORIENT_MODES = ['global', 'vista', 'local'];
function cycleOrient() {
  orientMode = ORIENT_MODES[(ORIENT_MODES.indexOf(orientMode) + 1) % ORIENT_MODES.length];
  hud.orient.textContent = `orientación: ${orientMode}`;
  refreshGhosts();
}
hud.orient.addEventListener('click', cycleOrient);

const PANEL_SHAPES = {
  triangulo: '<polygon points="12,3 22,21 2,21"/>',
  cuadrado: '<rect x="4" y="4" width="16" height="16"/>',
  rombo: '<polygon points="2,12 12,6.2 22,12 12,17.8"/>',
  pentagono: '<polygon points="12,3 21.5,9.9 17.9,21.1 6.1,21.1 2.5,9.9"/>',
};

function trayButton(parent, html, title, onClick) {
  const el = document.createElement('button');
  el.className = 'piece';
  el.title = title;
  el.innerHTML = html + '<span class="n"></span>';
  el.addEventListener('click', onClick);
  parent.appendChild(el);
  return el;
}

const trayButtons = [];
for (const [name, hex] of Object.entries(ROD_COLORS)) {
  const css = '#' + hex.toString(16).padStart(6, '0');
  const el = trayButton(
    hud.rodTray,
    `<span class="rodicon" style="background:${css}"></span>`,
    `barra ${name}`,
    () => setMode({ kind: 'rod', color: name })
  );
  trayButtons.push({ el, match: (m) => m.kind === 'rod' && m.color === name, count: () => [...structure.rods.values()].filter((c) => c === name).length });
}
for (const [name, hex] of Object.entries(PANEL_COLORS)) {
  const css = '#' + hex.toString(16).padStart(6, '0');
  const el = trayButton(
    hud.panelTray,
    `<svg viewBox="0 0 24 24" fill="${css}">${PANEL_SHAPES[name]}</svg>`,
    `panel ${name}`,
    () => setMode({ kind: 'panel', type: name })
  );
  trayButtons.push({ el, match: (m) => m.kind === 'panel' && m.type === name, count: () => [...structure.panels.values()].filter((p) => p.type === name).length });
}

function setMode(next) {
  mode = next;
  for (const { el, match } of trayButtons)
    el.classList.toggle('active', match(mode));
  refreshCandidates();
}
setMode(mode);

function updateHud() {
  hud.count.textContent = `${structure.balls.size} bolas · ${structure.rods.size} barras · ${structure.panels.size} paneles`;
  for (const { el, count } of trayButtons)
    el.querySelector('.n').textContent = count() || '';
}

let toastTimer = null;
function toast(msg) {
  hud.toast.textContent = msg;
  hud.toast.classList.add('show');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => hud.toast.classList.remove('show'), 1800);
}

hud.gravity.addEventListener('click', () => {
  gravityOn = !gravityOn;
  gravity.forget();
  hud.gravity.textContent = `gravedad: ${gravityOn ? 'sí' : 'no'}`;
  hud.gravity.classList.toggle('on', gravityOn);
  if (!gravityOn) {
    relax(structure, 60, undefined, floorOn ? FLOOR_Y : null);
    localStorage.setItem('geomag-autosave', JSON.stringify(structure.toJSON()));
  }
});

// El suelo es independiente de la gravedad: una mesa de verdad, no un
// campo de fuerzas. Apagarla dejar caer piezas al vacío bajo gravedad, o
// permite arrastrar/construir por debajo de y=0 sin gravedad de por medio.
hud.floor.addEventListener('click', () => {
  floorOn = !floorOn;
  gravity.forget();
  hud.floor.textContent = `suelo: ${floorOn ? 'sí' : 'no'}`;
  hud.floor.classList.toggle('on', floorOn);
  settle();
  sync();
});
hud.floor.classList.toggle('on', floorOn);

// ------------------------------------------------------------ cámara: Blender-style

hud.projection.addEventListener('click', toggleProjection);

function toggleProjection() {
  const target = controls.target.clone();
  const dist = activeCamera.position.distanceTo(target) || 6;
  if (activeCamera === perspCamera) {
    orthoCamera.position.copy(perspCamera.position);
    orthoCamera.quaternion.copy(perspCamera.quaternion);
    orthoCamera.up.copy(perspCamera.up);
    syncOrthoFrustum(dist);
    activeCamera = orthoCamera;
    projection = 'ortográfica';
  } else {
    perspCamera.position.copy(orthoCamera.position);
    perspCamera.quaternion.copy(orthoCamera.quaternion);
    perspCamera.up.copy(orthoCamera.up);
    activeCamera = perspCamera;
    projection = 'perspectiva';
  }
  controls.dispose();
  controls = makeControls(activeCamera, target);
  window.geomag.camera = activeCamera;
  hud.projection.textContent = `proyección: ${projection}`;
}

hud.frame.addEventListener('click', frameTarget);

// Recentra el pivote de la órbita: en la bola seleccionada, o si no hay
// ninguna, en el centro de todo lo construido — como el "frame selected/all"
// de Blender. La distancia a la cámara se conserva salvo en "frame all",
// donde se retrocede lo justo para que quepa la caja entera.
function frameTarget() {
  const dir = new THREE.Vector3().subVectors(activeCamera.position, controls.target);
  let dist = dir.length() || 6;
  if (dir.lengthSq() < 1e-9) dir.set(0.4, 0.3, 1);
  dir.normalize();

  const target = new THREE.Vector3();
  if (selected) {
    target.set(...structure.balls.get(selected));
  } else {
    const box = new THREE.Box3();
    for (const p of structure.balls.values()) box.expandByPoint(new THREE.Vector3(...p));
    box.getCenter(target);
    dist = Math.max(box.getSize(new THREE.Vector3()).length() * 1.2, 4);
  }
  controls.target.copy(target);
  activeCamera.position.copy(target).addScaledVector(dir, dist);
  if (activeCamera === orthoCamera) syncOrthoFrustum(dist);
  controls.update();
}

// Vistas rápidas: reubican la cámara sobre un eje mirando al objetivo
// actual, conservando la distancia — sin tocar teclas, para no chocar con
// las de piezas/ejes.
const QUICK_VIEW_DIRS = {
  frente: new THREE.Vector3(0, 0, -1), // mira por -Z hacia +Z
  lado: new THREE.Vector3(1, 0, 0), // se asoma por +X
  arriba: new THREE.Vector3(0, 1, 0), // cae en picado por +Y
};
function setQuickView(name) {
  const dist = activeCamera.position.distanceTo(controls.target) || 6;
  // en vista cenital el "arriba" de la cámara mira hacia -Z; en las demás, +Y
  activeCamera.up.set(0, name === 'arriba' ? 0 : 1, name === 'arriba' ? -1 : 0);
  activeCamera.position.copy(controls.target).addScaledVector(QUICK_VIEW_DIRS[name], dist);
  activeCamera.lookAt(controls.target);
  if (activeCamera === orthoCamera) syncOrthoFrustum(dist);
  controls.update();
}
document.getElementById('view-front').addEventListener('click', () => setQuickView('frente'));
document.getElementById('view-side').addEventListener('click', () => setQuickView('lado'));
document.getElementById('view-top').addEventListener('click', () => setQuickView('arriba'));

document.getElementById('undo').addEventListener('click', undo);
document.getElementById('reset').addEventListener('click', () => {
  if (confirm('¿Empezar de cero? (puedes deshacer con ⌘Z)')) {
    structure.reset();
    gravity.forget();
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
    gravity.forget();
    select(null);
    if (floorOn) clampFloor(structure, undefined, FLOOR_Y); // snap inmediato antes de relajar
    settle();
    sync();
  } catch {
    alert('Ese archivo no parece un geomag.json válido.');
  }
  fileInput.value = '';
});

// ----------------------------------------------------------------- arranque

try {
  const saved = localStorage.getItem('geomag-autosave');
  if (saved) {
    structure.restore(JSON.parse(saved));
    if (floorOn) clampFloor(structure, undefined, FLOOR_Y); // snap inmediato antes de relajar
    relax(structure, 60, undefined, floorOn ? FLOOR_Y : null);
  }
} catch { /* autosave corrupto: empezamos de cero */ }

addEventListener('resize', () => {
  perspCamera.aspect = innerWidth / innerHeight;
  perspCamera.updateProjectionMatrix();
  syncOrthoFrustum(orthoCamera.position.distanceTo(controls.target));
  renderer.setSize(innerWidth, innerHeight);
});

sync();
renderer.setAnimationLoop(() => {
  if (dragging) {
    // la bola arrastrada queda clavada en su posición objetivo; el solver
    // reparte el estirón entre el resto de la estructura, no en ella
    const pinned = new Set([dragging.id]);
    dragging.target.toArray(structure.balls.get(dragging.id));
    const floorY = floorOn ? FLOOR_Y : null;
    if (gravityOn) gravity.step(structure, 1 / 60, pinned, floorY);
    else relax(structure, 30, pinned, floorY);
  } else if (gravityOn) {
    gravity.step(structure, 1 / 60, undefined, floorOn ? FLOOR_Y : null);
  }
  if (ghostsDirty) {
    refreshGhosts();
    ghostsDirty = false;
  }
  updateTransforms();
  controls.update();
  renderer.render(scene, activeCamera);
});

// Para trastear desde la consola. `camera` apunta a la cámara activa;
// toggleProjection lo reasigna al alternar perspectiva/ortográfica.
window.geomag = { structure, sync, select, setMode, placePanel, relax, residual, camera: activeCamera, scene, renderer };
