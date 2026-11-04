import { describe, expect, it } from 'vitest';
import app from '../functions/api/[[route]].js';

describe('API Health and Random Address Endpoints', () => {
  it('responds with 200 and HealthResponse on GET /api/health', async () => {
    const res = await app.request('/api/health');
    expect(res.status).toBe(200);

    const json = (await res.json()) as Record<string, unknown>;
    expect(json.status).toBe('ok');
    expect(json.service).toBe('easytmp-mail');
    expect(json.apiVersion).toBe('1');
    expect(typeof json.serverTime).toBe('number');

    expect(res.headers.get('Cache-Control')).toBe('no-store');
    expect(res.headers.get('Access-Control-Allow-Origin')).toBe('*');
    expect(res.headers.get('Access-Control-Expose-Headers')).toContain('X-Request-Id');
    expect(res.headers.get('X-Request-Id')).toBeDefined();
    expect(res.headers.get('X-Content-Type-Options')).toBe('nosniff');
    expect(res.headers.get('Content-Type')).toContain('application/json');
  });

  it('responds with 400 invalid_query if query parameters are passed to health', async () => {
    const res = await app.request('/api/health?test=1');
    expect(res.status).toBe(400);

    const json = (await res.json()) as Record<string, unknown>;
    expect(json.error).toBe('invalid_query');
    expect(json.message).toBe('Query parameters are not allowed for this endpoint');
    expect(json.requestId).toBe(res.headers.get('X-Request-Id'));
  });

  it('responds with 200 and RandomAddressResponse on GET /api/v1/addresses/random', async () => {
    const res = await app.request('/api/v1/addresses/random');
    expect(res.status).toBe(200);

    const json = (await res.json()) as Record<string, unknown>;
    expect(typeof json.name).toBe('string');
    expect(json.name).toMatch(/^[a-z0-9]{16}$/);
    expect(json.address).toBe(`${json.name}@cottage.dpdns.org`);
    expect(typeof json.serverTime).toBe('number');

    expect(res.headers.get('Cache-Control')).toBe('no-store');
    expect(res.headers.get('Access-Control-Allow-Origin')).toBe('*');
    expect(res.headers.get('X-Request-Id')).toBeDefined();
  });

  it('respects MAIL_DOMAIN environment variable for random address', async () => {
    const res = await app.request(
      '/api/v1/addresses/random',
      {},
      { MAIL_DOMAIN: 'custom.mail.domain' },
    );
    expect(res.status).toBe(200);

    const json = (await res.json()) as Record<string, unknown>;
    expect(json.address).toBe(`${json.name}@custom.mail.domain`);
  });

  it('exposes the public deployment config without secrets', async () => {
    const res = await app.request(
      '/api/config',
      {},
      {
        MAIL_DOMAIN: 'mail.example.com',
        WEB_HOSTNAME: 'inbox.mail.example.com',
      },
    );
    expect(res.status).toBe(200);
    const json = (await res.json()) as Record<string, unknown>;
    expect(json.mailDomain).toBe('mail.example.com');
    expect(json.webHostname).toBe('inbox.mail.example.com');
    expect(json.retentionSeconds).toBe(604800);
    expect(JSON.stringify(json)).not.toMatch(/token|secret|password/i);
  });

  it('responds with 400 invalid_query if query parameters are passed to random address', async () => {
    const res = await app.request('/api/v1/addresses/random?foo=bar');
    expect(res.status).toBe(400);

    const json = (await res.json()) as Record<string, unknown>;
    expect(json.error).toBe('invalid_query');
    expect(Array.isArray(json.details)).toBe(true);
  });
});
