import { describe, expect, it } from 'vitest';
import { createMockD1Database, MessageRepository, NewMessageInput } from '@easytmp/db';
import { encodeCursor } from '@easytmp/shared';
import app from '../functions/api/[[route]].js';

const ttl = 604800000; // 7 days

function createSampleMessage(
  id: string,
  receivedAt: number,
  options: {
    address?: string;
    subject?: string;
    fromDomain?: string;
    dmarcPass?: boolean;
    expiresAt?: number;
  } = {},
): NewMessageInput {
  return {
    id,
    address: options.address ?? 'signup@cottage.dpdns.org',
    envelopeFrom: 'bounce@example.com',
    from: {
      name: 'Sender',
      address: options.fromDomain ? `info@${options.fromDomain}` : 'info@example.com',
      domain: options.fromDomain ?? 'example.com',
    },
    subject: options.subject ?? 'Your code is 123456',
    textBody: 'Your code is 123456, valid for 5 mins.',
    textTruncated: false,
    htmlBody: '<p>Your code is 123456</p>',
    htmlStatus: 'available',
    codeCandidates: [{ value: '123456', source: 'subject', context: 'Your code is 123456' }],
    links: [{ url: 'https://example.com/verify', text: 'Verify', host: 'example.com' }],
    dmarcPass: options.dmarcPass ?? true,
    sizeBytes: 1024,
    receivedAt,
    expiresAt: options.expiresAt ?? receivedAt + ttl,
  };
}

describe('Mailbox Messages API (/api/v1/mailboxes/{name}/messages)', () => {
  it('returns 200 with empty messages array for empty or never-used mailbox', async () => {
    const db = createMockD1Database();
    const res = await app.request('/api/v1/mailboxes/newuser/messages', {}, { DB: db });
    expect(res.status).toBe(200);

    const json = (await res.json()) as Record<string, unknown>;
    expect(json.name).toBe('newuser');
    expect(json.address).toBe('newuser@cottage.dpdns.org');
    expect(json.messages).toEqual([]);
    expect(json.pagination).toEqual({ limit: 20, nextCursor: null });
    expect(typeof json.serverTime).toBe('number');
  });

  it('normalizes mailbox name to lowercase and matches case-insensitively', async () => {
    const db = createMockD1Database();
    const repo = new MessageRepository(db);

    await repo.insertMessage(
      createSampleMessage('8c746a0e-7f90-4b13-a71c-9db724e57c01', Date.now(), {
        address: 'signup@cottage.dpdns.org',
      }),
    );

    // Query with mixed case 'SignUp'
    const res = await app.request('/api/v1/mailboxes/SignUp/messages', {}, { DB: db });
    expect(res.status).toBe(200);

    const json = (await res.json()) as Record<string, unknown>;
    expect(json.name).toBe('signup');
    expect(json.address).toBe('signup@cottage.dpdns.org');
    const messages = json.messages as Array<Record<string, unknown>>;
    expect(messages.length).toBe(1);
    expect(messages[0].id).toBe('8c746a0e-7f90-4b13-a71c-9db724e57c01');
  });

  it('rejects invalid mailbox names with 400 invalid_mailbox_name', async () => {
    const db = createMockD1Database();

    const invalidNames = [
      '.starts-with-dot',
      'ends-with-hyphen-',
      'consecutive..dots',
      'has+plus',
      'has space',
      'emoji👍',
      'a'.repeat(65),
    ];

    for (const name of invalidNames) {
      const res = await app.request(
        `/api/v1/mailboxes/${encodeURIComponent(name)}/messages`,
        {},
        { DB: db },
      );
      expect(res.status).toBe(400);

      const json = (await res.json()) as Record<string, unknown>;
      expect(json.error).toBe('invalid_mailbox_name');
      expect(json.message).toBe('Invalid mailbox name');
      const details = json.details as Array<{ field: string; message: string }>;
      expect(details[0].field).toBe('name');
    }
  });

  it('rejects invalid percent encoding in mailbox path segment with 400 invalid_mailbox_name', async () => {
    const db = createMockD1Database();
    const res = await app.request('/api/v1/mailboxes/%ZZ/messages', {}, { DB: db });
    expect(res.status).toBe(400);

    const json = (await res.json()) as Record<string, unknown>;
    expect(json.error).toBe('invalid_mailbox_name');
    const details = json.details as Array<{ field: string; message: string }>;
    expect(details[0].field).toBe('name');
  });

  it('enforces inclusive since boundary (receivedAt >= since)', async () => {
    const db = createMockD1Database();
    const repo = new MessageRepository(db);

    const now = Date.now();
    const t1 = now - 3000;
    const t2 = now - 2000;
    const t3 = now - 1000;

    await repo.insertMessage(createSampleMessage('8c746a0e-7f90-4b13-a71c-9db724e57001', t1));
    await repo.insertMessage(createSampleMessage('8c746a0e-7f90-4b13-a71c-9db724e57002', t2));
    await repo.insertMessage(createSampleMessage('8c746a0e-7f90-4b13-a71c-9db724e57003', t3));

    // since = t2 (inclusive) should return t3 and t2, excluding t1
    const res = await app.request(`/api/v1/mailboxes/signup/messages?since=${t2}`, {}, { DB: db });
    expect(res.status).toBe(200);

    const json = (await res.json()) as Record<string, unknown>;
    const messages = json.messages as Array<{ id: string; receivedAt: number }>;
    expect(messages.length).toBe(2);
    expect(messages.map((m) => m.id)).toEqual([
      '8c746a0e-7f90-4b13-a71c-9db724e57003',
      '8c746a0e-7f90-4b13-a71c-9db724e57002',
    ]);
  });

  it('discovers late-arriving emails when client holds fixed since across polls', async () => {
    const db = createMockD1Database();
    const repo = new MessageRepository(db);

    // Step 1: Health / Task starts at t0
    const t0 = Date.now();

    // Poll 1: mailbox is currently empty
    const poll1 = await app.request(
      `/api/v1/mailboxes/signup/messages?since=${t0}`,
      {},
      { DB: db },
    );
    expect(poll1.status).toBe(200);
    const json1 = (await poll1.json()) as Record<string, unknown>;
    expect((json1.messages as unknown[]).length).toBe(0);

    // Step 2: External sender sends email, arrives at t1 >= t0
    const t1 = t0 + 2000;
    await repo.insertMessage(createSampleMessage('8c746a0e-7f90-4b13-a71c-9db724e57099', t1));

    // Poll 2: Re-query with unchanged since = t0
    const poll2 = await app.request(
      `/api/v1/mailboxes/signup/messages?since=${t0}`,
      {},
      { DB: db },
    );
    expect(poll2.status).toBe(200);
    const json2 = (await poll2.json()) as Record<string, unknown>;
    const messages = json2.messages as Array<{ id: string }>;
    expect(messages.length).toBe(1);
    expect(messages[0].id).toBe('8c746a0e-7f90-4b13-a71c-9db724e57099');
  });

  it('filters by fromDomain (exact domain, case-insensitive)', async () => {
    const db = createMockD1Database();
    const repo = new MessageRepository(db);

    const now = Date.now();
    await repo.insertMessage(
      createSampleMessage('8c746a0e-7f90-4b13-a71c-9db724e57001', now - 3000, {
        fromDomain: 'example.com',
      }),
    );
    await repo.insertMessage(
      createSampleMessage('8c746a0e-7f90-4b13-a71c-9db724e57002', now - 2000, {
        fromDomain: 'mail.example.com',
      }),
    );
    await repo.insertMessage(
      createSampleMessage('8c746a0e-7f90-4b13-a71c-9db724e57003', now - 1000, {
        fromDomain: 'other.org',
      }),
    );

    // Exact match for example.com (does NOT match subdomains like mail.example.com)
    const res = await app.request(
      '/api/v1/mailboxes/signup/messages?fromDomain=EXAMPLE.COM',
      {},
      { DB: db },
    );
    expect(res.status).toBe(200);

    const json = (await res.json()) as Record<string, unknown>;
    const messages = json.messages as Array<{ id: string }>;
    expect(messages.length).toBe(1);
    expect(messages[0].id).toBe('8c746a0e-7f90-4b13-a71c-9db724e57001');
  });

  it('filters by subject literal substring without wildcard expansion', async () => {
    const db = createMockD1Database();
    const repo = new MessageRepository(db);

    const now = Date.now();
    await repo.insertMessage(
      createSampleMessage('8c746a0e-7f90-4b13-a71c-9db724e57001', now - 2000, {
        subject: '100% discount on goods',
      }),
    );
    await repo.insertMessage(
      createSampleMessage('8c746a0e-7f90-4b13-a71c-9db724e57002', now - 1000, {
        subject: '1000 discount',
      }),
    );

    // Query for '100%' should only match the literal '%' and not treat it as SQL wildcard
    const res = await app.request(
      '/api/v1/mailboxes/signup/messages?subject=100%25',
      {},
      { DB: db },
    );
    expect(res.status).toBe(200);

    const json = (await res.json()) as Record<string, unknown>;
    const messages = json.messages as Array<{ id: string }>;
    expect(messages.length).toBe(1);
    expect(messages[0].id).toBe('8c746a0e-7f90-4b13-a71c-9db724e57001');
  });

  it('filters by dmarcPass (true/false) and combines with AND', async () => {
    const db = createMockD1Database();
    const repo = new MessageRepository(db);

    const now = Date.now();
    await repo.insertMessage(
      createSampleMessage('8c746a0e-7f90-4b13-a71c-9db724e57001', now - 2000, {
        subject: 'Code Alpha',
        dmarcPass: true,
      }),
    );
    await repo.insertMessage(
      createSampleMessage('8c746a0e-7f90-4b13-a71c-9db724e57002', now - 1000, {
        subject: 'Code Beta',
        dmarcPass: false,
      }),
    );

    const res = await app.request(
      '/api/v1/mailboxes/signup/messages?subject=Code&dmarcPass=true',
      {},
      { DB: db },
    );
    expect(res.status).toBe(200);

    const json = (await res.json()) as Record<string, unknown>;
    const messages = json.messages as Array<{ id: string }>;
    expect(messages.length).toBe(1);
    expect(messages[0].id).toBe('8c746a0e-7f90-4b13-a71c-9db724e57001');
  });

  it('handles stable tie-break pagination for messages with exact same timestamp', async () => {
    const db = createMockD1Database();
    const repo = new MessageRepository(db);

    const sameTime = Date.now();
    // 3 messages with the exact same millisecond timestamp
    const idA = '11111111-1111-4111-8111-111111111111';
    const idB = '22222222-2222-4222-8222-222222222222';
    const idC = '33333333-3333-4333-8333-333333333333';

    await repo.insertMessage(createSampleMessage(idA, sameTime));
    await repo.insertMessage(createSampleMessage(idB, sameTime));
    await repo.insertMessage(createSampleMessage(idC, sameTime));

    // Sort order is receivedAt DESC, id DESC -> idC, idB, idA
    // Page 1 with limit=2
    const res1 = await app.request('/api/v1/mailboxes/signup/messages?limit=2', {}, { DB: db });
    expect(res1.status).toBe(200);

    const json1 = (await res1.json()) as Record<string, unknown>;
    const messages1 = json1.messages as Array<{ id: string }>;
    expect(messages1.length).toBe(2);
    expect(messages1[0].id).toBe(idC);
    expect(messages1[1].id).toBe(idB);

    const pagination1 = json1.pagination as { limit: number; nextCursor: string };
    expect(pagination1.nextCursor).toBeDefined();

    // Page 2 using nextCursor
    const res2 = await app.request(
      `/api/v1/mailboxes/signup/messages?limit=2&cursor=${pagination1.nextCursor}`,
      {},
      { DB: db },
    );
    expect(res2.status).toBe(200);

    const json2 = (await res2.json()) as Record<string, unknown>;
    const messages2 = json2.messages as Array<{ id: string }>;
    expect(messages2.length).toBe(1);
    expect(messages2[0].id).toBe(idA);

    const pagination2 = json2.pagination as { limit: number; nextCursor: string | null };
    expect(pagination2.nextCursor).toBeNull();
  });

  it('continues pagination even if the anchor message is deleted between pages', async () => {
    const db = createMockD1Database();
    const repo = new MessageRepository(db);

    const now = Date.now();
    const id1 = '8c746a0e-7f90-4b13-a71c-9db724e57001';
    const id2 = '8c746a0e-7f90-4b13-a71c-9db724e57002';
    const id3 = '8c746a0e-7f90-4b13-a71c-9db724e57003';

    await repo.insertMessage(createSampleMessage(id1, now - 3000));
    await repo.insertMessage(createSampleMessage(id2, now - 2000));
    await repo.insertMessage(createSampleMessage(id3, now - 1000));

    // Page 1 limit 1 -> returns id3
    const res1 = await app.request('/api/v1/mailboxes/signup/messages?limit=1', {}, { DB: db });
    const json1 = (await res1.json()) as Record<string, unknown>;
    const pagination1 = json1.pagination as { nextCursor: string };

    // Anchor id3 is now deleted
    await repo.deleteMessageById(id3, now);

    // Page 2 still succeeds using the keyset pagination cursor
    const res2 = await app.request(
      `/api/v1/mailboxes/signup/messages?limit=1&cursor=${pagination1.nextCursor}`,
      {},
      { DB: db },
    );
    expect(res2.status).toBe(200);
    const json2 = (await res2.json()) as Record<string, unknown>;
    const messages2 = json2.messages as Array<{ id: string }>;
    expect(messages2.length).toBe(1);
    expect(messages2[0].id).toBe(id2);
  });

  it('rejects cursor with 400 invalid_cursor if bound filter conditions do not match', async () => {
    const db = createMockD1Database();

    // Create a valid cursor bound to name: 'signup', since: 1000, fromDomain: 'example.com'
    const validCursor = encodeCursor({
      v: 1,
      name: 'signup',
      since: 1000,
      fromDomain: 'example.com',
      lastReceivedAt: 2000,
      lastId: '8c746a0e-7f90-4b13-a71c-9db724e57c01',
    });

    // 1. Changing mailbox name in query
    const res1 = await app.request(
      `/api/v1/mailboxes/otheruser/messages?since=1000&fromDomain=example.com&cursor=${validCursor}`,
      {},
      { DB: db },
    );
    expect(res1.status).toBe(400);
    const json1 = (await res1.json()) as Record<string, unknown>;
    expect(json1.error).toBe('invalid_cursor');

    // 2. Changing since in query
    const res2 = await app.request(
      `/api/v1/mailboxes/signup/messages?since=2000&fromDomain=example.com&cursor=${validCursor}`,
      {},
      { DB: db },
    );
    expect(res2.status).toBe(400);
    const json2 = (await res2.json()) as Record<string, unknown>;
    expect(json2.error).toBe('invalid_cursor');

    // 3. Omitting fromDomain in query
    const res3 = await app.request(
      `/api/v1/mailboxes/signup/messages?since=1000&cursor=${validCursor}`,
      {},
      { DB: db },
    );
    expect(res3.status).toBe(400);
    const json3 = (await res3.json()) as Record<string, unknown>;
    expect(json3.error).toBe('invalid_cursor');
  });

  it('rejects malformed, corrupted, or oversized cursor with 400 invalid_cursor', async () => {
    const db = createMockD1Database();

    const badCursors = [
      'not-a-valid-base64url!@#$',
      'bm90LWpzb24', // "not-json" base64
      'a'.repeat(1025), // exceeds 1024 chars
    ];

    for (const cursor of badCursors) {
      const res = await app.request(
        `/api/v1/mailboxes/signup/messages?cursor=${encodeURIComponent(cursor)}`,
        {},
        { DB: db },
      );
      expect(res.status).toBe(400);
      const json = (await res.json()) as Record<string, unknown>;
      expect(json.error).toBe('invalid_cursor');
      const details = json.details as Array<{ field: string }>;
      expect(details[0].field).toBe('cursor');
    }
  });

  it('rejects empty or duplicate cursor with 400 invalid_query', async () => {
    const db = createMockD1Database();

    // Empty cursor -> invalid_query
    const res1 = await app.request('/api/v1/mailboxes/signup/messages?cursor=', {}, { DB: db });
    expect(res1.status).toBe(400);
    const json1 = (await res1.json()) as Record<string, unknown>;
    expect(json1.error).toBe('invalid_query');

    // Duplicate cursor -> invalid_query
    const res2 = await app.request(
      '/api/v1/mailboxes/signup/messages?cursor=c1&cursor=c2',
      {},
      { DB: db },
    );
    expect(res2.status).toBe(400);
    const json2 = (await res2.json()) as Record<string, unknown>;
    expect(json2.error).toBe('invalid_query');
  });

  it('immediately hides expired messages from list queries', async () => {
    const db = createMockD1Database();
    const repo = new MessageRepository(db);

    const now = Date.now();
    // Message expired 100 milliseconds ago relative to serverTime
    await repo.insertMessage(
      createSampleMessage('8c746a0e-7f90-4b13-a71c-9db724e57001', now - ttl - 100, {
        expiresAt: now - 100,
      }),
    );
    // Active message
    await repo.insertMessage(
      createSampleMessage('8c746a0e-7f90-4b13-a71c-9db724e57002', now - 1000, {
        expiresAt: now + ttl,
      }),
    );

    const res = await app.request('/api/v1/mailboxes/signup/messages', {}, { DB: db });
    expect(res.status).toBe(200);

    const json = (await res.json()) as Record<string, unknown>;
    const messages = json.messages as Array<{ id: string }>;
    expect(messages.length).toBe(1);
    expect(messages[0].id).toBe('8c746a0e-7f90-4b13-a71c-9db724e57002');
  });

  it('clears mailbox messages with exclusive before boundary on DELETE', async () => {
    const db = createMockD1Database();
    const repo = new MessageRepository(db);

    const now = Date.now();
    const t1 = now - 3000;
    const t2 = now - 2000;
    const t3 = now - 1000;

    await repo.insertMessage(createSampleMessage('8c746a0e-7f90-4b13-a71c-9db724e57001', t1));
    await repo.insertMessage(createSampleMessage('8c746a0e-7f90-4b13-a71c-9db724e57002', t2));
    await repo.insertMessage(createSampleMessage('8c746a0e-7f90-4b13-a71c-9db724e57003', t3));

    // Clear before t2 (exclusive: receivedAt < t2). Only t1 is deleted; t2 and t3 remain
    const res = await app.request(
      `/api/v1/mailboxes/signup/messages?before=${t2}`,
      { method: 'DELETE' },
      { DB: db },
    );
    expect(res.status).toBe(200);

    const json = (await res.json()) as Record<string, unknown>;
    expect(json.name).toBe('signup');
    expect(json.address).toBe('signup@cottage.dpdns.org');
    expect(json.before).toBe(t2);
    expect(json.deletedCount).toBe(1);

    // Verify remaining
    const listRes = await app.request('/api/v1/mailboxes/signup/messages', {}, { DB: db });
    const listJson = (await listRes.json()) as Record<string, unknown>;
    const remaining = listJson.messages as Array<{ id: string }>;
    expect(remaining.map((m) => m.id)).toEqual([
      '8c746a0e-7f90-4b13-a71c-9db724e57003',
      '8c746a0e-7f90-4b13-a71c-9db724e57002',
    ]);
  });

  it('defaults before to serverTime on clear mailbox when omitted', async () => {
    const db = createMockD1Database();
    const repo = new MessageRepository(db);

    const now = Date.now();
    await repo.insertMessage(
      createSampleMessage('8c746a0e-7f90-4b13-a71c-9db724e57001', now - 2000),
    );
    await repo.insertMessage(
      createSampleMessage('8c746a0e-7f90-4b13-a71c-9db724e57002', now - 1000),
    );

    const res = await app.request(
      '/api/v1/mailboxes/signup/messages',
      { method: 'DELETE' },
      { DB: db },
    );
    expect(res.status).toBe(200);

    const json = (await res.json()) as Record<string, unknown>;
    expect(json.deletedCount).toBe(2);
    expect(json.before).toBe(json.serverTime);
  });

  it('rejects clear mailbox if before is in the future relative to serverTime', async () => {
    const db = createMockD1Database();
    const futureTime = Date.now() + 1_000_000;

    const res = await app.request(
      `/api/v1/mailboxes/signup/messages?before=${futureTime}`,
      { method: 'DELETE' },
      { DB: db },
    );
    expect(res.status).toBe(400);

    const json = (await res.json()) as Record<string, unknown>;
    expect(json.error).toBe('invalid_query');
    const details = json.details as Array<{ field: string }>;
    expect(details[0].field).toBe('before');
  });
});
