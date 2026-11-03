import { mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { randomBytes } from 'node:crypto';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const rootDir = resolve(__dirname, '../..');
const tmpBaseDir = resolve(rootDir, '.wrangler/tmp');
const workerDir = resolve(rootDir, 'apps/inbound-worker');
const apiDir = resolve(rootDir, 'apps/api');
const migrationsDir = resolve(rootDir, 'packages/db/migrations');

// Track all active temporary paths to ensure cleanup on exit or interruption
const activeTempPaths = new Set();

function registerCleanupHandler() {
  if (globalThis.__tempConfigCleanupRegistered) return;
  globalThis.__tempConfigCleanupRegistered = true;

  const cleanupAll = () => {
    for (const p of activeTempPaths) {
      try {
        rmSync(p, { recursive: true, force: true });
      } catch {
        // ignore errors during emergency exit
      }
    }
    activeTempPaths.clear();
  };

  process.once('exit', cleanupAll);
  process.once('SIGINT', () => {
    cleanupAll();
    process.exit(130);
  });
  process.once('SIGTERM', () => {
    cleanupAll();
    process.exit(143);
  });
}

registerCleanupHandler();

function getRandomSuffix() {
  return `${Date.now()}-${randomBytes(4).toString('hex')}`;
}

export function generateWorkerTempConfig(dbId) {
  mkdirSync(tmpBaseDir, { recursive: true });

  const originalTomlPath = resolve(workerDir, 'wrangler.toml');
  const originalToml = readFileSync(originalTomlPath, 'utf8');

  // Replace database_id and resolve relative paths to absolute
  let updatedToml = originalToml.replace(/database_id\s*=\s*"[^"]+"/, `database_id = "${dbId}"`);
  updatedToml = updatedToml.replace(
    /main\s*=\s*"[^"]+"/,
    `main = "${resolve(workerDir, 'src/index.ts')}"`,
  );
  updatedToml = updatedToml.replace(
    /migrations_dir\s*=\s*"[^"]+"/,
    `migrations_dir = "${migrationsDir}"`,
  );

  const tempConfigPath = resolve(tmpBaseDir, `wrangler.worker.${getRandomSuffix()}.toml`);
  writeFileSync(tempConfigPath, updatedToml, 'utf8');
  activeTempPaths.add(tempConfigPath);

  return {
    configPath: tempConfigPath,
    cleanup() {
      rmSync(tempConfigPath, { force: true });
      activeTempPaths.delete(tempConfigPath);
    },
  };
}

export function generateMigrateTempConfig(dbId) {
  mkdirSync(tmpBaseDir, { recursive: true });

  const originalTomlPath = resolve(apiDir, 'wrangler.toml');
  const originalToml = readFileSync(originalTomlPath, 'utf8');

  let updatedToml = originalToml.replace(/database_id\s*=\s*"[^"]+"/, `database_id = "${dbId}"`);
  updatedToml = updatedToml.replace(
    /migrations_dir\s*=\s*"[^"]+"/,
    `migrations_dir = "${migrationsDir}"`,
  );
  updatedToml = updatedToml.replace(
    /pages_build_output_dir\s*=\s*"[^"]+"/,
    `pages_build_output_dir = "${resolve(apiDir, 'dist')}"`,
  );

  const tempConfigPath = resolve(tmpBaseDir, `wrangler.migrate.${getRandomSuffix()}.toml`);
  writeFileSync(tempConfigPath, updatedToml, 'utf8');
  activeTempPaths.add(tempConfigPath);

  return {
    configPath: tempConfigPath,
    cleanup() {
      rmSync(tempConfigPath, { force: true });
      activeTempPaths.delete(tempConfigPath);
    },
  };
}

export function generatePagesTempDir(dbId) {
  mkdirSync(tmpBaseDir, { recursive: true });

  const tempDirPath = resolve(tmpBaseDir, `pages-deploy-${getRandomSuffix()}`);
  mkdirSync(tempDirPath, { recursive: true });
  activeTempPaths.add(tempDirPath);

  const toml = `
name = "easytmp-mail"
compatibility_date = "2024-11-01"
compatibility_flags = ["nodejs_compat"]
pages_build_output_dir = "${resolve(apiDir, 'dist')}"

[[d1_databases]]
binding = "DB"
database_name = "easytmp-mail"
database_id = "${dbId}"
migrations_dir = "${migrationsDir}"

[vars]
MAIL_DOMAIN = "cottage.dpdns.org"
`;

  const configPath = resolve(tempDirPath, 'wrangler.toml');
  writeFileSync(configPath, toml.trim() + '\n', 'utf8');

  return {
    tempDir: tempDirPath,
    configPath,
    cleanup() {
      rmSync(tempDirPath, { recursive: true, force: true });
      activeTempPaths.delete(tempDirPath);
    },
  };
}
