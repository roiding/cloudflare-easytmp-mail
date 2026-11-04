import { cpSync, mkdirSync, readFileSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { randomBytes } from 'node:crypto';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { loadConfig } from './config.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const rootDir = resolve(__dirname, '../..');
const tmpBaseDir = resolve(rootDir, '.wrangler/tmp');
const workerDir = resolve(rootDir, 'apps/inbound-worker');
const apiDir = resolve(rootDir, 'apps/api');
const migrationsDir = resolve(rootDir, 'packages/db/migrations');

function currentConfig() {
  return loadConfig();
}

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
  const config = currentConfig();
  const mailDomain = config.mailDomain;
  const workerName = config.workerName;
  const d1Name = config.d1DatabaseName;
  let updatedToml = originalToml
    .replace(/^name\s*=\s*"[^"]+"/m, `name = "${workerName}"`)
    .replace(/database_name\s*=\s*"[^"]+"/, `database_name = "${d1Name}"`)
    .replace(/database_id\s*=\s*"[^"]+"/, `database_id = "${dbId}"`)
    .replace(/MAIL_DOMAIN\s*=\s*"[^"]+"/, `MAIL_DOMAIN = "${mailDomain}"`);
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

  const config = currentConfig();
  const mailDomain = config.mailDomain;
  const d1Name = config.d1DatabaseName;
  let updatedToml = originalToml
    .replace(/database_name\s*=\s*"[^"]+"/, `database_name = "${d1Name}"`)
    .replace(/database_id\s*=\s*"[^"]+"/, `database_id = "${dbId}"`)
    .replace(/MAIL_DOMAIN\s*=\s*"[^"]+"/, `MAIL_DOMAIN = "${mailDomain}"`);
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

  // `wrangler pages deploy` discovers Functions relative to its working
  // directory. Keep the checked-in API Functions available in the isolated
  // deployment project so a production publish includes the API as well as
  // the static site.
  cpSync(resolve(apiDir, 'functions'), resolve(tempDirPath, 'functions'), {
    recursive: true,
  });
  symlinkSync(resolve(apiDir, 'node_modules'), resolve(tempDirPath, 'node_modules'), 'junction');

  const config = currentConfig();
  const mailDomain = config.mailDomain;
  const webHostname = config.webHostname;
  const projectName = config.projectName;
  const d1Name = config.d1DatabaseName;
  const toml = `
name = "${projectName}"
compatibility_date = "2024-11-01"
compatibility_flags = ["nodejs_compat"]
pages_build_output_dir = "${resolve(apiDir, 'dist')}"

[[d1_databases]]
binding = "DB"
database_name = "${d1Name}"
database_id = "${dbId}"
migrations_dir = "${migrationsDir}"

[vars]
MAIL_DOMAIN = "${mailDomain}"
WEB_HOSTNAME = "${webHostname}"
`;

  const configPath = resolve(tempDirPath, 'wrangler.toml');
  writeFileSync(configPath, toml.trim() + '\n', 'utf8');

  return {
    tempDir: tempDirPath,
    configPath,
    functionsDir: resolve(tempDirPath, 'functions'),
    cleanup() {
      rmSync(tempDirPath, { recursive: true, force: true });
      activeTempPaths.delete(tempDirPath);
    },
  };
}
