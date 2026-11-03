// @vitest-environment jsdom
import './setup';
import { describe, it, expect } from 'vitest';
import { normalizeMailboxInput } from '../src/utils/mailbox';
import { MAIL_DOMAIN } from '@easytmp/shared';

describe('Mailbox input normalization and validation', () => {
  it('accepts valid simple alphanumeric name and normalizes to lowercase', () => {
    const res = normalizeMailboxInput('Alice123');
    expect(res.valid).toBe(true);
    expect(res.name).toBe('alice123');
    expect(res.address).toBe(`alice123@${MAIL_DOMAIN}`);
  });

  it('accepts names with dots, hyphens, and underscores', () => {
    const res = normalizeMailboxInput('my-test.user_99');
    expect(res.valid).toBe(true);
    expect(res.name).toBe('my-test.user_99');
    expect(res.address).toBe(`my-test.user_99@${MAIL_DOMAIN}`);
  });

  it('accepts full email address ending with the configured domain', () => {
    const res = normalizeMailboxInput(`Bob-Admin@${MAIL_DOMAIN}`);
    expect(res.valid).toBe(true);
    expect(res.name).toBe('bob-admin');
    expect(res.address).toBe(`bob-admin@${MAIL_DOMAIN}`);
  });

  it('rejects empty input or pure whitespace', () => {
    expect(normalizeMailboxInput('').valid).toBe(false);
    expect(normalizeMailboxInput('   ').valid).toBe(false);
    expect(normalizeMailboxInput(null).valid).toBe(false);
  });

  it('rejects foreign domain email addresses', () => {
    const res = normalizeMailboxInput('user@gmail.com');
    expect(res.valid).toBe(false);
    expect(res.error).toContain(MAIL_DOMAIN);
  });

  it('rejects invalid email address syntax', () => {
    expect(normalizeMailboxInput('user@domain@extra').valid).toBe(false);
    expect(normalizeMailboxInput('@cottage.dpdns.org').valid).toBe(false);
    expect(normalizeMailboxInput('user@').valid).toBe(false);
  });

  it('rejects names starting or ending with non-alphanumeric characters', () => {
    expect(normalizeMailboxInput('.user').valid).toBe(false);
    expect(normalizeMailboxInput('user.').valid).toBe(false);
    expect(normalizeMailboxInput('-user').valid).toBe(false);
    expect(normalizeMailboxInput('user_').valid).toBe(false);
  });

  it('rejects consecutive dots in mailbox name', () => {
    const res = normalizeMailboxInput('user..name');
    expect(res.valid).toBe(false);
  });

  it('rejects unsupported characters such as plus signs or spaces inside name', () => {
    expect(normalizeMailboxInput('user+tag').valid).toBe(false);
    expect(normalizeMailboxInput('user name').valid).toBe(false);
    expect(normalizeMailboxInput('user!').valid).toBe(false);
  });

  it('rejects names exceeding 64 characters', () => {
    const longName = 'a'.repeat(65);
    const res = normalizeMailboxInput(longName);
    expect(res.valid).toBe(false);
  });
});
