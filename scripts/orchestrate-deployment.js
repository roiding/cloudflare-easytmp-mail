import { execSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { resolve, dirname } from 'node:path';
import {
  DEFAULT_WORKER_NAME,
  EXPECTED_MAIL_DOMAIN,
  parseCliFlags,
  validateAccountId,
  validateApiToken,
  validateDatabaseId,
  validateMailDomain,
  validateZoneId,
} from './lib/env.js';
import { CloudflareClient } from './lib/cloudflare-client.js';
import { deployWorker } from './deploy-worker.js';
import { migrateRemote } from './migrate-remote.js';
import { deployPages } from './deploy-pages.js';
import { configureEmailRouting } from './configure-email-routing.js';
import { configurePagesDomain } from './configure-pages-domain.js';
import { cleanupOldService } from './cleanup-old-service.js';
import { runSmokeTests } from './smoke-test.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const rootDir = resolve(__dirname, '..');

export async function orchestrateDeployment({
  stage = 'preflight',
  apply = false,
  oldWorker = null,
  baseUrl = process.env.BASE_URL || 'https://inbox.cottage.dpdns.org',
  client = null,
  runSubprocess = execSync,
} = {}) {
  console.log(`\n================ Deployment Orchestration ================`);
  console.log(
    `Stage: ${stage.toUpperCase()} | Mode: ${apply ? 'APPLY (Mutating)' : 'DRY-RUN (Safe Simulation)'}`,
  );
  console.log(`Target Mail Domain: ${EXPECTED_MAIL_DOMAIN}`);
  console.log(`Target Web Domain:  inbox.${EXPECTED_MAIL_DOMAIN}`);
  console.log(`==========================================================\n`);

  validateMailDomain(process.env.MAIL_DOMAIN || EXPECTED_MAIL_DOMAIN, 'orchestrateDeployment');

  // Stage 1: PREFLIGHT
  if (stage === 'preflight') {
    console.log('[preflight] 1/4 Validating required environment variables...');
    const dbId = validateDatabaseId(process.env.CLOUDFLARE_D1_DATABASE_ID, 'preflight');
    const token = validateApiToken(process.env.CLOUDFLARE_API_TOKEN, 'preflight');
    const accountId = validateAccountId(process.env.CLOUDFLARE_ACCOUNT_ID, 'preflight');
    const zoneId = validateZoneId(process.env.CLOUDFLARE_ZONE_ID, 'preflight');
    console.log(
      `[preflight] ✓ Environment variables validated (D1 UUID: ${dbId}). Token & IDs confirmed.`,
    );

    const cfClient =
      client ||
      new CloudflareClient({
        apiToken: token,
        accountId,
        zoneId,
      });

    console.log('[preflight] 2/4 Verifying Cloudflare Zone safety guard...');
    const zoneInfo = await cfClient.verifyCottageZone();
    console.log(
      `[preflight] ✓ Cloudflare zone confirmed: "${zoneInfo.zoneName}" (${zoneInfo.zoneId}). roiding.dpdns.org isolated.`,
    );

    console.log(
      '[preflight] 3/4 Running repository typecheck, lint, formatting, tests, and build...',
    );
    runSubprocess('pnpm check', { cwd: rootDir, stdio: 'inherit' });
    runSubprocess('pnpm test:all', { cwd: rootDir, stdio: 'inherit' });
    runSubprocess('pnpm build', { cwd: rootDir, stdio: 'inherit' });
    console.log('[preflight] ✓ Static checks, test suites, and build completed successfully.');

    console.log('[preflight] 4/4 Simulating deployments and configurations (Dry Run)...');
    migrateRemote({ apply: false, dbId, executor: runSubprocess });
    deployWorker({ apply: false, dbId, executor: runSubprocess });
    await configureEmailRouting({ client: cfClient, apply: false });
    deployPages({ apply: false, dbId, executor: runSubprocess });
    await configurePagesDomain({ client: cfClient, apply: false });
    await cleanupOldService({
      client: cfClient,
      apply: false,
      oldWorkerName: oldWorker,
      stage: 'preflight',
    });

    console.log('\n[preflight] ✓ Preflight validation completed successfully.');
    console.log(
      'To apply remote changes, run with: node scripts/orchestrate-deployment.js --stage=switch --apply',
    );
    return { ok: true, stage: 'preflight', dryRun: true };
  }

  // Stage 2: SWITCH
  if (stage === 'switch') {
    const dbId = validateDatabaseId(process.env.CLOUDFLARE_D1_DATABASE_ID, 'switch');
    const token = validateApiToken(process.env.CLOUDFLARE_API_TOKEN, 'switch');
    const accountId = validateAccountId(process.env.CLOUDFLARE_ACCOUNT_ID, 'switch');
    const zoneId = validateZoneId(process.env.CLOUDFLARE_ZONE_ID, 'switch');

    const cfClient =
      client ||
      new CloudflareClient({
        apiToken: token,
        accountId,
        zoneId,
      });

    console.log('[switch] 1/6 Verifying zone safety guard before any operations...');
    await cfClient.verifyCottageZone();

    console.log('[switch] 2/6 Applying remote D1 migrations...');
    migrateRemote({ apply, dbId, executor: runSubprocess });

    console.log('[switch] 3/6 Deploying Inbound Email Worker (easytmp-mail-inbound)...');
    deployWorker({ apply, dbId, executor: runSubprocess });

    console.log('[switch] 4/6 Configuring Email Routing catch-all rule...');
    await configureEmailRouting({ client: cfClient, apply, targetWorker: DEFAULT_WORKER_NAME });

    console.log('[switch] 5/6 Deploying Cloudflare Pages project (easytmp-mail)...');
    deployPages({ apply, dbId, executor: runSubprocess });

    console.log('[switch] 6/6 Configuring Pages custom domain (inbox.cottage.dpdns.org)...');
    await configurePagesDomain({ client: cfClient, apply });

    if (apply) {
      console.log('\n[switch] Running post-deployment smoke tests against deployed service...');
      await runSmokeTests({ baseUrl });
      console.log('\n[switch] Switch deployment completed.');
      console.log('Next step: verify live email receiving and UI. Once verified, run:');
      console.log(
        '  node scripts/orchestrate-deployment.js --stage=cleanup --apply [--old-worker <name>]',
      );
    } else {
      console.log('\n[switch] [DRY-RUN] Switch simulation completed. No remote state modified.');
    }

    return { ok: true, stage: 'switch', applied: apply };
  }

  // Stage 3: CLEANUP
  if (stage === 'cleanup') {
    console.log('[cleanup] Starting explicit cleanup stage for old cottage.dpdns.org service...');
    if (!apply) {
      console.log(
        '[cleanup] [DRY-RUN] Running inventory and safety review without deleting resources.',
      );
    }

    const token = validateApiToken(process.env.CLOUDFLARE_API_TOKEN, 'cleanup');
    const accountId = validateAccountId(process.env.CLOUDFLARE_ACCOUNT_ID, 'cleanup');
    const zoneId = validateZoneId(process.env.CLOUDFLARE_ZONE_ID, 'cleanup');

    const cfClient =
      client ||
      new CloudflareClient({
        apiToken: token,
        accountId,
        zoneId,
      });

    const result = await cleanupOldService({
      client: cfClient,
      apply,
      oldWorkerName: oldWorker,
      stage: 'cleanup',
    });

    return { ok: true, stage: 'cleanup', result };
  }

  throw new Error(
    `[CONFIG_ERROR] Unknown stage: "${stage}". Allowed stages: preflight, switch, cleanup.`,
  );
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const flags = parseCliFlags();
  orchestrateDeployment({
    stage: flags.stage || 'preflight',
    apply: flags.apply,
    oldWorker: flags.oldWorker,
    baseUrl: flags.url,
  }).catch((err) => {
    console.error(`\n[DEPLOYMENT BLOCKED] ${err.message}`);
    process.exit(1);
  });
}
