import { loadConfig } from './config.js';

const UUID_REGEX = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const HEX32_REGEX = /^[0-9a-f]{32}$/i;

export const PROJECT_CONFIG = loadConfig();
export const EXPECTED_MAIL_DOMAIN = PROJECT_CONFIG.mailDomain;
export const EXPECTED_PAGES_DOMAIN = PROJECT_CONFIG.webHostname;
export const DEFAULT_WORKER_NAME = PROJECT_CONFIG.workerName;
export const DEFAULT_PAGES_PROJECT = PROJECT_CONFIG.projectName;
export const DEFAULT_D1_NAME = PROJECT_CONFIG.d1DatabaseName;

// Kept for the historical single-domain migration scripts. New onboarding
// never uses a hard-coded destination; it always reads easytmp.config.json.
export const FORBIDDEN_DOMAIN = 'roiding.dpdns.org';

export function validateDatabaseId(dbId, actionName = 'Operation') {
  const trimmed = dbId?.trim();
  if (
    !trimmed ||
    trimmed.includes('placeholder') ||
    trimmed === 'easytmp-mail-local-id' ||
    !UUID_REGEX.test(trimmed)
  ) {
    throw new Error(
      `[CONFIG_ERROR] ${actionName} requires a valid Cloudflare D1 Database ID (UUID v4). Received: "${dbId || ''}".\n` +
        'Please export CLOUDFLARE_D1_DATABASE_ID="xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx".',
    );
  }
  return trimmed;
}

export function validateApiToken(token, actionName = 'Cloudflare API call') {
  const trimmed = token?.trim();
  if (!trimmed || trimmed.includes('placeholder') || trimmed.length < 10) {
    throw new Error(
      `[CONFIG_ERROR] ${actionName} requires a valid CLOUDFLARE_API_TOKEN.\n` +
        'Please export CLOUDFLARE_API_TOKEN with appropriate permissions (Email Routing, DNS, Workers, Pages).',
    );
  }
  return trimmed;
}

export function validateZoneId(zoneId, actionName = 'Zone operation') {
  const trimmed = zoneId?.trim();
  if (!trimmed || trimmed.includes('placeholder') || !HEX32_REGEX.test(trimmed)) {
    throw new Error(
      `[CONFIG_ERROR] ${actionName} requires a 32-character hex CLOUDFLARE_ZONE_ID.\n` +
        `Please export CLOUDFLARE_ZONE_ID for ${EXPECTED_MAIL_DOMAIN}.`,
    );
  }
  return trimmed;
}

export function validateAccountId(accountId, actionName = 'Account operation') {
  const trimmed = accountId?.trim();
  if (!trimmed || trimmed.includes('placeholder') || !HEX32_REGEX.test(trimmed)) {
    throw new Error(
      `[CONFIG_ERROR] ${actionName} requires a 32-character hex CLOUDFLARE_ACCOUNT_ID.\n` +
        'Please export CLOUDFLARE_ACCOUNT_ID.',
    );
  }
  return trimmed;
}

export function validateMailDomain(domain = EXPECTED_MAIL_DOMAIN, actionName = 'Domain operation') {
  const trimmed = (domain || EXPECTED_MAIL_DOMAIN).trim().toLowerCase().replace(/\.$/, '');
  if (
    !/^(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/.test(
      trimmed,
    )
  ) {
    throw new Error(`[CONFIG_ERROR] ${actionName} received an invalid domain: "${trimmed}".`);
  }
  if (trimmed === FORBIDDEN_DOMAIN) {
    throw new Error(
      `[SECURITY_REFUSAL] ${actionName} strictly forbids operations targeting "${trimmed}".`,
    );
  }
  if (trimmed !== EXPECTED_MAIL_DOMAIN) {
    throw new Error(
      `[CONFIG_ERROR] ${actionName} received unexpected MAIL_DOMAIN: "${trimmed}". ` +
        `Expected "${EXPECTED_MAIL_DOMAIN}".`,
    );
  }
  return trimmed;
}

export function resolveConfiguredValue(value, configValue) {
  return value || configValue;
}

export function parseCliFlags(args = process.argv.slice(2)) {
  const flags = {
    apply: false,
    dryRun: true,
    stage: 'preflight',
    oldWorker: null,
    url: null,
  };

  for (let i = 0; i < args.length; i++) {
    const arg = args[i];
    if (arg === '--apply') {
      flags.apply = true;
      flags.dryRun = false;
    } else if (arg === '--dry-run') {
      flags.dryRun = true;
      flags.apply = false;
    } else if (arg === '--stage' && i + 1 < args.length) {
      flags.stage = args[++i];
    } else if (arg.startsWith('--stage=')) {
      flags.stage = arg.split('=')[1];
    } else if (arg === '--old-worker' && i + 1 < args.length) {
      flags.oldWorker = args[++i];
    } else if (arg.startsWith('--old-worker=')) {
      flags.oldWorker = arg.split('=')[1];
    } else if (arg === '--url' && i + 1 < args.length) {
      flags.url = args[++i];
    } else if (arg.startsWith('--url=')) {
      flags.url = arg.split('=')[1];
    }
  }

  return flags;
}
