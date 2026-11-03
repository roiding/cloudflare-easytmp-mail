import { describe, it, expect, vi } from 'vitest';
import { CloudflareClient, CloudflareApiError } from '../lib/cloudflare-client.js';

const MOCK_ZONE_ID = '0123456789abcdef0123456789abcdef';
const MOCK_ACCOUNT_ID = 'fedcba9876543210fedcba9876543210';
const MOCK_TOKEN = 'mock-cf-token-secret-value-12345678';

function createMockFetch(
  handler: (url: string, opts: RequestInit) => { status?: number; json: unknown },
) {
  return vi.fn().mockImplementation(async (url: string, opts: RequestInit) => {
    const { status = 200, json } = handler(url, opts);
    return {
      status,
      ok: status >= 200 && status < 300,
      json: async () => json,
      headers: new Headers({ 'content-type': 'application/json' }),
    } as unknown as Response;
  });
}

describe('CloudflareClient Integration Boundary', () => {
  it('attaches Authorization Bearer header without leaking token in errors', async () => {
    const mockFetch = createMockFetch((url, opts) => {
      const auth = (opts.headers as Record<string, string>)?.Authorization;
      if (auth !== `Bearer ${MOCK_TOKEN}`) {
        return {
          status: 401,
          json: { success: false, errors: [{ code: 1000, message: 'Invalid token' }] },
        };
      }
      return {
        status: 400,
        json: { success: false, errors: [{ code: 9999, message: 'Bad request details' }] },
      };
    });

    const client = new CloudflareClient({
      apiToken: MOCK_TOKEN,
      zoneId: MOCK_ZONE_ID,
      accountId: MOCK_ACCOUNT_ID,
      fetchFn: mockFetch,
    });

    try {
      await client.getEmailRoutingSettings();
      expect.fail('Should have thrown');
    } catch (err: unknown) {
      expect(err).toBeInstanceOf(CloudflareApiError);
      expect(err.message).toContain('Bad request details');
      // Token must NEVER be present in the error string
      expect(err.message).not.toContain(MOCK_TOKEN);
    }
  });

  describe('verifyCottageZone Security Guard', () => {
    it('accepts cottage.dpdns.org and returns zone info', async () => {
      const mockFetch = createMockFetch(() => ({
        json: {
          success: true,
          result: {
            id: MOCK_ZONE_ID,
            name: 'cottage.dpdns.org',
            status: 'active',
            account: { id: MOCK_ACCOUNT_ID, name: 'Personal' },
          },
        },
      }));

      const client = new CloudflareClient({
        apiToken: MOCK_TOKEN,
        zoneId: MOCK_ZONE_ID,
        accountId: MOCK_ACCOUNT_ID,
        fetchFn: mockFetch,
      });

      const res = await client.verifyCottageZone();
      expect(res.zoneName).toBe('cottage.dpdns.org');
      expect(res.zoneId).toBe(MOCK_ZONE_ID);
      expect(res.accountId).toBe(MOCK_ACCOUNT_ID);
    });

    it('strictly refuses and blocks when zone is roiding.dpdns.org', async () => {
      const mockFetch = createMockFetch(() => ({
        json: {
          success: true,
          result: {
            id: MOCK_ZONE_ID,
            name: 'roiding.dpdns.org',
            status: 'active',
          },
        },
      }));

      const client = new CloudflareClient({
        apiToken: MOCK_TOKEN,
        zoneId: MOCK_ZONE_ID,
        accountId: MOCK_ACCOUNT_ID,
        fetchFn: mockFetch,
      });

      await expect(client.verifyCottageZone()).rejects.toThrowError(
        /\[SECURITY_REFUSAL\].*strictly forbidden/,
      );
    });

    it('refuses when zone name is an unexpected domain', async () => {
      const mockFetch = createMockFetch(() => ({
        json: {
          success: true,
          result: {
            id: MOCK_ZONE_ID,
            name: 'other-domain.com',
            status: 'active',
          },
        },
      }));

      const client = new CloudflareClient({
        apiToken: MOCK_TOKEN,
        zoneId: MOCK_ZONE_ID,
        accountId: MOCK_ACCOUNT_ID,
        fetchFn: mockFetch,
      });

      await expect(client.verifyCottageZone()).rejects.toThrowError(/\[SECURITY_REFUSAL\]/);
    });
  });

  describe('Email Routing API Endpoints', () => {
    it('updates catch-all rule with official PUT schema', async () => {
      let capturedBody: {
        actions?: Array<{ type: string; value: string[] }>;
        matchers?: unknown[];
      } = {};
      let capturedMethod = '';

      const mockFetch = createMockFetch((url, opts) => {
        capturedMethod = opts.method || 'GET';
        capturedBody = JSON.parse(opts.body as string);
        return {
          json: {
            success: true,
            result: {
              id: 'catch-all-rule-id',
              enabled: true,
              actions: capturedBody.actions,
              matchers: capturedBody.matchers,
            },
          },
        };
      });

      const client = new CloudflareClient({
        apiToken: MOCK_TOKEN,
        zoneId: MOCK_ZONE_ID,
        fetchFn: mockFetch,
      });

      const payload = {
        actions: [{ type: 'worker', value: ['easytmp-mail-inbound'] }],
        matchers: [{ type: 'all' }],
        enabled: true,
        name: 'Catch-all to easytmp-mail-inbound',
        source: 'api',
      };

      const result = await client.updateEmailRoutingCatchAllRule(payload);

      expect(capturedMethod).toBe('PUT');
      expect(capturedBody.actions[0].type).toBe('worker');
      expect(capturedBody.actions[0].value).toEqual(['easytmp-mail-inbound']);
      expect(result.id).toBe('catch-all-rule-id');
    });

    it('handles email routing DNS operations (get, enable, unlock, disable)', async () => {
      const calledPaths: string[] = [];
      const mockFetch = createMockFetch((url, opts) => {
        calledPaths.push(
          `${opts.method || 'GET'} ${url.replace('https://api.cloudflare.com/client/v4', '')}`,
        );
        return { json: { success: true, result: { status: 'ok' } } };
      });

      const client = new CloudflareClient({
        apiToken: MOCK_TOKEN,
        zoneId: MOCK_ZONE_ID,
        fetchFn: mockFetch,
      });

      await client.getEmailRoutingDnsSettings();
      await client.enableEmailRoutingDns();
      await client.unlockEmailRoutingDns();
      await client.disableEmailRoutingDns();

      expect(calledPaths).toContain(`GET /zones/${MOCK_ZONE_ID}/email/routing/dns`);
      expect(calledPaths).toContain(`POST /zones/${MOCK_ZONE_ID}/email/routing/dns`);
      expect(calledPaths).toContain(`PATCH /zones/${MOCK_ZONE_ID}/email/routing/dns`);
      expect(calledPaths).toContain(`DELETE /zones/${MOCK_ZONE_ID}/email/routing/dns`);
    });
  });

  describe('Pages Custom Domain API', () => {
    it('lists and adds custom domain for project', async () => {
      let createdDomain: { name?: string } | null = null;
      const mockFetch = createMockFetch((url, opts) => {
        if (opts.method === 'POST') {
          createdDomain = JSON.parse(opts.body as string);
          return {
            json: {
              success: true,
              result: { id: 'domain-id-1', name: createdDomain.name, status: 'active' },
            },
          };
        }
        return {
          json: {
            success: true,
            result: [{ id: 'domain-id-0', name: 'old.cottage.dpdns.org', status: 'active' }],
          },
        };
      });

      const client = new CloudflareClient({
        apiToken: MOCK_TOKEN,
        accountId: MOCK_ACCOUNT_ID,
        fetchFn: mockFetch,
      });

      const list = await client.listPagesDomains('easytmp-mail');
      expect(list).toHaveLength(1);

      const added = await client.addPagesDomain('easytmp-mail', 'inbox.cottage.dpdns.org');
      expect(createdDomain).toEqual({ name: 'inbox.cottage.dpdns.org' });
      expect(added.name).toBe('inbox.cottage.dpdns.org');
    });
  });

  describe('Worker Scripts API', () => {
    it('checks the Worker script list instead of parsing script content as JSON', async () => {
      const mockFetch = createMockFetch((url, opts) => {
        if (opts.method === 'DELETE') {
          return { json: { success: true, result: null } };
        }
        return {
          json: {
            success: true,
            result: [{ id: 'existing-worker', modified_on: '2026-11-01' }],
          },
        };
      });

      const client = new CloudflareClient({
        apiToken: MOCK_TOKEN,
        accountId: MOCK_ACCOUNT_ID,
        fetchFn: mockFetch,
      });

      const existing = await client.getWorkerScript('existing-worker');
      expect(existing?.id).toBe('existing-worker');

      const missing = await client.getWorkerScript('missing-worker');
      expect(missing).toBeNull();

      await expect(client.deleteWorkerScript('old-worker')).resolves.toBeNull();
    });
  });
});
