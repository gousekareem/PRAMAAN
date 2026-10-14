/**
 * Canonical JSON serialization (PRAMAAN-CJSON-1).
 *
 * This is a strict subset of RFC 8785 (JSON Canonicalization Scheme):
 *  - Object keys are sorted by UTF-16 code units (JavaScript default sort order, as in RFC 8785).
 *  - No insignificant whitespace.
 *  - Strings are serialized with JSON.stringify (ECMAScript escaping rules, as in RFC 8785).
 *  - Numbers are serialized with the ECMAScript Number-to-String algorithm (as in RFC 8785).
 *    NaN, Infinity and -Infinity are rejected. -0 is serialized as 0.
 *  - `undefined`, functions, symbols, bigint and class instances (other than plain objects
 *    and arrays) are rejected rather than silently dropped. This prevents two different
 *    in-memory values from producing the same canonical bytes.
 *
 * Every component that hashes data (Android app, API server, independent verifier)
 * MUST use this function. Changing it is a breaking change to every stored hash.
 */

export class CanonicalizationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'CanonicalizationError';
  }
}

export type JsonPrimitive = string | number | boolean | null;
export type JsonValue = JsonPrimitive | JsonValue[] | { [key: string]: JsonValue };

function isPlainObject(value: unknown): value is Record<string, unknown> {
  if (value === null || typeof value !== 'object') return false;
  const proto = Object.getPrototypeOf(value);
  return proto === Object.prototype || proto === null;
}

function serialize(value: unknown, path: string, depth: number): string {
  if (depth > 32) throw new CanonicalizationError(`Maximum nesting depth exceeded at ${path}`);
  if (value === null) return 'null';
  switch (typeof value) {
    case 'boolean':
      return value ? 'true' : 'false';
    case 'string':
      return JSON.stringify(value);
    case 'number': {
      if (!Number.isFinite(value)) {
        throw new CanonicalizationError(`Non-finite number at ${path}`);
      }
      // JSON.stringify implements the ECMAScript Number::toString algorithm required by RFC 8785.
      return JSON.stringify(Object.is(value, -0) ? 0 : value);
    }
    case 'object': {
      if (Array.isArray(value)) {
        return `[${value.map((v, i) => serialize(v, `${path}[${i}]`, depth + 1)).join(',')}]`;
      }
      if (!isPlainObject(value)) {
        throw new CanonicalizationError(`Unsupported object type at ${path}`);
      }
      const keys = Object.keys(value).sort();
      const parts: string[] = [];
      for (const key of keys) {
        const v = value[key];
        if (v === undefined) {
          throw new CanonicalizationError(`Undefined value at ${path}.${key}`);
        }
        parts.push(`${JSON.stringify(key)}:${serialize(v, `${path}.${key}`, depth + 1)}`);
      }
      return `{${parts.join(',')}}`;
    }
    default:
      throw new CanonicalizationError(`Unsupported value type '${typeof value}' at ${path}`);
  }
}

/** Returns the canonical JSON string for a JSON-compatible value. */
export function canonicalize(value: unknown): string {
  return serialize(value, '$', 0);
}

/** UTF-8 encode a string without relying on platform TextEncoder availability. */
export function utf8Encode(input: string): Uint8Array {
  const TE = (globalThis as { TextEncoder?: new () => { encode(s: string): Uint8Array } })
    .TextEncoder;
  if (TE) return new TE().encode(input);
  const out: number[] = [];
  for (let i = 0; i < input.length; i++) {
    let code = input.charCodeAt(i);
    if (code >= 0xd800 && code <= 0xdbff && i + 1 < input.length) {
      const next = input.charCodeAt(i + 1);
      if (next >= 0xdc00 && next <= 0xdfff) {
        code = 0x10000 + ((code - 0xd800) << 10) + (next - 0xdc00);
        i++;
      }
    }
    if (code < 0x80) out.push(code);
    else if (code < 0x800) out.push(0xc0 | (code >> 6), 0x80 | (code & 0x3f));
    else if (code < 0x10000)
      out.push(0xe0 | (code >> 12), 0x80 | ((code >> 6) & 0x3f), 0x80 | (code & 0x3f));
    else
      out.push(
        0xf0 | (code >> 18),
        0x80 | ((code >> 12) & 0x3f),
        0x80 | ((code >> 6) & 0x3f),
        0x80 | (code & 0x3f),
      );
  }
  return Uint8Array.from(out);
}
