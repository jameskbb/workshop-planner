/**
 * Stable UUID generation. Tests can install a deterministic generator with `setIdGenerator`.
 */
let generator: () => string = () => globalThis.crypto.randomUUID();

export function newId(): string {
  return generator();
}

/** Replace the id generator (tests). Returns a function that restores the previous one. */
export function setIdGenerator(fn: () => string): () => void {
  const prev = generator;
  generator = fn;
  return () => {
    generator = prev;
  };
}

/** Deterministic sequential generator for tests: "id-1", "id-2", … */
export function sequentialIds(prefix = 'id'): () => string {
  let n = 0;
  return () => `${prefix}-${++n}`;
}
