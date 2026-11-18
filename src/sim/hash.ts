/**
 * State hashing for determinism tests and replays: FNV-1a (32-bit) over a canonical walk of plain
 * data. Object keys are visited in sorted order; numbers hash their exact float64 bits, so any
 * drift at all changes the hash.
 */
const FNV_OFFSET = 0x811c9dc5;
const FNV_PRIME = 0x01000193;

export function fnv1a(text: string, h = FNV_OFFSET): number {
  for (let i = 0; i < text.length; i++) {
    h ^= text.charCodeAt(i);
    h = Math.imul(h, FNV_PRIME);
  }
  return h >>> 0;
}

const f64 = new Float64Array(1);
const u8 = new Uint8Array(f64.buffer);

function byte(h: number, b: number): number {
  return Math.imul(h ^ b, FNV_PRIME);
}

function walk(h: number, v: unknown): number {
  switch (typeof v) {
    case 'number':
      f64[0] = v;
      h = byte(h, 1);
      for (let i = 0; i < 8; i++) h = byte(h, u8[i]);
      return h;
    case 'string':
      return fnv1a(v, byte(h, 2));
    case 'boolean':
      return byte(h, v ? 3 : 4);
    case 'undefined':
      return byte(h, 5);
    case 'object': {
      if (v === null) return byte(h, 6);
      if (Array.isArray(v)) {
        h = byte(h, 7);
        for (const item of v) h = walk(h, item);
        return byte(h, 8);
      }
      h = byte(h, 9);
      const obj = v as Record<string, unknown>;
      for (const k of Object.keys(obj).sort()) {
        if (obj[k] === undefined) continue;
        h = fnv1a(k, h);
        h = walk(h, obj[k]);
      }
      return byte(h, 10);
    }
    default:
      throw new Error(`hash: unsupported value of type ${typeof v}`);
  }
}

export function hashValue(v: unknown): number {
  return walk(FNV_OFFSET, v) >>> 0;
}

export const hex = (h: number): string => (h >>> 0).toString(16).padStart(8, '0');
