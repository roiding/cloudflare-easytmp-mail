import { execFileSync } from 'node:child_process';
import { readFileSync, writeFileSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { applyConfigToEnv, loadConfig } from './lib/config.js';
import { parseCliFlags, validateDatabaseId } from './lib/env.js';
import { CloudflareClient } from './lib/cloudflare-client.js';
import { resolveAccountId, resolveCloudflareCredentials } from './lib/cloudflare-oauth.js';
import { migrateRemote } from './migrate-remote.js';
import { deployWorker } from './deploy-worker.js';
import { deployPages } from './deploy-pages.js';
import { configureEmailRouting } from './configure-email-routing.js';
import { configurePagesDomain } from './configure-pages-domain.js';
import { runSmokeTests } from './smoke-test.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const rootDir = resolve(__dirname, '..');

function runPnpm(args, options = {}) {
  return execFileSync('pnpm', args, options);
}

function persistDiscoveredConfig(config, { accountId, zoneId, d1DatabaseId }) {
  const raw = JSON.parse(readFileSync(config.configPath, 'utf8'));
  const next = {
    ...raw,
    accountId,
    zoneId,
    d1DatabaseId,
  };
  // Persisting public resource IDs makes repeat runs idempotent. The OAuth
  // access and refresh tokens never enter this file.
  writeFileSync(config.configPath, `${JSON.stringify(next, null, 2)}\n`);
  return loadConfig(config.configPath);
}

export async function onboard({
  apply = false,
  configPath,
  pnpmRunner = runPnpm,
  commandExecutor = execFileSync,
  client,
  skipChecks = false,
} = {}) {
  let config = loadConfig(configPath);
  console.log(
    `\n[easytmp] ${apply ? 'APPLY' : 'DRY-RUN'} ${config.mailDomain} -> ${config.webHostname}`,
  );

  const accountId = resolveAccountId({ config, executor: commandExecutor });
  const apiToken = resolveCloudflareCredentials({ executor: commandExecutor });
  const env = applyConfigToEnv(config);
  env.CLOUDFLARE_API_TOKEN = apiToken;
  env.CLOUDFLARE_ACCOUNT_ID = accountId;

  const cfClient =
    client ||
    new CloudflareClient({
      apiToken,
      accountId,
      zoneId: config.zoneId || undefined,
    });

  const zone = config.zoneId
    ? await cfClient.getZone(config.zoneId)
    : await cfClient.findZoneByName(config.mailDomain);
  if (!zone) {
    throw new Error(
      `[ZONE_REQUIRED] ${config.mailDomain} is not an active zone in this account. ` +
        'Add the domain to Cloudflare and activate its nameservers first.',
    );
  }
  cfClient.zoneId = zone.id;
  const zoneInfo = await cfClient.verifyConfiguredZone(config.mailDomain);
  if (zoneInfo.accountId && zoneInfo.accountId !== accountId) {
    throw new Error(
      `[ACCOUNT_MISMATCH] Zone "${config.mailDomain}" belongs to account ${zoneInfo.accountId}, ` +
        `but the selected account is ${accountId}. Set accountId in easytmp.config.json.`,
    );
  }

  let d1 = null;
  if (config.d1DatabaseId) {
    d1 = {
      uuid: validateDatabaseId(config.d1DatabaseId, 'onboard'),
      name: config.d1DatabaseName,
    };
  } else {
    d1 = await cfClient.findD1DatabaseByName(config.d1DatabaseName, accountId);
    if (!d1 && config.autoCreateResources && apply) {
      d1 = (
        await cfClient.ensureD1Database(config.d1DatabaseName, {
          location: config.d1Location,
          accountId,
        })
      ).database;
    }
  }
  if (!d1 && apply) {
    throw new Error(
      `[D1_REQUIRED] Missing D1 "${config.d1DatabaseName}". ` +
        'Set autoCreateResources=true or create it first.',
    );
  }

  const pages = await cfClient.findPagesProject(config.projectName, accountId);
  if (!pages && config.autoCreateResources && apply) {
    await cfClient.ensurePagesProject(config.projectName, accountId);
  }

  const routing = await cfClient.getEmailRoutingSettings(zoneInfo.zoneId);
  if (!config.enableEmailRouting && routing?.enabled !== true) {
    throw new Error(
      `[EMAIL_ROUTING_NOT_READY] ${config.mailDomain} has Email Routing disabled, and ` +
        'enableEmailRouting=false prevents automatic setup.',
    );
  }
  if (!apply) {
    console.log(
      '[easytmp] [DRY-RUN] Resource discovery complete. No remote changes made.\n' +
        `  Zone: ${zoneInfo.zoneName} (${zoneInfo.zoneId})\n` +
        `  D1: ${d1 ? `${d1.name} (${d1.uuid})` : `${config.d1DatabaseName} (will be created)`}\n` +
        `  Pages: ${config.projectName} (${pages ? 'existing' : 'will be created'})\n` +
        `  Worker: ${config.workerName}\n` +
        `  Email Routing: ${routing?.enabled ? routing.status || 'enabled' : 'will be enabled'}`,
    );
    return {
      applied: false,
      config,
      accountId,
      zone: zoneInfo,
      d1,
      pagesProject: pages,
    };
  }

  config = persistDiscoveredConfig(config, {
    accountId,
    zoneId: zoneInfo.zoneId,
    d1DatabaseId: d1.uuid,
  });
  await cfClient.updatePagesProjectConfig(config.projectName, {
    d1DatabaseId: d1.uuid,
    mailDomain: config.mailDomain,
    webHostname: config.webHostname,
    accountId,
  });

  process.env = { ...process.env, ...env, CLOUDFLARE_D1_DATABASE_ID: d1.uuid };
  if (!skipChecks) {
    pnpmRunner(['check'], { cwd: rootDir, stdio: 'inherit' });
    pnpmRunner(['test:all'], { cwd: rootDir, stdio: 'inherit' });
  }
  pnpmRunner(['build'], { cwd: rootDir, stdio: 'inherit' });

  migrateRemote({
    apply: true,
    dbId: d1.uuid,
    databaseName: config.d1DatabaseName,
    executor: commandExecutor,
  });
  deployWorker({
    apply: true,
    dbId: d1.uuid,
    projectName: config.workerName,
    executor: commandExecutor,
  });
  const deployedWorker = await cfClient.waitForWorkerScript(config.workerName, { accountId });
  if (!deployedWorker) {
    throw new Error(
      `[WORKER_NOT_VISIBLE] Worker "${config.workerName}" was deployed but is not visible yet.`,
    );
  }
  await configureEmailRouting({
    client: cfClient,
    apply: true,
    targetWorker: config.workerName,
    mailDomain: config.mailDomain,
    zoneId: zoneInfo.zoneId,
    ensureEnabled: config.enableEmailRouting,
  });
  deployPages({
    apply: true,
    dbId: d1.uuid,
    projectName: config.projectName,
    executor: commandExecutor,
  });
  await cfClient.ensureProxiedCname(
    config.webHostname,
    `${config.projectName}.pages.dev`,
    zoneInfo.zoneId,
  );
  await configurePagesDomain({
    client: cfClient,
    apply: true,
    projectName: config.projectName,
    customDomain: config.webHostname,
    zoneId: zoneInfo.zoneId,
  });
  const activeDomain = await cfClient.waitForPagesDomain(config.projectName, config.webHostname);
  if (!activeDomain) {
    throw new Error(
      `[PAGES_DOMAIN_PENDING] ${config.webHostname} was bound but did not become active ` +
        'within 120 seconds. Check Pages domain validation details and retry.',
    );
  }

  const baseUrl = `https://${config.webHostname}`;
  const smoke = await runSmokeTests({
    baseUrl,
    expectedMailDomain: config.mailDomain,
    waitForHttps: true,
  });
  const summary = {
    ok: smoke.passed,
    accountId,
    zoneId: zoneInfo.zoneId,
    mailDomain: config.mailDomain,
    webHostname: config.webHostname,
    d1Name: config.d1DatabaseName,
    d1DatabaseId: d1.uuid,
    pagesProject: config.projectName,
    worker: config.workerName,
    next:
      'Send one external email to <random-name>@' +
      config.mailDomain +
      ' and verify it through ' +
      baseUrl +
      '/api/v1.',
  };
  console.log(`\n[easytmp] Deployment summary:\n${JSON.stringify(summary, null, 2)}`);
  if (!smoke.passed) {
    throw new Error('[SMOKE_FAILED] Production deployment completed, but smoke tests failed.');
  }
  return summary;
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const flags = parseCliFlags();
  onboard({
    apply: flags.apply,
    configPath: process.env.EASYTMP_CONFIG,
    skipChecks: process.argv.includes('--skip-checks'),
  }).catch((error) => {
    console.error(`\n[ONBOARD_BLOCKED] ${error.message}`);
    process.exit(1);
  });
}
