import { existsSync, readFileSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
const DOMAIN_REGEX =
  /^(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/i;

const __dirname = dirname(fileURLToPath(import.meta.url));
const rootDir = resolve(__dirname, '../..');
export const DEFAULT_CONFIG_PATH = resolve(rootDir, 'easytmp.config.json');

function normalizeDomain(value, fieldName) {
  if (typeof value !== 'string' || value.trim() === '') {
    throw new Error(`[CONFIG_ERROR] ${fieldName} must be a non-empty domain string.`);
  }
  const domain = value.trim().toLowerCase().replace(/\.$/, '');
  if (!DOMAIN_REGEX.test(domain)) {
    throw new Error(
      `[CONFIG_ERROR] ${fieldName} is not a valid ASCII/Punycode domain: "${value}".`,
    );
  }
  return domain;
}

function slugFromDomain(domain) {
  const labels = domain.split('.');
  const base = labels.length >= 2 ? labels.slice(0, -1).join('-') : labels[0];
  return (
    base
      .replace(/[^a-z0-9-]+/g, '-')
      .replace(/^-+|-+$/g, '')
      .slice(0, 38) || 'mail'
  );
}

function validateResourceName(value, fieldName, fallback) {
  const name = value === undefined || value === null || value === '' ? fallback : value;
  if (typeof name !== 'string' || !/^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/.test(name)) {
    throw new Error(
      `[CONFIG_ERROR] ${fieldName} must be 1-63 lowercase letters, digits, or hyphens, ` +
        'with alphanumeric start and end.',
    );
  }
  return name;
}

export function validateConfig(raw = {}, configPath = DEFAULT_CONFIG_PATH) {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) {
    throw new Error('[CONFIG_ERROR] easytmp.config.json must contain a JSON object.');
  }
  const mailDomain = normalizeDomain(raw.mailDomain, 'mailDomain');
  const legacyProduction = mailDomain === 'cottage.dpdns.org';
  const defaultBase = legacyProduction ? 'easytmp-mail' : `easytmp-${slugFromDomain(mailDomain)}`;
  const webHostname = normalizeDomain(
    raw.webHostname === undefined ? `inbox.${mailDomain}` : raw.webHostname,
    'webHostname',
  );
  if (!webHostname.endsWith(`.${mailDomain}`)) {
    throw new Error(
      `[CONFIG_ERROR] webHostname "${webHostname}" must be a subdomain of mailDomain "${mailDomain}".`,
    );
  }
  const projectName = validateResourceName(raw.projectName, 'projectName', defaultBase);
  const workerName = validateResourceName(
    raw.workerName,
    'workerName',
    legacyProduction ? 'easytmp-mail-inbound' : `${defaultBase.slice(0, 52)}-worker`,
  );
  const d1Name = validateResourceName(raw.d1DatabaseName, 'd1DatabaseName', defaultBase);

  return Object.freeze({
    configPath,
    mailDomain,
    webHostname,
    d1DatabaseName: d1Name,
    projectName,
    workerName,
    accountId: raw.accountId || null,
    zoneId: raw.zoneId || null,
    d1DatabaseId: raw.d1DatabaseId || null,
    autoCreateResources: raw.autoCreateResources !== false,
    enableEmailRouting: raw.enableEmailRouting !== false,
    d1Location: raw.d1Location || 'apac',
  });
}

export function loadConfig(configPath = process.env.EASYTMP_CONFIG || DEFAULT_CONFIG_PATH) {
  const absolutePath = resolve(configPath);
  if (!existsSync(absolutePath)) {
    throw new Error(
      `[CONFIG_ERROR] Missing ${absolutePath}. Create it with at least ` +
        '{"mailDomain":"example.com"}.',
    );
  }
  let raw;
  try {
    raw = JSON.parse(readFileSync(absolutePath, 'utf8'));
  } catch (error) {
    throw new Error(`[CONFIG_ERROR] Cannot parse ${absolutePath}: ${error.message}`);
  }
  return validateConfig(raw, absolutePath);
}

export function applyConfigToEnv(config, baseEnv = process.env) {
  return {
    ...baseEnv,
    MAIL_DOMAIN: config.mailDomain,
    EASYTMP_WEB_HOSTNAME: config.webHostname,
    EASYTMP_PROJECT_NAME: config.projectName,
    EASYTMP_WORKER_NAME: config.workerName,
    EASYTMP_D1_NAME: config.d1DatabaseName,
    ...(config.accountId ? { CLOUDFLARE_ACCOUNT_ID: config.accountId } : {}),
    ...(config.zoneId ? { CLOUDFLARE_ZONE_ID: config.zoneId } : {}),
    ...(config.d1DatabaseId ? { CLOUDFLARE_D1_DATABASE_ID: config.d1DatabaseId } : {}),
  };
}
