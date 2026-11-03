import { describe, expect, it } from 'vitest';
import {
  decodeCursor,
  encodeCursor,
  toBase64Url,
  validateCursorMatchesFilter,
} from '../src/cursor/index.js';

describe('Cursor encoding, strict decoding and validation', () => {
  const samplePayload = {
    v: 1 as const,
    name: 'signup',
    since: 1793671200000,
    fromDomain: 'example.com',
    subject: '验证码',
    dmarcPass: true,
    lastReceivedAt: 1793671205000,
    lastId: '8c746a0e-7f90-4b13-a71c-9db724e57c02',
  };

  it('encodes and decodes cursor correctly', () => {
    const encoded = encodeCursor(samplePayload);
    expect(typeof encoded).toBe('string');
    expect(encoded.length).toBeLessThanOrEqual(1024);
    expect(encoded).toMatch(/^[A-Za-z0-9_-]+$/);

    const decoded = decodeCursor(encoded);
    expect(decoded.valid).toBe(true);
    expect(decoded.payload).toEqual(samplePayload);
  });

  it('rejects tampered or invalid cursors', () => {
    expect(decodeCursor('').valid).toBe(false);
    expect(decodeCursor('invalid-base64!@#$').valid).toBe(false);
    expect(decodeCursor('e30').valid).toBe(false); // empty object {}
  });

  it('strictly rejects cursors with unknown / unauthorized keys', () => {
    const malicious = {
      ...samplePayload,
      injectedKey: 'malicious-data',
    };
    const encoded = toBase64Url(JSON.stringify(malicious));
    const decoded = decodeCursor(encoded);
    expect(decoded.valid).toBe(false);
    expect(decoded.error).toContain('Disallowed attribute');
  });

  it('strictly validates optional field types and constraints', () => {
    // 1. since as string
    const badSince = toBase64Url(JSON.stringify({ ...samplePayload, since: '1793671200000' }));
    expect(decodeCursor(badSince).valid).toBe(false);

    // 2. since negative
    const negSince = toBase64Url(JSON.stringify({ ...samplePayload, since: -100 }));
    expect(decodeCursor(negSince).valid).toBe(false);

    // 3. fromDomain uppercase or invalid
    const upperDomain = toBase64Url(
      JSON.stringify({ ...samplePayload, fromDomain: 'EXAMPLE.COM' }),
    );
    expect(decodeCursor(upperDomain).valid).toBe(false);

    // 4. subject as non-string
    const numSubject = toBase64Url(JSON.stringify({ ...samplePayload, subject: 123456 }));
    expect(decodeCursor(numSubject).valid).toBe(false);

    // 5. dmarcPass as string or number instead of boolean
    const strDmarc = toBase64Url(JSON.stringify({ ...samplePayload, dmarcPass: 'true' }));
    expect(decodeCursor(strDmarc).valid).toBe(false);
    const numDmarc = toBase64Url(JSON.stringify({ ...samplePayload, dmarcPass: 1 }));
    expect(decodeCursor(numDmarc).valid).toBe(false);

    // 6. non-object or array
    const arrCursor = toBase64Url(JSON.stringify([samplePayload]));
    expect(decodeCursor(arrCursor).valid).toBe(false);

    // 7. invalid UUID lastId
    const badId = toBase64Url(JSON.stringify({ ...samplePayload, lastId: 'not-a-uuid' }));
    expect(decodeCursor(badId).valid).toBe(false);
  });

  it('validates filter context matching', () => {
    const encoded = encodeCursor(samplePayload);
    const decoded = decodeCursor(encoded).payload!;

    // Exact match
    expect(
      validateCursorMatchesFilter(decoded, {
        name: 'signup',
        since: 1793671200000,
        fromDomain: 'example.com',
        subject: '验证码',
        dmarcPass: true,
      }),
    ).toBe(true);

    // Mismatched name
    expect(
      validateCursorMatchesFilter(decoded, {
        name: 'other',
        since: 1793671200000,
        fromDomain: 'example.com',
        subject: '验证码',
        dmarcPass: true,
      }),
    ).toBe(false);

    // Mismatched since
    expect(
      validateCursorMatchesFilter(decoded, {
        name: 'signup',
        since: 1793671200001,
        fromDomain: 'example.com',
        subject: '验证码',
        dmarcPass: true,
      }),
    ).toBe(false);

    // Mismatched domain
    expect(
      validateCursorMatchesFilter(decoded, {
        name: 'signup',
        since: 1793671200000,
        fromDomain: 'different.com',
        subject: '验证码',
        dmarcPass: true,
      }),
    ).toBe(false);
  });
});
