import { describe, expect, it } from 'vitest';
import { createMockD1Database, MessageRepository, NewMessageInput } from '@easytmp/db';
import app from '../functions/api/[[route]].js';

const ttl = 604800000;

function createSampleMessage(
  id: string,
  options: {
    htmlBody?: string | null;
    htmlStatus?: 'available' | 'not_present' | 'too_large' | 'unavailable';
    expiresAt?: number;
  } = {},
): NewMessageInput {
  const now = Date.now();
  const expiresAt = options.expiresAt ?? now + ttl;
  const receivedAt = options.expiresAt !== undefined ? options.expiresAt - ttl : now;
  return {
    id,
    address: 'signup@cottage.dpdns.org',
    envelopeFrom: 'bounce@example.com',
    from: {
      name: 'Example Team',
      address: 'no-reply@example.com',
      domain: 'example.com',
    },
    subject: 'Verification Code: 987654',
    textBody: 'Your verification code is 987654.',
    textTruncated: false,
    htmlBody:
      options.htmlBody !== undefined ? options.htmlBody : '<p>Code: <strong>987654</strong></p>',
    htmlStatus: options.htmlStatus ?? 'available',
    codeCandidates: [{ value: '987654', source: 'subject', context: 'Verification Code: 987654' }],
    links: [
      { url: 'https://example.com/verify?code=987654', text: 'Verify Email', host: 'example.com' },
    ],
    dmarcPass: true,
    sizeBytes: 2048,
    receivedAt,
    expiresAt,
  };
}

describe('Single Message API (/api/v1/messages/{id})', () => {
  it('returns 200 and MessageDetail with HTML and links for available HTML message', async () => {
    const db = createMockD1Database();
    const repo = new MessageRepository(db);

    const id = '8c746a0e-7f90-4b13-a71c-9db724e57c01';
    await repo.insertMessage(createSampleMessage(id));

    const res = await app.request(`/api/v1/messages/${id}`, {}, { DB: db });
    expect(res.status).toBe(200);

    const json = (await res.json()) as Record<string, unknown>;
    const message = json.message as Record<string, unknown>;
    expect(message.id).toBe(id);
    expect(message.address).toBe('signup@cottage.dpdns.org');
    expect(message.hasHtml).toBe(true);
    expect(message.htmlStatus).toBe('available');
    expect(typeof message.htmlBody).toBe('string');
    expect(message.envelopeFrom).toBe('bounce@example.com');
    expect(message.textBody).toBe('Your verification code is 987654.');
    expect(message.textTruncated).toBe(false);
    expect(message.sizeBytes).toBe(2048);
    expect((message.links as unknown[]).length).toBe(1);
    expect((message.codeCandidates as unknown[]).length).toBe(1);
    expect(typeof json.serverTime).toBe('number');
  });

  it('returns MessageDetail with null htmlBody for plain text messages (not_present)', async () => {
    const db = createMockD1Database();
    const repo = new MessageRepository(db);

    const id = '8c746a0e-7f90-4b13-a71c-9db724e57c02';
    await repo.insertMessage(
      createSampleMessage(id, { htmlBody: null, htmlStatus: 'not_present' }),
    );

    const res = await app.request(`/api/v1/messages/${id}`, {}, { DB: db });
    expect(res.status).toBe(200);

    const json = (await res.json()) as Record<string, unknown>;
    const message = json.message as Record<string, unknown>;
    expect(message.hasHtml).toBe(false);
    expect(message.htmlStatus).toBe('not_present');
    expect(message.htmlBody).toBeNull();
  });

  it('returns MessageDetail with null htmlBody when HTML is too_large', async () => {
    const db = createMockD1Database();
    const repo = new MessageRepository(db);

    const id = '8c746a0e-7f90-4b13-a71c-9db724e57c03';
    await repo.insertMessage(createSampleMessage(id, { htmlBody: null, htmlStatus: 'too_large' }));

    const res = await app.request(`/api/v1/messages/${id}`, {}, { DB: db });
    expect(res.status).toBe(200);

    const json = (await res.json()) as Record<string, unknown>;
    const message = json.message as Record<string, unknown>;
    expect(message.hasHtml).toBe(false);
    expect(message.htmlStatus).toBe('too_large');
    expect(message.htmlBody).toBeNull();
  });

  it('returns 404 message_not_found for nonexistent message ID', async () => {
    const db = createMockD1Database();
    const nonExistentId = '00000000-0000-4000-8000-000000000000';

    const res = await app.request(`/api/v1/messages/${nonExistentId}`, {}, { DB: db });
    expect(res.status).toBe(404);

    const json = (await res.json()) as Record<string, unknown>;
    expect(json.error).toBe('message_not_found');
    expect(json.message).toBe('Message not found');
    expect(json.details).toEqual([]);
    expect(json.requestId).toBe(res.headers.get('X-Request-Id'));
  });

  it('immediately returns 404 message_not_found for expired messages', async () => {
    const db = createMockD1Database();
    const repo = new MessageRepository(db);

    const id = '8c746a0e-7f90-4b13-a71c-9db724e57c04';
    // Expired message relative to now
    await repo.insertMessage(createSampleMessage(id, { expiresAt: Date.now() - 100 }));

    const res = await app.request(`/api/v1/messages/${id}`, {}, { DB: db });
    expect(res.status).toBe(404);

    const json = (await res.json()) as Record<string, unknown>;
    expect(json.error).toBe('message_not_found');
  });

  it('rejects invalid UUID formats (uppercase, wrong version, malformed) with 400 invalid_message_id', async () => {
    const db = createMockD1Database();

    const badIds = [
      '8C746A0E-7F90-4B13-A71C-9DB724E57C01', // Uppercase letters
      'not-a-uuid',
      '8c746a0e-7f90-1b13-a71c-9db724e57c01', // UUID v1, not v4
      '8c746a0e-7f90-4b13-771c-9db724e57c01', // Variant not [89ab]
      '12345',
    ];

    for (const badId of badIds) {
      const getRes = await app.request(`/api/v1/messages/${badId}`, {}, { DB: db });
      expect(getRes.status).toBe(400);
      const getJson = (await getRes.json()) as Record<string, unknown>;
      expect(getJson.error).toBe('invalid_message_id');

      const delRes = await app.request(
        `/api/v1/messages/${badId}`,
        { method: 'DELETE' },
        { DB: db },
      );
      expect(delRes.status).toBe(400);
      const delJson = (await delRes.json()) as Record<string, unknown>;
      expect(delJson.error).toBe('invalid_message_id');
    }
  });

  it('rejects query parameters on GET /api/v1/messages/{id} with 400 invalid_query', async () => {
    const db = createMockD1Database();
    const id = '8c746a0e-7f90-4b13-a71c-9db724e57c01';

    const res = await app.request(`/api/v1/messages/${id}?foo=bar`, {}, { DB: db });
    expect(res.status).toBe(400);

    const json = (await res.json()) as Record<string, unknown>;
    expect(json.error).toBe('invalid_query');
  });

  it('idempotently deletes a single message returning 200 with deleted boolean', async () => {
    const db = createMockD1Database();
    const repo = new MessageRepository(db);

    const id = '8c746a0e-7f90-4b13-a71c-9db724e57c05';
    await repo.insertMessage(createSampleMessage(id));

    // First delete: deleted is true
    const res1 = await app.request(`/api/v1/messages/${id}`, { method: 'DELETE' }, { DB: db });
    expect(res1.status).toBe(200);
    const json1 = (await res1.json()) as Record<string, unknown>;
    expect(json1.id).toBe(id);
    expect(json1.deleted).toBe(true);

    // Second delete (idempotent): deleted is false, still 200 (never 404!)
    const res2 = await app.request(`/api/v1/messages/${id}`, { method: 'DELETE' }, { DB: db });
    expect(res2.status).toBe(200);
    const json2 = (await res2.json()) as Record<string, unknown>;
    expect(json2.id).toBe(id);
    expect(json2.deleted).toBe(false);

    // Deleting nonexistent ID: deleted is false, still 200
    const nonExistentId = '00000000-0000-4000-8000-000000000000';
    const res3 = await app.request(
      `/api/v1/messages/${nonExistentId}`,
      { method: 'DELETE' },
      { DB: db },
    );
    expect(res3.status).toBe(200);
    const json3 = (await res3.json()) as Record<string, unknown>;
    expect(json3.id).toBe(nonExistentId);
    expect(json3.deleted).toBe(false);
  });

  it('deleting an expired message returns 200 with deleted: false', async () => {
    const db = createMockD1Database();
    const repo = new MessageRepository(db);

    const id = '8c746a0e-7f90-4b13-a71c-9db724e57c06';
    await repo.insertMessage(createSampleMessage(id, { expiresAt: Date.now() - 100 }));

    const res = await app.request(`/api/v1/messages/${id}`, { method: 'DELETE' }, { DB: db });
    expect(res.status).toBe(200);

    const json = (await res.json()) as Record<string, unknown>;
    expect(json.deleted).toBe(false);
  });

  it('rejects query parameters on DELETE /api/v1/messages/{id} with 400 invalid_query', async () => {
    const db = createMockD1Database();
    const id = '8c746a0e-7f90-4b13-a71c-9db724e57c01';

    const res = await app.request(
      `/api/v1/messages/${id}?test=1`,
      { method: 'DELETE' },
      { DB: db },
    );
    expect(res.status).toBe(400);

    const json = (await res.json()) as Record<string, unknown>;
    expect(json.error).toBe('invalid_query');
  });
});
