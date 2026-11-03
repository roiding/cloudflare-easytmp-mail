import { describe, it, expect } from 'vitest';
import { existsSync, readFileSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  generateWorkerTempConfig,
  generateMigrateTempConfig,
  generatePagesTempDir,
} from '../lib/temp-config.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const rootDir = resolve(__dirname, '../..');
const workerTomlPath = resolve(rootDir, 'apps/inbound-worker/wrangler.toml');
const apiTomlPath = resolve(rootDir, 'apps/api/wrangler.toml');

describe('Wrangler Temporary Config Generator', () => {
  it('generates worker temp config without mutating checked-in wrangler.toml', () => {
    const originalContent = readFileSync(workerTomlPath, 'utf8');
    const testDbId = '11111111-2222-4333-8444-555555555555';

    const temp = generateWorkerTempConfig(testDbId);
    try {
      expect(existsSync(temp.configPath)).toBe(true);
      const generated = readFileSync(temp.configPath, 'utf8');

      expect(generated).toContain(`database_id = "${testDbId}"`);
      expect(generated).toContain('main = "');
      expect(generated).toContain('migrations_dir = "');

      // Checked-in file MUST be identical to original
      const currentWorkerToml = readFileSync(workerTomlPath, 'utf8');
      expect(currentWorkerToml).toBe(originalContent);
    } finally {
      temp.cleanup();
      expect(existsSync(temp.configPath)).toBe(false);
    }
  });

  it('generates migrate temp config without mutating checked-in wrangler.toml', () => {
    const originalContent = readFileSync(apiTomlPath, 'utf8');
    const testDbId = 'aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee';

    const temp = generateMigrateTempConfig(testDbId);
    try {
      expect(existsSync(temp.configPath)).toBe(true);
      const generated = readFileSync(temp.configPath, 'utf8');

      expect(generated).toContain(`database_id = "${testDbId}"`);

      // Checked-in file MUST be identical to original
      const currentApiToml = readFileSync(apiTomlPath, 'utf8');
      expect(currentApiToml).toBe(originalContent);
    } finally {
      temp.cleanup();
      expect(existsSync(temp.configPath)).toBe(false);
    }
  });

  it('generates pages temp dir with isolated wrangler.toml', () => {
    const testDbId = '22222222-3333-4444-8555-666666666666';

    const temp = generatePagesTempDir(testDbId);
    try {
      expect(existsSync(temp.tempDir)).toBe(true);
      expect(existsSync(temp.configPath)).toBe(true);

      const generated = readFileSync(temp.configPath, 'utf8');
      expect(generated).toContain(`database_id = "${testDbId}"`);
      expect(generated).toContain('name = "easytmp-mail"');
    } finally {
      temp.cleanup();
      expect(existsSync(temp.tempDir)).toBe(false);
    }
  });
});
