// A uniform grid over the static objects of a city: what is near a point, without looking at all of them.
// Movers (people, driving cars) are not in it: they are few, and they move.

export class Grid {
  constructor(city, cell = 6) {
    this.cell = cell;
    this.half = city.half;
    this.size = Math.ceil((city.half * 2 + 8) / cell);
    this.origin = -city.half - 4;
    const counts = new Int32Array(this.size * this.size + 1);
    const cellOf = new Int32Array(city.n).fill(-1);
    for (let id = 0; id < city.n; id++) {
      if (city.isMover[id]) continue;
      const c = this.cellIndex(city.bx[id], city.bz[id]);
      cellOf[id] = c;
      counts[c + 1]++;
    }
    for (let i = 0; i < this.size * this.size; i++) counts[i + 1] += counts[i];
    this.start = counts;
    this.ids = new Int32Array(counts[this.size * this.size]);
    const fill = counts.slice(0, this.size * this.size);
    for (let id = 0; id < city.n; id++) if (cellOf[id] >= 0) this.ids[fill[cellOf[id]]++] = id;
    this.city = city;
  }

  axis(v) {
    const c = Math.floor((v - this.origin) / this.cell);
    return c < 0 ? 0 : c >= this.size ? this.size - 1 : c;
  }

  cellIndex(x, z) {
    return this.axis(z) * this.size + this.axis(x);
  }

  /** Calls fn(id) for every static object whose cell touches the square around (x, z). Callers test the exact distance. */
  query(x, z, radius, fn) {
    const x0 = this.axis(x - radius);
    const x1 = this.axis(x + radius);
    const z0 = this.axis(z - radius);
    const z1 = this.axis(z + radius);
    for (let cz = z0; cz <= z1; cz++) {
      const row = cz * this.size;
      for (let cx = x0; cx <= x1; cx++) {
        const end = this.start[row + cx + 1];
        for (let i = this.start[row + cx]; i < end; i++) fn(this.ids[i]);
      }
    }
  }
}
