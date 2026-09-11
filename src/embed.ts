// Lightweight deterministic embedding stub for scaffold — scaffold only: keyword boost in tools.ts compensates for hash embed; remove in #3 when real model lands.
// Real model (all-MiniLM-L6-v2 / bge-small) wired in ticket 02.
// Returns 384-dim float array deterministically from text hash.

export function embed(text: string): Float32Array {
  const dim = 384;
  const out = new Float32Array(dim);
  let h = 2166136261;
  for (let i = 0; i < text.length; i++) {
    h ^= text.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  // Fill deterministically
  let seed = h >>> 0;
  for (let i = 0; i < dim; i++) {
    seed = (seed * 1664525 + 1013904223) >>> 0;
    out[i] = (seed / 0xffffffff) * 2 - 1;
  }
  // Normalize
  let norm = 0;
  for (let i = 0; i < dim; i++) norm += out[i] * out[i];
  norm = Math.sqrt(norm) || 1;
  for (let i = 0; i < dim; i++) out[i] /= norm;
  return out;
}

export function cosine(a: Float32Array, b: Float32Array): number {
  let dot = 0;
  for (let i = 0; i < a.length; i++) dot += a[i] * b[i];
  return dot;
}
