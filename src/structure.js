// Modelo puro: una estructura Geomag es un grafo embebido en el espacio.
// Las bolas son nodos, las barras son aristas de longitud fija.
// Sin three.js, sin DOM: solo datos.
//
// El truco: trabajamos en la red FCC (cúbica centrada en caras) con
// coordenadas ENTERAS. Una barra mide √2 y cada paso suma un vector de
// enteros, así que las posiciones son exactas, no hay deriva de coma
// flotante, y comparar dos bolas es comparar dos strings. Triángulos,
// cuadrados, tetraedros y octaedros cierran perfectos.

export const ROD_LENGTH = Math.SQRT2;

// Los 12 vecinos más próximos de la red FCC: permutaciones de (±1, ±1, 0).
export const STEPS = (() => {
  const steps = [];
  for (const a of [1, -1])
    for (const b of [1, -1])
      steps.push([a, b, 0], [a, 0, b], [0, a, b]);
  return steps;
})();

export const keyOf = (p) => p.join(',');
export const posOf = (key) => key.split(',').map(Number);
export const rodKey = (a, b) => (a < b ? a + '|' + b : b + '|' + a);
export const rodEnds = (rk) => rk.split('|');

const ORIGIN = keyOf([0, 0, 0]);

export class Structure {
  constructor() {
    this.balls = new Set([ORIGIN]);
    this.rods = new Map(); // rodKey -> color
    this.history = [];
  }

  // --- historial: deshacer por instantáneas (el estado es diminuto) ---

  snapshot() {
    this.history.push(JSON.stringify(this.toJSON()));
    if (this.history.length > 300) this.history.shift();
  }

  undo() {
    const prev = this.history.pop();
    if (prev) this.restore(JSON.parse(prev));
    return Boolean(prev);
  }

  // --- mutaciones ---

  // Añade una barra desde una bola siguiendo un paso FCC.
  // Si en el destino ya hay una bola, solo conecta; si no, la crea.
  grow(fromKey, step, color) {
    const toKey = keyOf(posOf(fromKey).map((v, i) => v + step[i]));
    const rk = rodKey(fromKey, toKey);
    if (this.rods.has(rk)) return null;
    this.snapshot();
    this.balls.add(toKey);
    this.rods.set(rk, color);
    return toKey;
  }

  removeBall(key) {
    if (!this.balls.has(key)) return;
    this.snapshot();
    this.balls.delete(key);
    for (const rk of [...this.rods.keys()])
      if (rodEnds(rk).includes(key)) this.rods.delete(rk);
    if (this.balls.size === 0) this.balls.add(ORIGIN);
  }

  removeRod(rk) {
    if (!this.rods.has(rk)) return;
    this.snapshot();
    this.rods.delete(rk);
  }

  reset() {
    this.snapshot();
    this.balls = new Set([ORIGIN]);
    this.rods = new Map();
  }

  // --- consultas ---

  // Destinos alcanzables desde una bola: uno por dirección FCC,
  // salvo que esa barra ya exista. `links` marca si cerraría un ciclo
  // conectando con una bola que ya está ahí.
  candidates(fromKey) {
    const from = posOf(fromKey);
    return STEPS.flatMap((step) => {
      const toKey = keyOf(from.map((v, i) => v + step[i]));
      if (this.rods.has(rodKey(fromKey, toKey))) return [];
      return [{ step, toKey, links: this.balls.has(toKey) }];
    });
  }

  // --- (de)serialización ---

  toJSON() {
    return { balls: [...this.balls], rods: [...this.rods] };
  }

  restore(data) {
    this.balls = new Set(data.balls);
    this.rods = new Map(data.rods);
  }

  load(data) {
    this.snapshot();
    this.restore(data);
  }
}
