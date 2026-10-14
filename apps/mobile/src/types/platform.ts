/** Platform abstractions so that business logic is testable without Android hardware. */
export interface ClockSampleNow {
  wallTime: string;
  monotonicMs: number;
  bootId: string;
}

export interface DeviceClock {
  now(): Promise<ClockSampleNow>;
}

export interface DeviceSigner {
  /** Signs the UTF-8 message with the device key (ECDSA P-256 / SHA-256). Returns base64 DER. */
  sign(message: string): Promise<string>;
}

export interface RandomSource {
  bytes(n: number): Uint8Array;
}

export function uuidV4(rnd: RandomSource): string {
  const b = rnd.bytes(16);
  b[6] = (b[6]! & 0x0f) | 0x40;
  b[8] = (b[8]! & 0x3f) | 0x80;
  const h = Array.from(b, (x) => x.toString(16).padStart(2, '0')).join('');
  return `${h.slice(0, 8)}-${h.slice(8, 12)}-${h.slice(12, 16)}-${h.slice(16, 20)}-${h.slice(20)}`;
}

/** Unbiased integer in [min, max] using rejection sampling over 32-bit secure random values. */
export function secureRandomInt(rnd: RandomSource, min: number, max: number): number {
  if (!Number.isInteger(min) || !Number.isInteger(max) || max < min)
    throw new Error('invalid range');
  const range = max - min + 1;
  if (range > 2 ** 32) throw new Error('range too large');
  const limit = Math.floor(2 ** 32 / range) * range;
  for (;;) {
    const b = rnd.bytes(4);
    const v = ((b[0]! << 24) >>> 0) + (b[1]! << 16) + (b[2]! << 8) + b[3]!;
    if (v < limit) return min + (v % range);
  }
}

export class Mutex {
  private tail: Promise<void> = Promise.resolve();
  async run<T>(fn: () => Promise<T>): Promise<T> {
    let release!: () => void;
    const prev = this.tail;
    this.tail = new Promise((r) => (release = r));
    await prev;
    try {
      return await fn();
    } finally {
      release();
    }
  }
}
