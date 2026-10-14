import { describe, expect, it } from 'vitest';
import { canonicalize, CanonicalizationError, sha256Hex, utf8Encode } from '../index';

describe('canonicalize (PRAMAAN-CJSON-1)', () => {
  it('sorts keys recursively and removes whitespace', () => {
    expect(canonicalize({ b: 1, a: { d: [3, { z: 1, y: 2 }], c: 'x' } })).toBe(
      '{"a":{"c":"x","d":[3,{"y":2,"z":1}]},"b":1}',
    );
  });
  it('is independent of key insertion order', () => {
    const a = { lat: 16.30081, lon: 80.4428, acc: 8 };
    const b = { acc: 8, lon: 80.4428, lat: 16.30081 };
    expect(canonicalize(a)).toBe(canonicalize(b));
  });
  it('uses ECMAScript number serialization (RFC 8785 test values)', () => {
    // eslint-disable-next-line no-loss-of-precision -- RFC 8785 test vector deliberately exceeds double precision
    expect(canonicalize([1e21, 1e-7, 0.1, -0, 4.5, 333333333.33333329])).toBe(
      '[1e+21,1e-7,0.1,0,4.5,333333333.3333333]',
    );
  });
  it('escapes strings deterministically', () => {
    expect(canonicalize({ s: 'line\n"q" €' })).toBe('{"s":"line\\n\\"q\\" €"}');
  });
  it('rejects ambiguous values instead of silently dropping them', () => {
    expect(() => canonicalize({ a: undefined })).toThrow(CanonicalizationError);
    expect(() => canonicalize({ a: NaN })).toThrow(CanonicalizationError);
    expect(() => canonicalize({ a: Infinity })).toThrow(CanonicalizationError);
    expect(() => canonicalize({ a: new Date() })).toThrow(CanonicalizationError);
    expect(() => canonicalize({ a: () => 1 })).toThrow(CanonicalizationError);
  });
  it('fallback UTF-8 encoder matches TextEncoder', () => {
    const s = 'PRAMAAN ప్రమాణం 😀';
    expect(Array.from(utf8Encode(s))).toEqual(Array.from(new TextEncoder().encode(s)));
  });
  it('sha256Hex matches the NIST "abc" vector', () => {
    expect(sha256Hex('abc')).toBe(
      'ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad',
    );
  });
});
