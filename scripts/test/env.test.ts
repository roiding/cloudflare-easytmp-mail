import { describe, it, expect } from 'vitest';
import {
  validateDatabaseId,
  validateApiToken,
  validateZoneId,
  validateAccountId,
  validateMailDomain,
  parseCliFlags,
  EXPECTED_MAIL_DOMAIN,
  FORBIDDEN_DOMAIN,
} from '../lib/env.js';

describe('Environment and Security Validation', () => {
  describe('validateDatabaseId', () => {
    it('accepts valid UUID v4', () => {
      const valid = '12345678-abcd-4ef0-9123-123456789abc';
      expect(validateDatabaseId(valid)).toBe(valid);
    });

    it('rejects missing or empty ID', () => {
      expect(() => validateDatabaseId('')).toThrowError(/valid Cloudflare D1 Database ID/);
      expect(() => validateDatabaseId(undefined)).toThrowError(/valid Cloudflare D1 Database ID/);
    });

    it('rejects placeholder or local ID', () => {
      expect(() => validateDatabaseId('placeholder-d1-id')).toThrowError(
        /valid Cloudflare D1 Database ID/,
      );
      expect(() => validateDatabaseId('easytmp-mail-local-id')).toThrowError(
        /valid Cloudflare D1 Database ID/,
      );
      expect(() => validateDatabaseId('not-a-uuid')).toThrowError(
        /valid Cloudflare D1 Database ID/,
      );
    });
  });

  describe('validateApiToken', () => {
    it('accepts valid token string', () => {
      expect(validateApiToken('valid-cloudflare-api-token-123456789')).toBe(
        'valid-cloudflare-api-token-123456789',
      );
    });

    it('rejects short or placeholder token', () => {
      expect(() => validateApiToken('')).toThrowError(/valid CLOUDFLARE_API_TOKEN/);
      expect(() => validateApiToken('short')).toThrowError(/valid CLOUDFLARE_API_TOKEN/);
      expect(() => validateApiToken('token_placeholder')).toThrowError(
        /valid CLOUDFLARE_API_TOKEN/,
      );
    });
  });

  describe('validateZoneId & validateAccountId', () => {
    it('accepts 32-char hex string', () => {
      const validHex = '0123456789abcdef0123456789abcdef';
      expect(validateZoneId(validHex)).toBe(validHex);
      expect(validateAccountId(validHex)).toBe(validHex);
    });

    it('rejects non-32-hex strings', () => {
      expect(() => validateZoneId('short')).toThrowError(/32-character hex/);
      expect(() => validateZoneId('invalid-chars-zzzzzzzzzzzzzzzzzzzzzz')).toThrowError(
        /32-character hex/,
      );
      expect(() => validateAccountId('not-hex')).toThrowError(/32-character hex/);
    });
  });

  describe('validateMailDomain', () => {
    it('accepts cottage.dpdns.org', () => {
      expect(validateMailDomain(EXPECTED_MAIL_DOMAIN)).toBe(EXPECTED_MAIL_DOMAIN);
      expect(validateMailDomain('COTTAGE.DPDNS.ORG')).toBe(EXPECTED_MAIL_DOMAIN);
    });

    it('strictly refuses roiding.dpdns.org with security error', () => {
      expect(() => validateMailDomain(FORBIDDEN_DOMAIN)).toThrowError(
        /\[SECURITY_REFUSAL\].*strictly forbids operations targeting "roiding\.dpdns\.org"/,
      );
      expect(() => validateMailDomain('sub.roiding.dpdns.org')).toThrowError(
        /\[SECURITY_REFUSAL\]/,
      );
    });

    it('rejects any unexpected domain', () => {
      expect(() => validateMailDomain('example.com')).toThrowError(/unexpected MAIL_DOMAIN/);
    });
  });

  describe('parseCliFlags', () => {
    it('defaults to dryRun: true, apply: false, stage: preflight', () => {
      const flags = parseCliFlags([]);
      expect(flags.dryRun).toBe(true);
      expect(flags.apply).toBe(false);
      expect(flags.stage).toBe('preflight');
    });

    it('parses --apply correctly', () => {
      const flags = parseCliFlags(['--apply']);
      expect(flags.apply).toBe(true);
      expect(flags.dryRun).toBe(false);
    });

    it('parses --stage, --old-worker, and --url', () => {
      const flags = parseCliFlags([
        '--stage',
        'cleanup',
        '--old-worker',
        'legacy-worker',
        '--url',
        'http://localhost:8788',
      ]);
      expect(flags.stage).toBe('cleanup');
      expect(flags.oldWorker).toBe('legacy-worker');
      expect(flags.url).toBe('http://localhost:8788');
    });

    it('parses inline equals flags', () => {
      const flags = parseCliFlags([
        '--stage=switch',
        '--old-worker=old-worker-1',
        '--url=https://custom.domain',
      ]);
      expect(flags.stage).toBe('switch');
      expect(flags.oldWorker).toBe('old-worker-1');
      expect(flags.url).toBe('https://custom.domain');
    });
  });
});
