// cyrb53: a well-mixed 53-bit string hash (public domain), so a hash fits exactly in a double.
export function hash53(text: string): number {
  let h1 = 0xdeadbeef;
  let h2 = 0x41c6ce57;
  for (let i = 0; i < text.length; i++) {
    const c = text.charCodeAt(i);
    h1 = Math.imul(h1 ^ c, 2654435761);
    h2 = Math.imul(h2 ^ c, 1597334677);
  }
  h1 = Math.imul(h1 ^ (h1 >>> 16), 2246822507) ^ Math.imul(h2 ^ (h2 >>> 13), 3266489909);
  h2 = Math.imul(h2 ^ (h2 >>> 16), 2246822507) ^ Math.imul(h1 ^ (h1 >>> 13), 3266489909);
  return 4294967296 * (2097151 & h2) + (h1 >>> 0);
}

// "Have I seen this id before?" in constant space per id: an open-addressing table of 53-bit hashes in a Float64Array,
// about 16-32 bytes per id instead of the ~250 a Set of strings costs. The price is a chance of a false "seen" of
// roughly n^2 / 2^54 (about 3 in 10,000 for 2.4 million ids), acceptable for a warning.
export class IdSet {
  private table: Float64Array;
  private mask: number;
  private size = 0;

  constructor(capacity = 1 << 12) {
    this.table = new Float64Array(capacity); // 0 marks an empty slot, so hashes are stored as hash + 1
    this.mask = capacity - 1;
  }

  get count(): number {
    return this.size;
  }

  /** Adds the id; returns true if an id with the same hash was already present. */
  addAndCheck(id: string): boolean {
    const key = hash53(id) + 1;
    let slot = key % (this.mask + 1) & this.mask;
    for (;;) {
      const found = this.table[slot]!;
      if (found === 0) break;
      if (found === key) return true;
      slot = (slot + 1) & this.mask;
    }
    this.table[slot] = key;
    if (++this.size * 2 > this.mask + 1) this.grow();
    return false;
  }

  private grow(): void {
    const old = this.table;
    this.table = new Float64Array(old.length * 2);
    this.mask = this.table.length - 1;
    for (const key of old) {
      if (key === 0) continue;
      let slot = key % (this.mask + 1) & this.mask;
      while (this.table[slot] !== 0) slot = (slot + 1) & this.mask;
      this.table[slot] = key;
    }
  }
}
