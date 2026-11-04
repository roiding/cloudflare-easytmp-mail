import { execFileSync } from 'node:child_process';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { DEFAULT_D1_NAME, validateDatabaseId, parseCliFlags } from './lib/env.js';
import { generateMigrateTempConfig } from './lib/temp-config.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const rootDir = resolve(__dirname, '..');
const apiDir = resolve(rootDir, 'apps/api');

export function migrateRemote({
  apply = false,
  dbId = process.env.CLOUDFLARE_D1_DATABASE_ID,
  executor = execFileSync,
  databaseName = DEFAULT_D1_NAME,
} = {}) {
  const validDbId = validateDatabaseId(dbId, 'Remote D1 Migration');
  const tempConfig = generateMigrateTempConfig(validDbId);

  try {
    if (!apply) {
      console.log(
        `[db:migrate:remote] [DRY-RUN] Listing pending remote D1 migrations (DB ID: ${validDbId})...`,
      );
      executor(
        'npx',
        [
          'wrangler',
          'd1',
          'migrations',
          'list',
          databaseName,
          '--remote',
          '-c',
          tempConfig.configPath,
        ],
        { cwd: apiDir, stdio: 'inherit' },
      );
      console.log(
        '[db:migrate:remote] [DRY-RUN] Remote migration status inspected. Pass --apply to apply.',
      );
    } else {
      console.log(
        `[db:migrate:remote] [APPLY] Applying remote D1 migrations (DB ID: ${validDbId})...`,
      );
      executor(
        'npx',
        [
          'wrangler',
          'd1',
          'migrations',
          'apply',
          databaseName,
          '--remote',
          '-c',
          tempConfig.configPath,
        ],
        { cwd: apiDir, stdio: 'inherit' },
      );
      console.log('[db:migrate:remote] [APPLY] Remote D1 migrations successfully applied.');
    }
  } finally {
    tempConfig.cleanup();
  }
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const flags = parseCliFlags();
  migrateRemote({ apply: flags.apply });
}
