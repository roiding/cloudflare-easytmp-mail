import { execSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { validateDatabaseId, parseCliFlags } from './lib/env.js';
import { generatePagesTempDir } from './lib/temp-config.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const rootDir = resolve(__dirname, '..');
const apiDir = resolve(rootDir, 'apps/api');
const distDir = resolve(apiDir, 'dist');

export function deployPages({
  apply = false,
  dbId = process.env.CLOUDFLARE_D1_DATABASE_ID,
  executor = execSync,
} = {}) {
  const validDbId = validateDatabaseId(dbId, 'Pages production deployment');

  if (!existsSync(distDir) || !existsSync(resolve(distDir, 'index.html'))) {
    throw new Error(
      `[deploy:pages] Pages build output not found at ${distDir}.\n` +
        'Please run `pnpm build` before running deploy:pages.',
    );
  }

  const tempPages = generatePagesTempDir(validDbId);

  try {
    if (!apply) {
      console.log(
        `[deploy:pages] [DRY-RUN] Verifying Pages Functions and static build for easytmp-mail (DB ID: ${validDbId})...`,
      );
      executor('npx wrangler pages functions build functions', {
        cwd: apiDir,
        stdio: 'inherit',
      });
      console.log(
        '[deploy:pages] [DRY-RUN] Pages package and Functions verified. Pass --apply to publish.',
      );
    } else {
      console.log(
        `[deploy:pages] [APPLY] Deploying Cloudflare Pages project (easytmp-mail) with DB ID: ${validDbId}...`,
      );
      executor('npx wrangler pages functions build functions', {
        cwd: tempPages.tempDir,
        stdio: 'inherit',
      });
      executor(
        `npx wrangler pages deploy "${distDir}" --project-name easytmp-mail --cwd "${tempPages.tempDir}"`,
        {
          stdio: 'inherit',
        },
      );
      console.log('[deploy:pages] [APPLY] Cloudflare Pages deployment completed.');
    }
  } finally {
    tempPages.cleanup();
  }
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const flags = parseCliFlags();
  deployPages({ apply: flags.apply });
}
