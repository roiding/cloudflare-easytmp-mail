import { describe, it, expect, vi } from 'vitest';
import { configureEmailRouting } from '../configure-email-routing.js';
import { CloudflareClient } from '../lib/cloudflare-client.js';
import { DEFAULT_WORKER_NAME } from '../lib/env.js';

const MOCK_ZONE_ID = '0123456789abcdef0123456789abcdef';
const MOCK_ACCOUNT_ID = 'fedcba9876543210fedcba9876543210';
const MOCK_TOKEN = 'mock-api-token-value-test-12345678';

function createMockFetch(overrides: Record<string, unknown> = {}) {
  return vi.fn().mockImplementation(async (url: string, opts: RequestInit) => {
    const path = url.replace('https://api.cloudflare.com/client/v4', '');
    const method = opts.method || 'GET';

    if (overrides[`${method} ${path}`]) {
      return {
        status: 200,
        ok: true,
        json: async () => ({ success: true, result: overrides[`${method} ${path}`] }),
      };
    }

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
        json: async () => ({
          success: true,
          result: { id: 'settings-1', status: 'ready', enabled: true },
        }),
      };
    }

    if (path === `/accounts/${MOCK_ACCOUNT_ID}/workers/scripts`) {
      return {
        status: 200,
        ok: true,
        json: async () => ({
          success: true,
          result: [{ id: 'easytmp-mail-inbound', created_on: '2026-11-03T00:00:00Z' }],
        }),
      };
    }

    if (path === `/zones/${MOCK_ZONE_ID}/email/routing/rules/catch_all`) {
      if (method === 'PUT') {
        const body = JSON.parse(opts.body as string);
        return {
          status: 200,
          ok: true,
          json: async () => ({
            success: true,
            result: { id: 'catch-all-id', ...body },
          }),
        };
      }
      return {
        status: 200,
        ok: true,
        json: async () => ({
          success: true,
          result: overrides.catchAllRule ?? {
            id: 'old-catch-all',
            enabled: true,
            actions: [{ type: 'forward', value: ['old@example.com'] }],
            matchers: [{ type: 'all' }],
          },
        }),
      };
    }

    return {
      status: 200,
      ok: true,
      json: async () => ({ success: true, result: {} }),
    };
  });
}

describe('configureEmailRouting Automation Script', () => {
  it('detects existing catch-all configuration and exits without modifying', async () => {
    const mockFetch = createMockFetch({
      catchAllRule: {
        id: 'catch-all-already-configured',
        enabled: true,
        actions: [{ type: 'worker', value: ['easytmp-mail-inbound'] }],
        matchers: [{ type: 'all' }],
      },
    });

    const client = new CloudflareClient({
      apiToken: MOCK_TOKEN,
      zoneId: MOCK_ZONE_ID,
      accountId: MOCK_ACCOUNT_ID,
      fetchFn: mockFetch,
    });

    const res = await configureEmailRouting({ client, apply: false });
    expect(res.modified).toBe(false);

    // Assert that PUT was NEVER called
    const putCalls = mockFetch.mock.calls.filter((call) => call[1]?.method === 'PUT');
    expect(putCalls).toHaveLength(0);
  });

  it('runs dry-run by default without calling PUT even when rule differs', async () => {
    const mockFetch = createMockFetch();

    const client = new CloudflareClient({
      apiToken: MOCK_TOKEN,
      zoneId: MOCK_ZONE_ID,
      accountId: MOCK_ACCOUNT_ID,
      fetchFn: mockFetch,
    });

    const res = await configureEmailRouting({ client, apply: false });
    expect(res.modified).toBe(false);
    expect(res.dryRun).toBe(true);

    const putCalls = mockFetch.mock.calls.filter((call) => call[1]?.method === 'PUT');
    expect(putCalls).toHaveLength(0);
  });

  it('creates sanitized backup and updates rule when apply is true', async () => {
    const mockFetch = createMockFetch();

    const client = new CloudflareClient({
      apiToken: MOCK_TOKEN,
      zoneId: MOCK_ZONE_ID,
      accountId: MOCK_ACCOUNT_ID,
      fetchFn: mockFetch,
    });

    const res = await configureEmailRouting({ client, apply: true });
    expect(res.modified).toBe(true);
    expect(res.dryRun).toBe(false);
    expect(res.backup).toBeDefined();
    expect(res.backup?.filepath).toContain('email-routing-backup-');

    const putCalls = mockFetch.mock.calls.filter((call) => call[1]?.method === 'PUT');
    expect(putCalls).toHaveLength(1);

    const body = JSON.parse(putCalls[0][1]?.body as string);
    expect(body.actions[0].type).toBe('worker');
    expect(body.actions[0].value).toEqual([DEFAULT_WORKER_NAME]);
    expect(body.matchers[0].type).toBe('all');
    expect(body.enabled).toBe(true);
  });

  it('strictly rejects when mail domain is set to roiding.dpdns.org', async () => {
    const mockFetch = createMockFetch();
    const client = new CloudflareClient({
      apiToken: MOCK_TOKEN,
      zoneId: MOCK_ZONE_ID,
      accountId: MOCK_ACCOUNT_ID,
      fetchFn: mockFetch,
    });

    await expect(
      configureEmailRouting({ client, mailDomain: 'roiding.dpdns.org', apply: false }),
    ).rejects.toThrowError(/\[SECURITY_REFUSAL\]/);
  });
});
