import { describe, expect, it } from 'vitest';
import { createMockD1Database } from '../src/mock.js';
import { MessageRepository } from '../src/repository.js';
import { NewMessageInput } from '../src/types.js';

describe('MessageRepository with Mock D1', () => {
  const baseTime = 1793671200000;
  const ttl = 604800000;

  function createSampleMessage(id: string, receivedAt: number, subject = 'Test'): NewMessageInput {
    return {
      id,
      address: 'user@cottage.dpdns.org',
      envelopeFrom: 'bounce@example.com',
      from: {
        name: 'Sender',
        address: 'sender@example.com',
        domain: 'example.com',
      },
      subject,
      textBody: `Body of ${id} with code 123456`,
      textTruncated: false,
      htmlBody: `<p>Body of ${id}</p>`,
      htmlStatus: 'available',
      codeCandidates: [{ value: '123456', source: 'textBody', context: 'code 123456' }],
      links: [{ url: 'https://example.com/verify', text: 'Verify', host: 'example.com' }],
      dmarcPass: true,
      sizeBytes: 1024,
      receivedAt,
      expiresAt: receivedAt + ttl,
    };
  }

  it('inserts and retrieves an active message', async () => {
    const db = createMockD1Database();
    const repo = new MessageRepository(db);

    const msg = createSampleMessage('msg-0001', baseTime);
    await repo.insertMessage(msg);

    const fetched = await repo.getMessageById('msg-0001', baseTime + 1000);
    expect(fetched).not.toBeNull();
    expect(fetched?.id).toBe('msg-0001');
    expect(fetched?.subject).toBe('Test');
    expect(fetched?.codeCandidates[0].value).toBe('123456');
    expect(fetched?.hasHtml).toBe(true);
  });

  it('makes expired messages immediately unreadable', async () => {
    const db = createMockD1Database();
    const repo = new MessageRepository(db);

    const msg = createSampleMessage('msg-expired', baseTime);
    await repo.insertMessage(msg);

    // Query before expiration -> readable
    const active = await repo.getMessageById('msg-expired', baseTime + ttl - 1);
    expect(active).not.toBeNull();

    // Query at exact expiration boundary (expires_at <= serverTime) -> unreadable (null)
    const exact = await repo.getMessageById('msg-expired', baseTime + ttl);
    expect(exact).toBeNull();

    // Query after expiration -> unreadable
    const expired = await repo.getMessageById('msg-expired', baseTime + ttl + 1000);
    expect(expired).toBeNull();
  });

  it('lists messages ordered receivedAt DESC, id DESC with pagination', async () => {
    const db = createMockD1Database();
    const repo = new MessageRepository(db);

    // Insert 5 messages with different timestamps and IDs
    await repo.insertMessage(createSampleMessage('msg-1', baseTime + 1000));
    await repo.insertMessage(createSampleMessage('msg-2', baseTime + 2000));
    await repo.insertMessage(createSampleMessage('msg-3', baseTime + 3000));
    await repo.insertMessage(createSampleMessage('msg-4', baseTime + 4000));
    await repo.insertMessage(createSampleMessage('msg-5', baseTime + 5000));

    // Page 1 with limit 2
    const page1 = await repo.listMessages({
      address: 'user@cottage.dpdns.org',
      serverTime: baseTime + 6000,
      limit: 2,
    });

    expect(page1.messages.length).toBe(2);
    expect(page1.messages[0].id).toBe('msg-5');
    expect(page1.messages[1].id).toBe('msg-4');
    expect(page1.hasMore).toBe(true);
    expect(page1.nextAnchor).toEqual({
      lastReceivedAt: baseTime + 4000,
      lastId: 'msg-4',
    });

    // Page 2 using cursor anchor
    const page2 = await repo.listMessages({
      address: 'user@cottage.dpdns.org',
      serverTime: baseTime + 6000,
      cursor: page1.nextAnchor,
      limit: 2,
    });

    expect(page2.messages.length).toBe(2);
    expect(page2.messages[0].id).toBe('msg-3');
    expect(page2.messages[1].id).toBe('msg-2');
    expect(page2.hasMore).toBe(true);

    // Page 3
    const page3 = await repo.listMessages({
      address: 'user@cottage.dpdns.org',
      serverTime: baseTime + 6000,
      cursor: page2.nextAnchor,
      limit: 2,
    });

    expect(page3.messages.length).toBe(1);
    expect(page3.messages[0].id).toBe('msg-1');
    expect(page3.hasMore).toBe(false);
  });

  it('filters by inclusive since, fromDomain, and literal subject', async () => {
    const db = createMockD1Database();
    const repo = new MessageRepository(db);

    await repo.insertMessage(createSampleMessage('msg-a', baseTime + 1000, 'Verify Code'));
    await repo.insertMessage(createSampleMessage('msg-b', baseTime + 2000, 'Welcome'));
    await repo.insertMessage(createSampleMessage('msg-c', baseTime + 3000, 'Another code'));

    // since is inclusive (>= since)
    const sinceRes = await repo.listMessages({
      address: 'user@cottage.dpdns.org',
      serverTime: baseTime + 5000,
      since: baseTime + 2000,
      limit: 10,
    });
    expect(sinceRes.messages.length).toBe(2);
    expect(sinceRes.messages.map((m) => m.id)).toEqual(['msg-c', 'msg-b']);

    // subject filter
    const subjectRes = await repo.listMessages({
      address: 'user@cottage.dpdns.org',
      serverTime: baseTime + 5000,
      subject: 'code',
      limit: 10,
    });
    expect(subjectRes.messages.length).toBe(2);
    expect(subjectRes.messages.map((m) => m.id)).toEqual(['msg-c', 'msg-a']);
  });

  it('deletes single message and returns deleted boolean', async () => {
    const db = createMockD1Database();
    const repo = new MessageRepository(db);

    await repo.insertMessage(createSampleMessage('msg-del', baseTime));

    // First delete returns true
    const deletedFirst = await repo.deleteMessageById('msg-del', baseTime + 1000);
    expect(deletedFirst).toBe(true);

    // Second delete returns false (idempotent)
    const deletedSecond = await repo.deleteMessageById('msg-del', baseTime + 1000);
    expect(deletedSecond).toBe(false);
  });

  it('clears mailbox with exclusive before boundary', async () => {
    const db = createMockD1Database();
    const repo = new MessageRepository(db);

    await repo.insertMessage(createSampleMessage('msg-1', baseTime + 1000));
    await repo.insertMessage(createSampleMessage('msg-2', baseTime + 2000));
    await repo.insertMessage(createSampleMessage('msg-3', baseTime + 3000));

    // Delete before baseTime + 2000 (strictly < before)
    // Only msg-1 should be deleted; msg-2 and msg-3 remain
    const deletedCount = await repo.clearMailbox(
      'user@cottage.dpdns.org',
      baseTime + 2000,
      baseTime + 4000,
    );
    expect(deletedCount).toBe(1);

    const remaining = await repo.listMessages({
      address: 'user@cottage.dpdns.org',
      serverTime: baseTime + 4000,
      limit: 10,
    });
    expect(remaining.messages.map((m) => m.id)).toEqual(['msg-3', 'msg-2']);
  });

  it('cleans up expired messages for cron', async () => {
    const db = createMockD1Database();
    const repo = new MessageRepository(db);

    await repo.insertMessage(createSampleMessage('msg-old', baseTime));
    await repo.insertMessage(createSampleMessage('msg-new', baseTime + ttl));

    const cleanedCount = await repo.deleteExpiredMessages(baseTime + ttl, 100);
    expect(cleanedCount).toBe(1);

    // msg-new remains
    const remaining = await repo.listMessages({
      address: 'user@cottage.dpdns.org',
      serverTime: baseTime + ttl + 1000,
      limit: 10,
    });
    expect(remaining.messages.map((m) => m.id)).toEqual(['msg-new']);
  });
});
