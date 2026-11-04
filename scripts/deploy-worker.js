import { execFileSync } from 'node:child_process';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { DEFAULT_WORKER_NAME, validateDatabaseId, parseCliFlags } from './lib/env.js';
import { generateWorkerTempConfig } from './lib/temp-config.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const rootDir = resolve(__dirname, '..');
const workerDir = resolve(rootDir, 'apps/inbound-worker');

export function deployWorker({
  apply = false,
  dbId = process.env.CLOUDFLARE_D1_DATABASE_ID,
  executor = execFileSync,
  projectName = DEFAULT_WORKER_NAME,
} = {}) {
  const validDbId = validateDatabaseId(dbId, 'Inbound Worker deployment');
  const tempConfig = generateWorkerTempConfig(validDbId);

  try {
    if (!apply) {
      console.log(
        `[deploy:worker] [DRY-RUN] Simulating ${projectName} deployment (DB ID: ${validDbId})...`,
      );
      executor('npx', ['wrangler', 'deploy', '--dry-run', '-c', tempConfig.configPath], {
        cwd: workerDir,
        stdio: 'inherit',
      });
      console.log(
        '[deploy:worker] [DRY-RUN] Worker packaging and bindings verified. Pass --apply to publish.',
      );
    } else {
      console.log(
        `[deploy:worker] [APPLY] Deploying Worker ${projectName} to Cloudflare (DB ID: ${validDbId})...`,
      );
      executor('npx', ['wrangler', 'deploy', '-c', tempConfig.configPath], {
        cwd: workerDir,
        stdio: 'inherit',
      });
      console.log('[deploy:worker] [APPLY] Inbound Worker successfully deployed.');
    }
  } finally {
    tempConfig.cleanup();
  }
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const flags = parseCliFlags();
  deployWorker({ apply: flags.apply });
}
