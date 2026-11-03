import { describe, it, expect } from 'vitest';
import { existsSync, readFileSync, rmSync } from 'node:fs';
import { sanitizeForBackup, saveSanitizedBackup } from '../lib/backup.js';

describe('Sanitized Backup Utility', () => {
  it('recursively redacts sensitive credential keys', () => {
    const raw = {
      user: 'alice',
      CLOUDFLARE_API_TOKEN: 'secret-token-123',
      nested: {
        authorization: 'Bearer secret-bearer',
        secret_key: 'top-secret',
        password: 'admin-password',
        auth_key: 'global-key',
        safeData: {
          zoneName: 'cottage.dpdns.org',
          priority: 10,
        },
      },
      list: [{ apiKey: 'list-key', status: 'ok' }, { plain: 'normal' }],
    };

    const sanitized = sanitizeForBackup(raw);

    expect(sanitized.CLOUDFLARE_API_TOKEN).toBe('[REDACTED]');
    expect(sanitized.nested.authorization).toBe('[REDACTED]');
    expect(sanitized.nested.secret_key).toBe('[REDACTED]');
    expect(sanitized.nested.password).toBe('[REDACTED]');
    expect(sanitized.nested.auth_key).toBe('[REDACTED]');
    expect(sanitized.list[0].apiKey).toBe('[REDACTED]');
    expect(sanitized.nested.safeData.zoneName).toBe('cottage.dpdns.org');
    expect(sanitized.nested.safeData.priority).toBe(10);
    expect(sanitized.list[1].plain).toBe('normal');

    // Original object must not be mutated
    expect(raw.CLOUDFLARE_API_TOKEN).toBe('secret-token-123');
  });

  it('saves sanitized JSON backup to .wrangler/backups and returns path', () => {
    const backup = saveSanitizedBackup(
      'test-backup',
      {
        token: 'must-be-hidden',
        zone: 'cottage.dpdns.org',
      },
      { stage: 'unit-test' },
    );

    expect(existsSync(backup.filepath)).toBe(true);
    const content = JSON.parse(readFileSync(backup.filepath, 'utf8'));

    expect(content.version).toBe('1.0.0');
    expect(content.prefix).toBe('test-backup');
    expect(content.metadata.stage).toBe('unit-test');
    expect(content.data.token).toBe('[REDACTED]');
    expect(content.data.zone).toBe('cottage.dpdns.org');

    // Clean up test backup file
    rmSync(backup.filepath, { force: true });
  });
});
