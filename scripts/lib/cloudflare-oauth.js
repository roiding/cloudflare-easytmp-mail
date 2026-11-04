import { execFileSync } from 'node:child_process';

function parseJsonOutput(raw, label) {
  if (typeof raw !== 'string') {
    throw new Error(`[AUTH_REQUIRED] Wrangler returned no ${label}.`);
  }

  try {
    return JSON.parse(raw);
  } catch {
    const start = raw.indexOf('{');
    const end = raw.lastIndexOf('}');
    if (start >= 0 && end > start) {
      try {
        return JSON.parse(raw.slice(start, end + 1));
      } catch {
        // Fall through to the actionable error below.
      }
    }
  }

  throw new Error(`[AUTH_REQUIRED] Wrangler returned invalid ${label}.`);
}

/**
 * Resolve Cloudflare auth without ever printing or persisting credentials.
 * A supplied API token wins; otherwise Wrangler's local OAuth session is used.
 */
export function resolveCloudflareCredentials({ env = process.env, executor = execFileSync } = {}) {
  const suppliedToken = env.CLOUDFLARE_API_TOKEN?.trim();
  if (suppliedToken) return suppliedToken;

  const output = executor('npx', ['wrangler', 'auth', 'token', '--json'], {
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  const credentials = parseJsonOutput(output, 'authentication credentials');
  const token = credentials?.token?.trim();
  if (!token) {
    throw new Error(
      '[AUTH_REQUIRED] Run `pnpm exec wrangler login` and retry. ' +
        'The documentation chain can also use CLOUDFLARE_API_TOKEN for automation.',
    );
  }
  return token;
}

export function readWranglerAccounts({ executor = execFileSync } = {}) {
  const raw = executor('npx', ['wrangler', 'whoami', '--json'], {
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'inherit'],
  });
  const parsed = parseJsonOutput(raw, 'account information');
  if (!parsed.loggedIn || !Array.isArray(parsed.accounts) || parsed.accounts.length === 0) {
    throw new Error('[AUTH_REQUIRED] Wrangler is not logged in to a Cloudflare account.');
  }
  return parsed;
}

export function resolveAccountId({ env = process.env, config, executor = execFileSync } = {}) {
  if (env.CLOUDFLARE_ACCOUNT_ID) return env.CLOUDFLARE_ACCOUNT_ID;
  if (config.accountId) return config.accountId;
  const accounts = readWranglerAccounts({ executor }).accounts;
  if (accounts.length !== 1) {
    throw new Error(
      `[CONFIG_ERROR] Found ${accounts.length} Cloudflare accounts. ` +
        'Set accountId in easytmp.config.json or CLOUDFLARE_ACCOUNT_ID.',
    );
  }
  return accounts[0].id;
}
