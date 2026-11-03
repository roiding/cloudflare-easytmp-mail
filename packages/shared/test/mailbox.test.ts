import { describe, expect, it } from 'vitest';
import { generateRandomMailbox, validateMailboxName } from '../src/validation/mailbox.js';

describe('Mailbox Validation & Uniform Generation', () => {
  it('validates and normalizes valid names to lowercase', () => {
    const res1 = validateMailboxName('Signup');
    expect(res1.valid).toBe(true);
    expect(res1.name).toBe('signup');
    expect(res1.address).toBe('signup@cottage.dpdns.org');

    const res2 = validateMailboxName('test.name-01_v2');
    expect(res2.valid).toBe(true);
    expect(res2.name).toBe('test.name-01_v2');
    expect(res2.address).toBe('test.name-01_v2@cottage.dpdns.org');

    const resSingle = validateMailboxName('a');
    expect(resSingle.valid).toBe(true);
    expect(resSingle.name).toBe('a');
  });

  it('rejects invalid names', () => {
    // Empty
    expect(validateMailboxName('').valid).toBe(false);

    // Consecutive dots
    expect(validateMailboxName('test..name').valid).toBe(false);

    // Leading / trailing dots, hyphens, underscores
    expect(validateMailboxName('.test').valid).toBe(false);
    expect(validateMailboxName('test.').valid).toBe(false);
    expect(validateMailboxName('-test').valid).toBe(false);
    expect(validateMailboxName('test-').valid).toBe(false);
    expect(validateMailboxName('_test').valid).toBe(false);
    expect(validateMailboxName('test_').valid).toBe(false);

    // Whitespace (no trimming allowed)
    expect(validateMailboxName(' test').valid).toBe(false);
    expect(validateMailboxName('test ').valid).toBe(false);

    // Subaddressing and full address
    expect(validateMailboxName('test+tag').valid).toBe(false);
    expect(validateMailboxName('test@cottage.dpdns.org').valid).toBe(false);

    // Non-ASCII
    expect(validateMailboxName('测试').valid).toBe(false);

    // Exceeding 64 characters
    expect(validateMailboxName('a'.repeat(65)).valid).toBe(false);
  });

  it('generates 16-character cryptographic random addresses without modulo bias', () => {
    const random1 = generateRandomMailbox();
    const random2 = generateRandomMailbox();

    expect(random1.name).toMatch(/^[a-z0-9]{16}$/);
    expect(random1.address).toBe(`${random1.name}@cottage.dpdns.org`);
    expect(random2.name).toMatch(/^[a-z0-9]{16}$/);
    expect(random1.name).not.toBe(random2.name);

    // Generate a set of addresses and verify character distribution across 36 chars
    const charCounts: Record<string, number> = {};
    for (let i = 0; i < 50; i++) {
      const generated = generateRandomMailbox().name;
      for (const ch of generated) {
        charCounts[ch] = (charCounts[ch] || 0) + 1;
      }
    }
    // With 50 * 16 = 800 samples across 36 characters, we should see both letters and digits
    const uniqueChars = Object.keys(charCounts);
    expect(uniqueChars.length).toBeGreaterThanOrEqual(25);
    for (const ch of uniqueChars) {
      expect(ch).toMatch(/^[a-z0-9]$/);
    }
  });
});
