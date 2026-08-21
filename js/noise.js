// noise.js — small, dependency-free seeded value-noise field.
// Not trying to be Perlin-perfect; just smooth, seeded, and cheap so the
// environment fields feel textured instead of uniformly random.

function mulberry32(seed) {
  let a = seed >>> 0;
  return function () {
    a |= 0; a = (a + 0x6D2B79F5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export class NoiseField {
  // width/height in lattice points (not the sim grid resolution — coarser is fine,
  // we interpolate). wrapX makes the field tile seamlessly in longitude, useful
  // for fields that drift and loop.
  constructor({ width = 12, height = 6, seed = 1, wrapX = true }) {
    this.w = width;
    this.h = height;
    this.wrapX = wrapX;
    const rand = mulberry32(seed);
    this.lattice = new Float32Array(width * height);
    for (let i = 0; i < this.lattice.length; i++) this.lattice[i] = rand() * 2 - 1;
  }

  _at(xi, yi) {
    const w = this.w, h = this.h;
    const x = this.wrapX ? ((xi % w) + w) % w : Math.max(0, Math.min(w - 1, xi));
    const y = Math.max(0, Math.min(h - 1, yi));
    return this.lattice[y * w + x];
  }

  // sample at fractional lattice coords (u,v) each in [0, width)/[0, height)
  sample(u, v) {
    const x0 = Math.floor(u), y0 = Math.floor(v);
    const fx = u - x0, fy = v - y0;
    const v00 = this._at(x0, y0), v10 = this._at(x0 + 1, y0);
    const v01 = this._at(x0, y0 + 1), v11 = this._at(x0 + 1, y0 + 1);
    const sx = fx * fx * (3 - 2 * fx); // smoothstep
    const sy = fy * fy * (3 - 2 * fy);
    const top = v00 + (v10 - v00) * sx;
    const bot = v01 + (v11 - v01) * sx;
    return top + (bot - top) * sy; // range ~[-1, 1]
  }
}
