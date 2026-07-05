// El "motor magnético": relajación por restricciones de distancia
// (position-based dynamics). Cada barra y cada cuerda de panel empuja sus
// dos bolas hacia su longitud ideal; iterar unas decenas de veces converge.
// Es todo lo que necesita un imán.

import { dist } from './structure.js';

export function satisfy(structure) {
  for (const [aId, bId, rest] of structure.constraints()) {
    const a = structure.balls.get(aId);
    const b = structure.balls.get(bId);
    const dx = b[0] - a[0];
    const dy = b[1] - a[1];
    const dz = b[2] - a[2];
    const d = Math.hypot(dx, dy, dz) || 1e-9;
    const f = (0.5 * (d - rest)) / d;
    a[0] += dx * f; a[1] += dy * f; a[2] += dz * f;
    b[0] -= dx * f; b[1] -= dy * f; b[2] -= dz * f;
  }
}

export function relax(structure, iterations = 100) {
  for (let i = 0; i < iterations; i++) satisfy(structure);
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

  step(structure, dt = 1 / 60) {
    const g = 14;
    for (const [id, p] of structure.balls) {
      const q = this.prev.get(id) ?? [...p];
      this.prev.set(id, [...p]);
      p[0] += (p[0] - q[0]) * 0.985;
      p[1] += (p[1] - q[1]) * 0.985 - g * dt * dt;
      p[2] += (p[2] - q[2]) * 0.985;
    }
    for (let i = 0; i < 20; i++) {
      satisfy(structure);
      this.floor(structure);
    }
  }

  floor(structure) {
    for (const [id, p] of structure.balls)
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
