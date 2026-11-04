import { describe, it, expect, vi } from 'vitest';
import { cleanupOldService } from '../cleanup-old-service.js';
import { CloudflareClient } from '../lib/cloudflare-client.js';

const MOCK_ZONE_ID = '0123456789abcdef0123456789abcdef';
const MOCK_ACCOUNT_ID = 'fedcba9876543210fedcba9876543210';
const MOCK_TOKEN = 'mock-api-token-test-1234567890ab';

function createMockFetch(overrides: Record<string, unknown> = {}) {
  return vi.fn().mockImplementation(async (url: string, opts: RequestInit) => {
    const path = url.replace('https://api.cloudflare.com/client/v4', '');
    const _method = opts.method || 'GET';

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

    if (
      path === `/zones/${MOCK_ZONE_ID}/dns_records` ||
      path.startsWith(`/zones/${MOCK_ZONE_ID}/dns_records?`)
    ) {
      return {
        status: 200,
        ok: true,
        json: async () => ({
          success: true,
          result: overrides.dnsRecords ?? [
            {
              id: 'mx-1',
              type: 'MX',
              name: 'cottage.dpdns.org',
              content: 'route1.mx.cloudflare.net',
              priority: 10,
              locked: true,
            },
            {
              id: 'mx-2',
              type: 'MX',
              name: 'cottage.dpdns.org',
              content: 'custom.old-mx.net',
              priority: 20,
              locked: false,
            },
            {
              id: 'txt-1',
              type: 'TXT',
              name: 'cottage.dpdns.org',
              content: 'v=spf1 include:_spf.mx.cloudflare.net ~all',
              locked: false,
            },
          ],
        }),
      };
    }

    if (path === `/zones/${MOCK_ZONE_ID}/email/routing`) {
      return {
        status: 200,
        ok: true,
        json: async () => ({ success: true, result: { enabled: true, status: 'ready' } }),
      };
    }

    if (path === `/zones/${MOCK_ZONE_ID}/email/routing/rules/catch_all`) {
      return {
        status: 200,
        ok: true,
        json: async () => ({
          success: true,
          result: overrides.catchAllRule ?? {
            id: 'rule-old',
            enabled: true,
            actions: [{ type: 'worker', value: ['legacy-temp-mail-worker'] }],
          },
        }),
      };
    }

    if (path === `/zones/${MOCK_ZONE_ID}/email/routing/rules`) {
      return {
        status: 200,
        ok: true,
        json: async () => ({ success: true, result: [] }),
      };
    }

    if (path === `/zones/${MOCK_ZONE_ID}/email/routing/dns`) {
      return {
        status: 200,
        ok: true,
        json: async () => ({ success: true, result: { status: 'unlocked' } }),
      };
    }

    if (path === `/accounts/${MOCK_ACCOUNT_ID}/workers/scripts`) {
      const scripts = [
        'easytmp-mail-inbound',
        'legacy-temp-mail-worker',
        'email-code-worker',
      ].filter((script) => !overrides.missingWorkers?.includes(script));
      return {
        status: 200,
        ok: true,
        json: async () => ({
          success: true,
          result: scripts.map((id) => ({ id, modified_on: '2026-11-01' })),
        }),
      };
    }

    if (path.startsWith(`/zones/${MOCK_ZONE_ID}/dns_records/`)) {
      return {
        status: 200,
        ok: true,
        json: async () => ({ success: true, result: { id: 'deleted' } }),
      };
    }

    return { status: 200, ok: true, json: async () => ({ success: true, result: {} }) };
  });
}

describe('cleanupOldService Migration and Decommissioning Script', () => {
  it('generates reviewable inventory and preflight backup without making deletions in dry-run', async () => {
    const mockFetch = createMockFetch();
    const client = new CloudflareClient({
      apiToken: MOCK_TOKEN,
      zoneId: MOCK_ZONE_ID,
      accountId: MOCK_ACCOUNT_ID,
      fetchFn: mockFetch,
    });

    const res = await cleanupOldService({ client, apply: false, stage: 'preflight' });
    expect(res.applied).toBe(false);
    expect(res.dryRun).toBe(true);
    expect(res.inventory.oldWorkerName).toBe('legacy-temp-mail-worker');
    expect(res.inventory.mxRecords).toHaveLength(2);
    expect(res.backup.filepath).toContain('cleanup-inventory-dryrun-');

    // Assert that DELETE or PATCH was NEVER called
    const mutatingCalls = mockFetch.mock.calls.filter(
      (c) => c[1]?.method === 'DELETE' || c[1]?.method === 'PATCH' || c[1]?.method === 'POST',
    );
    expect(mutatingCalls).toHaveLength(0);
  });

  it('blocks execution when old worker cannot be safely identified', async () => {
    const mockFetch = createMockFetch({
      catchAllRule: {
        id: 'no-worker-rule',
        enabled: true,
        actions: [{ type: 'drop' }],
      },
    });

    const client = new CloudflareClient({
      apiToken: MOCK_TOKEN,
      zoneId: MOCK_ZONE_ID,
      accountId: MOCK_ACCOUNT_ID,
      fetchFn: mockFetch,
    });

    await expect(cleanupOldService({ client, apply: false })).rejects.toThrowError(
      /\[SAFETY_BLOCK\] Cannot safely identify old Worker script to remove/,
    );
  });

  it('strictly refuses to delete when identified worker is the new service worker', async () => {
    const mockFetch = createMockFetch({
      catchAllRule: {
        id: 'new-worker-rule',
        enabled: true,
        actions: [{ type: 'worker', value: ['easytmp-mail-inbound'] }],
      },
    });

    const client = new CloudflareClient({
      apiToken: MOCK_TOKEN,
      zoneId: MOCK_ZONE_ID,
      accountId: MOCK_ACCOUNT_ID,
      fetchFn: mockFetch,
    });

    await expect(
      cleanupOldService({ client, apply: false, oldWorkerName: 'easytmp-mail-inbound' }),
    ).rejects.toThrowError(/\[SECURITY_REFUSAL\].*matches the new service Worker name/);
  });

  it('preserves shared MX/SPF infrastructure and deletes only the old worker after switch', async () => {
    const mockFetch = createMockFetch({
      catchAllRule: {
        id: 'rule-new',
        enabled: true,
        actions: [{ type: 'worker', value: ['easytmp-mail-inbound'] }],
      },
    });
    const client = new CloudflareClient({
      apiToken: MOCK_TOKEN,
      zoneId: MOCK_ZONE_ID,
      accountId: MOCK_ACCOUNT_ID,
      fetchFn: mockFetch,
    });

    const res = await cleanupOldService({
      client,
      apply: true,
      stage: 'cleanup',
      oldWorkerName: 'legacy-temp-mail-worker',
    });
    expect(res.applied).toBe(true);
    expect(res.dryRun).toBe(false);
    expect(res.auditLog).toContain('Preserved 2 MX and 1 SPF record(s)');
    expect(res.auditLog).toContain(
      'Deleted Worker script "legacy-temp-mail-worker" (D1, KV, and R2 databases remain intact)',
    );

    const dnsMutationCalls = mockFetch.mock.calls.filter(
      (c) =>
        c[0].includes('/email/routing/dns') &&
        ['DELETE', 'PATCH', 'POST'].includes(c[1]?.method || ''),
    );
    expect(dnsMutationCalls).toHaveLength(0);

    const deleteWorkerCall = mockFetch.mock.calls.find(
      (c) => c[0].includes('/workers/scripts/legacy-temp-mail-worker') && c[1]?.method === 'DELETE',
    );
    expect(deleteWorkerCall).toBeDefined();
  });

  it('blocks cleanup while the old worker is still the active catch-all destination', async () => {
    const mockFetch = createMockFetch();
    const client = new CloudflareClient({
      apiToken: MOCK_TOKEN,
      zoneId: MOCK_ZONE_ID,
      accountId: MOCK_ACCOUNT_ID,
      fetchFn: mockFetch,
    });

    await expect(cleanupOldService({ client, apply: true, stage: 'cleanup' })).rejects.toThrowError(
      /\[SAFETY_BLOCK\].*does not target the new Worker/,
    );

    const mutatingCalls = mockFetch.mock.calls.filter(
      (c) => c[1]?.method === 'DELETE' || c[1]?.method === 'PATCH' || c[1]?.method === 'POST',
    );
    expect(mutatingCalls).toHaveLength(0);
  });
});
