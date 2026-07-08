// El "motor magnético": relajación por restricciones de distancia
// (position-based dynamics). Cada barra y cada cuerda de panel empuja sus
// dos bolas hacia su longitud ideal; iterar unas decenas de veces converge.
// Es todo lo que necesita un imán.

import { dist } from './structure.js';

// `pinned` es un Set opcional de ids que no se mueven: si una bola está
// fijada, la otra absorbe toda la corrección (como si arrastraras un imán
// con la mano — el resto de la estructura cede, ese punto no).
export function satisfy(structure, pinned) {
  for (const [aId, bId, rest] of structure.constraints()) {
    const aPinned = pinned?.has(aId);
    const bPinned = pinned?.has(bId);
    if (aPinned && bPinned) continue; // las dos clavadas: nada que relajar
    const a = structure.balls.get(aId);
    const b = structure.balls.get(bId);
    const dx = b[0] - a[0];
    const dy = b[1] - a[1];
    const dz = b[2] - a[2];
    const d = Math.hypot(dx, dy, dz) || 1e-9;
    const corr = (d - rest) / d;
    const fa = aPinned ? 0 : bPinned ? 1 : 0.5;
    const fb = bPinned ? 0 : aPinned ? 1 : 0.5;
    a[0] += dx * corr * fa; a[1] += dy * corr * fa; a[2] += dz * corr * fa;
    b[0] -= dx * corr * fb; b[1] -= dy * corr * fb; b[2] -= dz * corr * fb;
  }
}

export function relax(structure, iterations = 100, pinned) {
  for (let i = 0; i < iterations; i++) satisfy(structure, pinned);
}

// Peor violación relativa: si tras relajar sigue alta, la pieza no encaja.
export function residual(structure) {
  let worst = 0;
  for (const [aId, bId, rest] of structure.constraints()) {
    const d = dist(structure.balls.get(aId), structure.balls.get(bId));
    worst = Math.max(worst, Math.abs(d - rest) / rest);
  }
  return worst;
}

// Modo gravedad: integración de Verlet + suelo con fricción.
// La velocidad vive implícita en (posición − posición anterior).
export class Gravity {
  constructor() {
    this.prev = new Map();
  }

  forget() {
    this.prev.clear();
  }

  // Con `pinned`, la bola fijada no se integra — ni gravedad ni inercia —
  // y su `prev` se sincroniza a su posición actual, así que al soltarla
  // no sale disparada por una velocidad implícita que nunca quiso tener
  // (mientras la arrastras con el ratón, por ejemplo).
  step(structure, dt = 1 / 60, pinned) {
    const g = 14;
    for (const [id, p] of structure.balls) {
      if (pinned?.has(id)) {
        this.prev.set(id, [...p]);
        continue;
      }
      const q = this.prev.get(id) ?? [...p];
      this.prev.set(id, [...p]);
      p[0] += (p[0] - q[0]) * 0.985;
      p[1] += (p[1] - q[1]) * 0.985 - g * dt * dt;
      p[2] += (p[2] - q[2]) * 0.985;
    }
    for (let i = 0; i < 20; i++) {
      satisfy(structure, pinned);
      this.floor(structure, pinned);
    }
  }

  floor(structure, pinned) {
    for (const [id, p] of structure.balls) {
      if (pinned?.has(id)) continue; // clavada por la mano: el suelo no la toca
      if (p[1] < 0) {
        p[1] = 0;
        const q = this.prev.get(id);
        if (q) {
          // el rebote muere y el deslizamiento se frena (fricción)
          q[1] = p[1];
          q[0] = p[0] + (q[0] - p[0]) * 0.4;
          q[2] = p[2] + (q[2] - p[2]) * 0.4;
        }
      }
    }
  }
}
