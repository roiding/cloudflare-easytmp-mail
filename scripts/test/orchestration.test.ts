import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { orchestrateDeployment } from '../orchestrate-deployment.js';
import { CloudflareClient } from '../lib/cloudflare-client.js';

const MOCK_ZONE_ID = '0123456789abcdef0123456789abcdef';
const MOCK_ACCOUNT_ID = 'fedcba9876543210fedcba9876543210';
const MOCK_TOKEN = 'mock-api-token-test-1234567890ab';
const MOCK_DB_ID = '99999999-8888-4777-8666-555555555555';

function createMockFetch() {
  return vi.fn().mockImplementation(async (url: string) => {
    const path = url.replace('https://api.cloudflare.com/client/v4', '');
    if (path === `/zones/${MOCK_ZONE_ID}`) {
      return {
        status: 200,
        ok: true,
        json: async () => ({
          success: true,
          result: {
            id: MOCK_ZONE_ID,
            name: 'cottage.dpdns.org',
            status: 'active',
            account: { id: MOCK_ACCOUNT_ID },
          },
        }),
      };
    }
    if (path === `/zones/${MOCK_ZONE_ID}/email/routing`) {
      return {
        status: 200,
        ok: true,
        json: async () => ({ success: true, result: { enabled: true } }),
      };
    }
    if (path === `/zones/${MOCK_ZONE_ID}/email/routing/rules/catch_all`) {
      return {
        status: 200,
        ok: true,
        json: async () => ({
          success: true,
          result: { enabled: true, actions: [{ type: 'worker', value: ['easytmp-mail-inbound'] }] },
        }),
      };
    }
    if (path === `/zones/${MOCK_ZONE_ID}/email/routing/rules`) {
      return { status: 200, ok: true, json: async () => ({ success: true, result: [] }) };
    }
    if (path === `/zones/${MOCK_ZONE_ID}/email/routing/dns`) {
      return {
        status: 200,
        ok: true,
        json: async () => ({ success: true, result: { status: 'ok' } }),
      };
    }
    if (path === `/zones/${MOCK_ZONE_ID}/dns_records`) {
      return { status: 200, ok: true, json: async () => ({ success: true, result: [] }) };
    }
    if (path.includes('/workers/scripts/')) {
      return {
        status: 200,
        ok: true,
        json: async () => ({ success: true, result: { id: 'script' } }),
      };
    }
    if (path.includes('/pages/projects/easytmp-mail/domains')) {
      return {
        status: 200,
        ok: true,
        json: async () => ({
          success: true,
          result: [{ name: 'inbox.cottage.dpdns.org', status: 'active' }],
        }),
      };
    }
    return { status: 200, ok: true, json: async () => ({ success: true, result: {} }) };
  });
}

describe('Deployment Orchestration Safety Engine', () => {
  const origEnv = { ...process.env };

  beforeEach(() => {
    process.env.CLOUDFLARE_D1_DATABASE_ID = MOCK_DB_ID;
    process.env.CLOUDFLARE_API_TOKEN = MOCK_TOKEN;
    process.env.CLOUDFLARE_ACCOUNT_ID = MOCK_ACCOUNT_ID;
    process.env.CLOUDFLARE_ZONE_ID = MOCK_ZONE_ID;
    delete process.env.MAIL_DOMAIN;
  });

  afterEach(() => {
    process.env = { ...origEnv };
  });

  it('blocks execution when D1 database ID is missing or invalid', async () => {
    delete process.env.CLOUDFLARE_D1_DATABASE_ID;
    await expect(orchestrateDeployment({ stage: 'preflight' })).rejects.toThrowError(
      /valid Cloudflare D1 Database ID/,
    );
  });

  it('strictly blocks execution when MAIL_DOMAIN is set to roiding.dpdns.org', async () => {
    process.env.MAIL_DOMAIN = 'roiding.dpdns.org';
    await expect(orchestrateDeployment({ stage: 'preflight' })).rejects.toThrowError(
      /\[SECURITY_REFUSAL\]/,
    );
  });

  it('rejects unknown deployment stage', async () => {
    await expect(
      orchestrateDeployment({ stage: 'invalid-stage' as unknown as typeof fetch }),
    ).rejects.toThrowError(/Unknown stage: "invalid-stage"/);
  });

  it('runs preflight stage with mock subprocess and verified zone in dry-run', async () => {
    const mockFetch = createMockFetch();
    const mockSubprocess = vi.fn();

    const client = new CloudflareClient({
      apiToken: MOCK_TOKEN,
      zoneId: MOCK_ZONE_ID,
      accountId: MOCK_ACCOUNT_ID,
      fetchFn: mockFetch,
    });

    const res = await orchestrateDeployment({
      stage: 'preflight',
      apply: false,
      oldWorker: 'old-worker-1',
      client,
      runSubprocess: mockSubprocess,
    });

    expect(res.ok).toBe(true);
    expect(res.stage).toBe('preflight');
    expect(res.dryRun).toBe(true);

    // Verify subprocess commands were called in order: check -> test:all -> build
    expect(mockSubprocess).toHaveBeenCalledWith('pnpm check', expect.anything());
    expect(mockSubprocess).toHaveBeenCalledWith('pnpm test:all', expect.anything());
    expect(mockSubprocess).toHaveBeenCalledWith('pnpm build', expect.anything());
  });

  it('runs switch stage in dry-run without mutating remote state', async () => {
    const mockFetch = createMockFetch();
    const mockSubprocess = vi.fn();

    const client = new CloudflareClient({
      apiToken: MOCK_TOKEN,
      zoneId: MOCK_ZONE_ID,
      accountId: MOCK_ACCOUNT_ID,
      fetchFn: mockFetch,
    });

    const res = await orchestrateDeployment({
      stage: 'switch',
      apply: false,
      client,
      runSubprocess: mockSubprocess,
    });

    expect(res.ok).toBe(true);
    expect(res.stage).toBe('switch');
    expect(res.applied).toBe(false);

    // Verify dry-run commands were dispatched through mockSubprocess
    expect(mockSubprocess).toHaveBeenCalledWith(
      expect.stringContaining('wrangler d1 migrations list'),
      expect.anything(),
    );
    expect(mockSubprocess).toHaveBeenCalledWith(
      expect.stringContaining('wrangler deploy --dry-run'),
      expect.anything(),
    );
    expect(mockSubprocess).toHaveBeenCalledWith(
      expect.stringContaining('wrangler pages functions build'),
      expect.anything(),
    );
  });
});
