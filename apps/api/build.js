import { cpSync, existsSync, mkdirSync, rmSync } from 'node:fs';
import { execSync } from 'node:child_process';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const webDist = resolve(__dirname, '../web/dist');
const apiDist = resolve(__dirname, 'dist');

if (!existsSync(webDist)) {
  throw new Error(`Web build output not found at ${webDist}. Run web build first.`);
}

// 1. Copy web static assets and _headers into apps/api/dist
mkdirSync(apiDist, { recursive: true });
cpSync(webDist, apiDist, { recursive: true });
console.log(`[build:api] Copied web assets from ${webDist} to ${apiDist}`);

// 2. Validate Pages Functions bundle with Wrangler
console.log('[build:api] Validating Pages Functions bundle with Wrangler...');
execSync('npx wrangler pages functions build functions', {
  cwd: __dirname,
  stdio: 'inherit',
});

// Clean up temporary bundle file if created in project root
const bundleFile = resolve(__dirname, '_worker.bundle');
if (existsSync(bundleFile)) {
  rmSync(bundleFile, { force: true });
}
console.log('[build:api] Pages Functions packaging verified successfully.');
