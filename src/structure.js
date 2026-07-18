// Modelo puro: bolas, barras y paneles. Sin three.js, sin DOM: solo datos.
//
// Antes las posiciones vivían clavadas en una rejilla entera (red FCC).
// Ahora son libres: el solver (src/solver.js) es quien mantiene cada barra
// a su longitud, como hacen los imanes. La red FCC sobrevive como
// *sugerencia* de colocación, y los paneles aportan cuerdas internas que
// rigidizan la figura — exactamente el papel que tenían en el juguete.

export const ROD_LENGTH = Math.SQRT2; // así las sugerencias FCC son enteras
export const PHI = (1 + Math.sqrt(5)) / 2;
const L = ROD_LENGTH;

// Las 12 direcciones FCC, ya a longitud de barra: permutaciones de (±1,±1,0).
export const STEPS = (() => {
  const steps = [];
  for (const a of [1, -1])
    for (const b of [1, -1])
      steps.push([a, b, 0], [a, 0, b], [0, a, b]);
  return steps;
})();

// Juegos de ejes alternativos al tocar una bola. Con el solver mandando,
// las direcciones son pura sugerencia: se mezclan en la misma estructura.
// Los diagonales (FCC) dan tetraedros y octaedros; los cúbicos, torres
// rectas y cubos (imposibles en FCC: no hay 3 pasos perpendiculares);
// los hexagonales, hexágonos con centro y prismas.
export const DIRECTION_MODES = {
  diagonales: STEPS,
  cúbicos: [
    [L, 0, 0], [-L, 0, 0], [0, L, 0], [0, -L, 0], [0, 0, L], [0, 0, -L],
  ],
  hexagonales: [
    ...Array.from({ length: 6 }, (_, k) => [
      L * Math.cos((k * Math.PI) / 3), 0, L * Math.sin((k * Math.PI) / 3),
    ]),
    [0, L, 0], [0, -L, 0],
  ],
  // Sin pasos sugeridos: el imán engancha en cualquier ángulo. La vista
  // ofrece la esfera entera de radio L alrededor de la bola seleccionada.
  libre: [],
};

// El panel que eliges decide la forma: sus cuerdas fuerzan la geometría.
// El cuadrado y el rombo son el mismo ciclo de 4 con distinta alma.
export const PANEL_TYPES = {
  triangulo: { sides: 3 },
  cuadrado: { sides: 4 },
  rombo: { sides: 4 },
  pentagono: { sides: 5 },
};

export const rodKey = (a, b) => (+a < +b ? a + '|' + b : b + '|' + a);
export const rodEnds = (rk) => rk.split('|');
const panelKey = (cycle) => [...cycle].sort((x, y) => x - y).join(',');
const usesEdge = (cycle, rk) =>
  cycle.some((v, i) => rodKey(v, cycle[(i + 1) % cycle.length]) === rk);

export const dist = (p, q) =>
  Math.hypot(p[0] - q[0], p[1] - q[1], p[2] - q[2]);

export class Structure {
  constructor() {
    this.balls = new Map(); // id -> [x, y, z]
    this.rods = new Map(); // rodKey -> color
    this.panels = new Map(); // panelKey -> { type, cycle, chords }
    this.nextId = 1;
    this.history = [];
    this.redoStack = [];
    this.addBall([0, 0, 0]);
  }

  addBall(pos) {
    const id = String(this.nextId++);
    this.balls.set(id, [...pos]);
    return id;
  }

  // --- historial: deshacer por instantáneas (el estado es diminuto) ---

  snapshot() {
    this.history.push(JSON.stringify(this.toJSON()));
    if (this.history.length > 300) this.history.shift();
    this.redoStack.length = 0; // una mutación nueva invalida el futuro
  }

  undo() {
    const prev = this.history.pop();
    if (!prev) return false;
    this.redoStack.push(JSON.stringify(this.toJSON()));
    this.restore(JSON.parse(prev));
    return true;
  }

  redo() {
    const next = this.redoStack.pop();
    if (!next) return false;
    this.history.push(JSON.stringify(this.toJSON()));
    this.restore(JSON.parse(next));
    return true;
  }

  // --- mutaciones ---

  grow(fromId, step, color) {
    const from = this.balls.get(fromId);
    this.snapshot();
    const id = this.addBall(from.map((v, i) => v + step[i]));
    this.rods.set(rodKey(fromId, id), color);
    return id;
  }

  link(aId, bId, color) {
    const rk = rodKey(aId, bId);
    if (aId === bId || this.rods.has(rk)) return null;
    this.snapshot();
    this.rods.set(rk, color);
    return bId;
  }

  removeBall(id) {
    if (!this.balls.has(id)) return;
    this.snapshot();
    this.balls.delete(id);
    for (const rk of [...this.rods.keys()])
      if (rodEnds(rk).includes(id)) this.rods.delete(rk);
    for (const [pk, panel] of [...this.panels])
      if (panel.cycle.includes(id)) this.panels.delete(pk);
    if (this.balls.size === 0) this.addBall([0, 0, 0]);
  }

  removeRod(rk) {
    if (!this.rods.has(rk)) return;
    this.snapshot();
    this.rods.delete(rk);
    for (const [pk, panel] of [...this.panels])
      if (usesEdge(panel.cycle, rk)) this.panels.delete(pk);
  }

  removePanel(pk) {
    if (!this.panels.has(pk)) return;
    this.snapshot();
    this.panels.delete(pk);
  }

  // Un panel sobre un ciclo de barras: además de la membrana, cuerdas
  // internas con las diagonales del polígono ideal. Rellenar un ciclo
  // flácido con el panel "equivocado" lo re-esculpe — como en la realidad,
  // donde el panel forzaba la forma al encajarlo.
  addPanel(cycle, type) {
    const pk = panelKey(cycle);
    if (this.panels.has(pk) || cycle.length !== PANEL_TYPES[type].sides)
      return null;
    this.snapshot();
    const chord = (i, j, len) => [cycle[i], cycle[j], len];
    const chords = [];
    if (type === 'cuadrado')
      chords.push(chord(0, 2, L * Math.SQRT2), chord(1, 3, L * Math.SQRT2));
    if (type === 'pentagono')
      for (let i = 0; i < 5; i++) chords.push(chord(i, (i + 2) % 5, L * PHI));
    if (type === 'rombo') {
      const d = (i, j) => dist(this.balls.get(cycle[i]), this.balls.get(cycle[j]));
      const shortIs02 = d(0, 2) < d(1, 3);
      chords.push(
        chord(0, 2, shortIs02 ? L : L * Math.sqrt(3)),
        chord(1, 3, shortIs02 ? L * Math.sqrt(3) : L)
      );
    }
    this.panels.set(pk, { type, cycle: [...cycle], chords });
    return pk;
  }

  reset() {
    this.snapshot();
    this.balls = new Map();
    this.rods = new Map();
    this.panels = new Map();
    this.addBall([0, 0, 0]);
  }

  // --- consultas ---

  // Todo lo que el solver debe mantener: barras a L y cuerdas de panel.
  *constraints() {
    for (const rk of this.rods.keys()) {
      const [a, b] = rodEnds(rk);
      yield [a, b, L];
    }
    for (const panel of this.panels.values()) yield* panel.chords;
  }

  nearestBall(pos, maxD, exclude) {
    let best = null;
    let bd = maxD;
    for (const [id, p] of this.balls) {
      if (id === exclude) continue;
      const d = dist(pos, p);
      if (d < bd) {
        bd = d;
        best = id;
      }
    }
    return best;
  }

  // Colocaciones desde una bola: las 12 sugerencias FCC (bola nueva, o
  // enganche si ya hay una bola ahí) más el alcance del imán: cualquier
  // bola cercana sin barra en medio es enganchable.
  candidates(fromId, steps = STEPS) {
    const from = this.balls.get(fromId);
    const out = new Map();
    for (const step of steps) {
      const target = from.map((v, i) => v + step[i]);
      const near = this.nearestBall(target, 0.45 * L, fromId);
      if (near === null) out.set('@' + step, { kind: 'new', step });
      else if (!this.rods.has(rodKey(fromId, near)))
        out.set(near, { kind: 'link', to: near });
    }
    for (const [id, p] of this.balls) {
      if (id === fromId || out.has(id) || this.rods.has(rodKey(fromId, id)))
        continue;
      const d = dist(from, p);
      if (d > 0.5 * L && d < 1.6 * L) out.set(id, { kind: 'link', to: id });
    }
    return [...out.values()];
  }

  // Ciclos simples de longitud n (los huecos donde cabe un panel).
  // DFS canónico: el id menor abre el ciclo y la orientación se fija
  // comparando el segundo vértice con el último.
  cycles(n) {
    const adj = new Map([...this.balls.keys()].map((id) => [id, new Set()]));
    for (const rk of this.rods.keys()) {
      const [a, b] = rodEnds(rk);
      adj.get(a).add(b);
      adj.get(b).add(a);
    }
    const found = [];
    const path = [];
    const dfs = (start, v) => {
      path.push(v);
      if (path.length === n) {
        if (adj.get(v).has(start) && +path[1] < +path[n - 1])
          found.push([...path]);
      } else {
        for (const w of adj.get(v))
          if (+w > +start && !path.includes(w)) dfs(start, w);
      }
      path.pop();
    };
    for (const id of this.balls.keys()) dfs(id, id);
    return found;
  }

  // Un hueco solo se ofrece si es razonablemente plano: un octaedro tiene
  // 15 ciclos de 4 pero solo 3 cuadrados de verdad; los otros 12 van
  // doblados sobre dos caras y ningún panel real los aceptaría.
  isFlat(cycle) {
    if (cycle.length === 3) return true;
    const pts = cycle.map((id) => this.balls.get(id));
    const c = [0, 1, 2].map((k) => pts.reduce((s, p) => s + p[k], 0) / pts.length);
    const n = [0, 0, 0]; // normal de Newell
    pts.forEach((p, i) => {
      const a = p.map((v, k) => v - c[k]);
      const b = pts[(i + 1) % pts.length].map((v, k) => v - c[k]);
      n[0] += a[1] * b[2] - a[2] * b[1];
      n[1] += a[2] * b[0] - a[0] * b[2];
      n[2] += a[0] * b[1] - a[1] * b[0];
    });
    const m = Math.hypot(...n) || 1e-9;
    return pts.every(
      (p) =>
        Math.abs(
          ((p[0] - c[0]) * n[0] + (p[1] - c[1]) * n[1] + (p[2] - c[2]) * n[2]) / m
        ) < 0.15 * L // los ciclos doblados de un octaedro se desvían 0.25·L
    );
  }

  openCycles(n) {
    return this.cycles(n).filter(
      (c) => !this.panels.has(panelKey(c)) && this.isFlat(c)
    );
  }

  // --- (de)serialización ---

  toJSON() {
    return {
      v: 2,
      nextId: this.nextId,
      balls: [...this.balls].map(([id, p]) => [id, p.map((v) => +v.toFixed(4))]),
      rods: [...this.rods],
      panels: [...this.panels],
    };
  }

  restore(data) {
    if (!data.v) data = migrateV1(data);
    this.nextId = data.nextId;
    this.balls = new Map(data.balls.map(([id, p]) => [id, [...p]]));
    this.rods = new Map(data.rods);
    this.panels = new Map(data.panels ?? []);
  }

  load(data) {
    this.snapshot();
    this.restore(data);
  }
}

// v1 guardaba las bolas como claves de rejilla "x,y,z"; les damos ids
// y sus posiciones enteras pasan a ser el punto de partida del solver.
function migrateV1(old) {
  const ids = new Map(old.balls.map((key, i) => [key, String(i + 1)]));
  return {
    v: 2,
    nextId: old.balls.length + 1,
    balls: old.balls.map((key) => [ids.get(key), key.split(',').map(Number)]),
    rods: old.rods.map(([rk, color]) => {
      const [a, b] = rk.split('|');
      return [rodKey(ids.get(a), ids.get(b)), color];
    }),
    panels: [],
  };
}
