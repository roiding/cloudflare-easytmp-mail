import { describe, it, expect, vi } from 'vitest';
import { configurePagesDomain } from '../configure-pages-domain.js';
import { CloudflareClient } from '../lib/cloudflare-client.js';

const MOCK_ACCOUNT_ID = 'fedcba9876543210fedcba9876543210';
const MOCK_TOKEN = 'mock-api-token-test-1234567890ab';

function createMockFetch(overrides: Record<string, unknown> = {}) {
  return vi.fn().mockImplementation(async (url: string, opts: RequestInit) => {
    const path = url.replace('https://api.cloudflare.com/client/v4', '');
    const method = opts.method || 'GET';

    if (path === `/accounts/${MOCK_ACCOUNT_ID}/pages/projects/easytmp-mail/domains`) {
      if (method === 'POST') {
        const body = JSON.parse(opts.body as string);
        return {
          status: 200,
          ok: true,
          json: async () => ({
            success: true,
            result: { id: 'domain-id-new', name: body.name, status: 'initializing' },
          }),
        };
      }
      return {
        status: 200,
        ok: true,
        json: async () => ({
          success: true,
          result: overrides.domains ?? [],
        }),
      };
    }

    return { status: 200, ok: true, json: async () => ({ success: true, result: {} }) };
  });
}

describe('configurePagesDomain Script', () => {
  it('strictly rejects any custom domain other than inbox.cottage.dpdns.org', async () => {
    const mockFetch = createMockFetch();
    const client = new CloudflareClient({
      apiToken: MOCK_TOKEN,
      accountId: MOCK_ACCOUNT_ID,
      fetchFn: mockFetch,
    });

    await expect(
      configurePagesDomain({ client, customDomain: 'wrong.domain.com' }),
    ).rejects.toThrowError(
      /\[CONFIG_ERROR\].*Only exact hostname "inbox\.cottage\.dpdns\.org" is supported/,
    );
  });

  it('detects existing domain binding and skips POST', async () => {
    const mockFetch = createMockFetch({
      domains: [{ id: 'd-1', name: 'inbox.cottage.dpdns.org', status: 'active' }],
    });

    const client = new CloudflareClient({
      apiToken: MOCK_TOKEN,
      accountId: MOCK_ACCOUNT_ID,
      fetchFn: mockFetch,
    });

    const res = await configurePagesDomain({ client, apply: false });
    expect(res.bound).toBe(true);
    expect(res.status).toBe('active');

    const postCalls = mockFetch.mock.calls.filter((c) => c[1]?.method === 'POST');
    expect(postCalls).toHaveLength(0);
  });

  it('runs dry-run by default without making POST request', async () => {
    const mockFetch = createMockFetch({ domains: [] });

    const client = new CloudflareClient({
      apiToken: MOCK_TOKEN,
      accountId: MOCK_ACCOUNT_ID,
      fetchFn: mockFetch,
    });

    const res = await configurePagesDomain({ client, apply: false });
    expect(res.bound).toBe(false);
    expect(res.dryRun).toBe(true);

    const postCalls = mockFetch.mock.calls.filter((c) => c[1]?.method === 'POST');
    expect(postCalls).toHaveLength(0);
  });

  it('calls POST to bind domain when apply is true', async () => {
    const mockFetch = createMockFetch({ domains: [] });

    const client = new CloudflareClient({
      apiToken: MOCK_TOKEN,
      accountId: MOCK_ACCOUNT_ID,
      fetchFn: mockFetch,
    });

    const res = await configurePagesDomain({ client, apply: true });
    expect(res.bound).toBe(true);
    expect(res.dryRun).toBe(false);

    const postCalls = mockFetch.mock.calls.filter((c) => c[1]?.method === 'POST');
    expect(postCalls).toHaveLength(1);
    const body = JSON.parse(postCalls[0][1]?.body as string);
    expect(body.name).toBe('inbox.cottage.dpdns.org');
  });
});
