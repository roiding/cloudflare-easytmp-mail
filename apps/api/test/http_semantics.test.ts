import { describe, expect, it } from 'vitest';
import { createMockD1Database } from '@easytmp/db';
import { MESSAGE_ID_REGEX } from '@easytmp/shared';
import app from '../functions/api/[[route]].js';

describe('HTTP Protocol Semantics & Defensive Checks', () => {
  it('rejects GET requests with non-empty body with 400 unexpected_body', async () => {
    const req = new Request('http://localhost/api/health', {
      method: 'POST',
      body: 'unexpected payload',
    });
    Object.defineProperty(req, 'method', { value: 'GET' });
    const res = await app.fetch(req);
    expect(res.status).toBe(400);

    const json = (await res.json()) as Record<string, unknown>;
    expect(json.error).toBe('unexpected_body');
    expect(json.message).toBe('GET and DELETE requests must not include a request body');
    const details = json.details as Array<{ field: string; message: string }>;
    expect(details[0].field).toBe('body');
  });

  it('rejects DELETE requests with non-empty body with 400 unexpected_body', async () => {
    const db = createMockD1Database();
    const res = await app.request(
      '/api/v1/mailboxes/signup/messages',
      {
        method: 'DELETE',
        body: '{"foo":"bar"}',
      },
      { DB: db },
    );
    expect(res.status).toBe(400);

    const json = (await res.json()) as Record<string, unknown>;
    expect(json.error).toBe('unexpected_body');
  });

  it('rejects requests with body exceeding 8192 bytes with 413 request_too_large', async () => {
    const req = new Request('http://localhost/api/health', {
      method: 'POST',
      body: 'x'.repeat(8193),
    });
    Object.defineProperty(req, 'method', { value: 'GET' });
    const res = await app.fetch(req);
    expect(res.status).toBe(413);

    const json = (await res.json()) as Record<string, unknown>;
    expect(json.error).toBe('request_too_large');
    expect(json.message).toBe('Request body exceeds 8192 bytes');
    expect(json.details).toEqual([]);
    expect(json.requestId).toBe(res.headers.get('X-Request-Id'));
  });

  it('rejects requests when Content-Length header indicates > 8192 bytes with 413', async () => {
    const res = await app.request('/api/health', {
      method: 'GET',
      headers: {
        'content-length': '9000',
      },
    });
    expect(res.status).toBe(413);

    const json = (await res.json()) as Record<string, unknown>;
    expect(json.error).toBe('request_too_large');
  });

  it('detects stream body > 8192 bytes even if Content-Length header is forged or 0', async () => {
    const oversizedStream = new ReadableStream({
      start(controller) {
        controller.enqueue(new Uint8Array(5000));
        controller.enqueue(new Uint8Array(4000)); // Total 9000 bytes > 8192
        controller.close();
      },
    });

    const req = new Request('http://localhost/api/health', {
      method: 'POST',
      body: oversizedStream,
      // @ts-expect-error duplex required for streaming body in fetch
      duplex: 'half',
      headers: {
        'content-length': '0', // Forged header
      },
    });
    Object.defineProperty(req, 'method', { value: 'GET' });
    const res = await app.fetch(req);
    expect(res.status).toBe(413);

    const json = (await res.json()) as Record<string, unknown>;
    expect(json.error).toBe('request_too_large');
  });

  it('rejects unknown query parameters with 400 invalid_query', async () => {
    const db = createMockD1Database();
    const res = await app.request(
      '/api/v1/mailboxes/signup/messages?unknownParam=123',
      {},
      { DB: db },
    );
    expect(res.status).toBe(400);

    const json = (await res.json()) as Record<string, unknown>;
    expect(json.error).toBe('invalid_query');
    const details = json.details as Array<{ field: string; message: string }>;
    expect(details.some((d) => d.field === 'unknownParam')).toBe(true);
  });

  it('rejects duplicate query parameters with 400 invalid_query', async () => {
    const db = createMockD1Database();
    const res = await app.request(
      '/api/v1/mailboxes/signup/messages?since=1000&since=2000',
      {},
      { DB: db },
    );
    expect(res.status).toBe(400);

    const json = (await res.json()) as Record<string, unknown>;
    expect(json.error).toBe('invalid_query');
    const details = json.details as Array<{ field: string; message: string }>;
    expect(details.some((d) => d.field === 'since' && d.message.includes('Duplicate'))).toBe(true);
  });

  it('rejects empty query parameter values with 400 invalid_query', async () => {
    const db = createMockD1Database();
    const res = await app.request('/api/v1/mailboxes/signup/messages?since=', {}, { DB: db });
    expect(res.status).toBe(400);

    const json = (await res.json()) as Record<string, unknown>;
    expect(json.error).toBe('invalid_query');
    const details = json.details as Array<{ field: string; message: string }>;
    expect(details.some((d) => d.field === 'since' && d.message.includes('Empty'))).toBe(true);
  });

  it('rejects invalid percent-encoding in query with 400 invalid_query', async () => {
    const db = createMockD1Database();
    const res = await app.request('/api/v1/mailboxes/signup/messages?subject=%ZZ', {}, { DB: db });
    expect(res.status).toBe(400);

    const json = (await res.json()) as Record<string, unknown>;
    expect(json.error).toBe('invalid_query');
    const details = json.details as Array<{ field: string; message: string }>;
    expect(['query', 'subject']).toContain(details[0].field);
    expect(details[0].message).toContain('invalid percent encoding');
  });

  it('rejects invalid limit values (0, 101, leading zeros, floats) with 400 invalid_query', async () => {
    const db = createMockD1Database();
    const invalidLimits = ['0', '101', '020', '20.5', '-10', 'abc'];

    for (const lim of invalidLimits) {
      const res = await app.request(
        `/api/v1/mailboxes/signup/messages?limit=${lim}`,
        {},
        { DB: db },
      );
      expect(res.status).toBe(400);

      const json = (await res.json()) as Record<string, unknown>;
      expect(json.error).toBe('invalid_query');
      const details = json.details as Array<{ field: string }>;
      expect(details[0].field).toBe('limit');
    }
  });

  it('responds with 204 and contract headers for OPTIONS requests', async () => {
    const endpoints = [
      { path: '/api/health', expectedMethods: 'GET, OPTIONS' },
      { path: '/api/v1/addresses/random', expectedMethods: 'GET, OPTIONS' },
      { path: '/api/v1/mailboxes/signup/messages', expectedMethods: 'GET, DELETE, OPTIONS' },
      {
        path: '/api/v1/messages/8c746a0e-7f90-4b13-a71c-9db724e57c01',
        expectedMethods: 'GET, DELETE, OPTIONS',
      },
      { path: '/api/unknown', expectedMethods: 'GET, DELETE, OPTIONS' },
    ];

    for (const { path, expectedMethods } of endpoints) {
      const res = await app.request(path, { method: 'OPTIONS' });
      expect(res.status).toBe(204);
      expect(await res.text()).toBe('');

      expect(res.headers.get('Cache-Control')).toBe('no-store');
      expect(res.headers.get('Access-Control-Allow-Origin')).toBe('*');
      expect(res.headers.get('Access-Control-Allow-Methods')).toBe(expectedMethods);
      expect(res.headers.get('Access-Control-Allow-Headers')).toBe('Content-Type');
      expect(res.headers.get('X-Request-Id')).toBeDefined();
      expect(res.headers.get('X-Content-Type-Options')).toBe('nosniff');
    }
  });

  it('returns 405 method_not_allowed with correct Allow header for unsupported methods on known routes', async () => {
    const tests = [
      { path: '/api/health', method: 'POST', allow: 'GET, OPTIONS' },
      { path: '/api/health', method: 'DELETE', allow: 'GET, OPTIONS' },
      { path: '/api/v1/addresses/random', method: 'POST', allow: 'GET, OPTIONS' },
      { path: '/api/v1/addresses/random', method: 'PUT', allow: 'GET, OPTIONS' },
      { path: '/api/v1/mailboxes/signup/messages', method: 'POST', allow: 'GET, DELETE, OPTIONS' },
      { path: '/api/v1/mailboxes/signup/messages', method: 'PUT', allow: 'GET, DELETE, OPTIONS' },
      {
        path: '/api/v1/messages/8c746a0e-7f90-4b13-a71c-9db724e57c01',
        method: 'POST',
        allow: 'GET, DELETE, OPTIONS',
      },
      {
        path: '/api/v1/messages/8c746a0e-7f90-4b13-a71c-9db724e57c01',
        method: 'PATCH',
        allow: 'GET, DELETE, OPTIONS',
      },
    ];

    for (const { path, method, allow } of tests) {
      const res = await app.request(path, { method });
      expect(res.status).toBe(405);
      expect(res.headers.get('Allow')).toBe(allow);

      const json = (await res.json()) as Record<string, unknown>;
      expect(json.error).toBe('method_not_allowed');
      expect(json.message).toBe('Method not allowed');
      expect(json.details).toEqual([]);
      expect(json.requestId).toBe(res.headers.get('X-Request-Id'));
    }
  });

  it('returns JSON 404 route_not_found for any unknown API route (never returns HTML SPA)', async () => {
    const unknownPaths = [
      '/api/unknown',
      '/api/v1',
      '/api/v1/mailboxes',
      '/api/v1/messages',
      '/api/v1/not-found-endpoint',
    ];

    for (const path of unknownPaths) {
      const res = await app.request(path);
      expect(res.status).toBe(404);
      expect(res.headers.get('Content-Type')).toContain('application/json');

      const json = (await res.json()) as Record<string, unknown>;
      expect(json.error).toBe('route_not_found');
      expect(json.requestId).toBe(res.headers.get('X-Request-Id'));
    }
  });

  it('never sends a response body for HEAD requests while preserving status and headers', async () => {
    const db = createMockD1Database();

    // 1. HEAD /api/health -> 200
    const res1 = await app.request('/api/health', { method: 'HEAD' });
    expect(res1.status).toBe(200);
    expect(res1.headers.get('Content-Type')).toContain('application/json');
    expect(res1.headers.get('X-Request-Id')).toBeDefined();
    expect(await res1.text()).toBe('');

    // 2. HEAD on invalid query -> 400, no body
    const res2 = await app.request('/api/health?foo=bar', { method: 'HEAD' });
    expect(res2.status).toBe(400);
    expect(res2.headers.get('Content-Type')).toContain('application/json');
    expect(await res2.text()).toBe('');

    // 3. HEAD on unknown route -> 404, no body
    const res3 = await app.request('/api/unknown', { method: 'HEAD' });
    expect(res3.status).toBe(404);
    expect(await res3.text()).toBe('');

    // 4. HEAD on mailbox messages -> 200, no body
    const res4 = await app.request(
      '/api/v1/mailboxes/signup/messages',
      { method: 'HEAD' },
      { DB: db },
    );
    expect(res4.status).toBe(200);
    expect(await res4.text()).toBe('');
  });

  it('ensures consistent standard headers on all responses and requestId match on errors', async () => {
    // 1. Success response headers
    const res = await app.request('/api/health');
    expect(res.headers.get('Cache-Control')).toBe('no-store');
    expect(res.headers.get('Access-Control-Allow-Origin')).toBe('*');
    expect(res.headers.get('Access-Control-Expose-Headers')).toContain('Retry-After');
    expect(res.headers.get('Access-Control-Expose-Headers')).toContain('X-Request-Id');
    expect(res.headers.get('X-Content-Type-Options')).toBe('nosniff');
    const headerReqId = res.headers.get('X-Request-Id');
    expect(headerReqId).toBeDefined();
    expect(MESSAGE_ID_REGEX.test(headerReqId!)).toBe(true);

    // 2. Error response: body.requestId strictly matches X-Request-Id header
    const errRes = await app.request('/api/health?invalid=1');
    expect(errRes.status).toBe(400);
    const errJson = (await errRes.json()) as Record<string, unknown>;
    expect(errRes.headers.get('X-Request-Id')).toBe(errJson.requestId);
  });

  it('caps error details to a maximum of 10 items', async () => {
    const db = createMockD1Database();
    // Pass 15 unknown query parameters
    const params = Array.from({ length: 15 }, (_, i) => `badParam${i}=val${i}`).join('&');
    const res = await app.request(`/api/v1/mailboxes/signup/messages?${params}`, {}, { DB: db });
    expect(res.status).toBe(400);

    const json = (await res.json()) as Record<string, unknown>;
    const details = json.details as unknown[];
    expect(details.length).toBeLessThanOrEqual(10);
  });

  it('returns 503 service_unavailable with Retry-After when DB binding is missing', async () => {
    // Calling database-dependent endpoints without providing DB binding in env
    const endpoints = [
      { path: '/api/v1/mailboxes/signup/messages', method: 'GET' },
      { path: '/api/v1/mailboxes/signup/messages', method: 'DELETE' },
      { path: '/api/v1/messages/8c746a0e-7f90-4b13-a71c-9db724e57c01', method: 'GET' },
      { path: '/api/v1/messages/8c746a0e-7f90-4b13-a71c-9db724e57c01', method: 'DELETE' },
    ];

    for (const { path, method } of endpoints) {
      const res = await app.request(path, { method });
      expect(res.status).toBe(503);
      expect(res.headers.get('Retry-After')).toBe('3');

      const json = (await res.json()) as Record<string, unknown>;
      expect(json.error).toBe('service_unavailable');
      expect(json.message).toContain('unavailable');
    }
  });
});
