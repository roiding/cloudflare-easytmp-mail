import { describe, it, expect } from 'vitest';
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { tmpdir } from 'node:os';
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
      expect(existsSync(resolve(temp.functionsDir, 'api/[[route]].ts'))).toBe(true);
      expect(existsSync(resolve(temp.tempDir, 'node_modules/hono/package.json'))).toBe(true);
      expect(existsSync(resolve(temp.tempDir, 'node_modules/@easytmp/shared/package.json'))).toBe(
        true,
      );

      const generated = readFileSync(temp.configPath, 'utf8');
      expect(generated).toContain(`database_id = "${testDbId}"`);
      expect(generated).toContain('name = "easytmp-mail"');
    } finally {
      temp.cleanup();
      expect(existsSync(temp.tempDir)).toBe(false);
    }
  });

  it('derives all Wrangler names and domains from a non-production config', () => {
    const configDir = mkdtempSync(resolve(tmpdir(), 'easytmp-config-'));
    const configPath = resolve(configDir, 'config.json');
    writeFileSync(configPath, JSON.stringify({ mailDomain: 'mail.example.com' }));
    const previousConfig = process.env.EASYTMP_CONFIG;
    process.env.EASYTMP_CONFIG = configPath;

    try {
      const worker = generateWorkerTempConfig('22222222-3333-4444-8555-666666666666');
      const pages = generatePagesTempDir('22222222-3333-4444-8555-666666666666');
      try {
        const workerToml = readFileSync(worker.configPath, 'utf8');
        const pagesToml = readFileSync(pages.configPath, 'utf8');

        expect(workerToml).toContain('name = "easytmp-mail-example-worker"');
        expect(workerToml).toContain('database_name = "easytmp-mail-example"');
        expect(workerToml).toContain('MAIL_DOMAIN = "mail.example.com"');
        expect(pagesToml).toContain('name = "easytmp-mail-example"');
        expect(pagesToml).toContain('database_name = "easytmp-mail-example"');
        expect(pagesToml).toContain('MAIL_DOMAIN = "mail.example.com"');
        expect(pagesToml).toContain('WEB_HOSTNAME = "inbox.mail.example.com"');
      } finally {
        worker.cleanup();
        pages.cleanup();
      }
    } finally {
      if (previousConfig === undefined) delete process.env.EASYTMP_CONFIG;
      else process.env.EASYTMP_CONFIG = previousConfig;
      rmSync(configDir, { recursive: true, force: true });
    }
  });
});
