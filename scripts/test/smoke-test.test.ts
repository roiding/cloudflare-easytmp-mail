import { describe, it, expect, vi } from 'vitest';
import { runSmokeTests } from '../smoke-test.js';

function createMockFetch(overrides: Record<string, unknown> = {}) {
  return vi.fn().mockImplementation(async (url: string) => {
    const path = new URL(url).pathname;

    if (path === '/') {
      return {
        status: overrides.rootStatus ?? 200,
        headers: new Headers({
          'content-type': 'text/html; charset=utf-8',
          'content-security-policy': "default-src 'self'; frame-src 'self' about:;",
          'x-content-type-options': 'nosniff',
        }),
        text: async () => '<!DOCTYPE html><html><body><div id="root"></div></body></html>',
      };
    }

    if (path === '/api/health') {
      return {
        status: overrides.healthStatus ?? 200,
        headers: new Headers({
          'content-type': 'application/json',
          'cache-control': 'no-store',
        }),
        json: async () => ({
          status: 'ok',
          service: 'easytmp-mail',
          apiVersion: '1',
          serverTime: 1700000000000,
        }),
      };
    }

    if (path === '/api/config') {
      return {
        status: overrides.configStatus ?? 200,
        headers: new Headers({ 'content-type': 'application/json' }),
        json: async () => ({
          mailDomain: 'cottage.dpdns.org',
          webHostname: 'inbox.cottage.dpdns.org',
          retentionSeconds: 604800,
          addressPolicy: {
            minLength: 1,
            maxLength: 64,
            allowedCharacters: 'letters, digits, dot, underscore, hyphen',
          },
        }),
      };
    }

    if (path === '/api/v1/addresses/random') {
      return {
        status: overrides.randomStatus ?? 200,
        headers: new Headers({ 'content-type': 'application/json' }),
        json: async () => ({
          address: 'abcdef1234567890@cottage.dpdns.org',
          name: 'abcdef1234567890',
          serverTime: 1700000000000,
        }),
      };
    }

    if (path.startsWith('/api/v1/mailboxes/')) {
      return {
        status: overrides.mailboxStatus ?? 200,
        headers: new Headers({ 'content-type': 'application/json' }),
        json: async () => ({
          mailbox: 'abcdef1234567890@cottage.dpdns.org',
          messages: [],
          pagination: { limit: 20, nextCursor: null },
          serverTime: 1700000000000,
        }),
      };
    }

    return { status: 404, text: async () => 'Not found', json: async () => ({}) };
  });
}

describe('Smoke Test Suite', () => {
  it('passes all tests when endpoints return valid responses and security headers', async () => {
    const mockFetch = createMockFetch();
    const results = await runSmokeTests({
      baseUrl: 'https://inbox.cottage.dpdns.org',
      expectedMailDomain: 'cottage.dpdns.org',
      fetchFn: mockFetch as unknown as typeof fetch,
    });

    expect(results.passed).toBe(true);
    expect(results.tests).toHaveLength(5);
    expect(results.tests.every((t) => t.ok)).toBe(true);
  });

  it('detects failure when security headers are missing on static assets', async () => {
    const mockFetch = vi.fn().mockImplementation(async (url: string) => {
      const path = new URL(url).pathname;
      if (path === '/') {
        return {
          status: 200,
          headers: new Headers({ 'content-type': 'text/html' }), // missing CSP and nosniff
          text: async () => '<html></html>',
        };
      }
      return {
        status: 200,
        headers: new Headers({ 'cache-control': 'no-store' }),
        json: async () => ({
          status: 'ok',
          service: 'easytmp-mail',
          apiVersion: '1',
          serverTime: 123,
        }),
      };
    });

    const results = await runSmokeTests({
      baseUrl: 'https://inbox.cottage.dpdns.org',
      expectedMailDomain: 'cottage.dpdns.org',
      fetchFn: mockFetch as unknown as typeof fetch,
    });

    expect(results.passed).toBe(false);
    const rootTest = results.tests.find((t) => t.name.includes('Static Asset'));
    expect(rootTest?.ok).toBe(false);
  });
});
