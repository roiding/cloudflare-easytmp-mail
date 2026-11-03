import { describe, expect, it } from 'vitest';
import {
  buildClearMailboxQuery,
  buildDeleteExpiredQuery,
  buildDeleteMessageByIdQuery,
  buildGetMessageByIdQuery,
  buildListMessagesQuery,
  escapeSqlLike,
} from '../src/queries.js';

describe('D1 SQL Query Builders', () => {
  it('escapes SQL LIKE special characters', () => {
    expect(escapeSqlLike('100%_verified\\test')).toBe('100\\%\\_verified\\\\test');
  });

  it('builds list messages query with all filters, cursor, and limit+1', () => {
    const q = buildListMessagesQuery({
      address: 'signup@cottage.dpdns.org',
      serverTime: 1793671210000,
      since: 1793671200000,
      fromDomain: 'Example.COM',
      subject: '100%_code',
      dmarcPass: true,
      cursor: {
        lastReceivedAt: 1793671205000,
        lastId: '8c746a0e-7f90-4b13-a71c-9db724e57c02',
      },
      limit: 20,
    });

    expect(q.sql).toContain('address = ?');
    expect(q.sql).toContain('expires_at > ?');
    expect(q.sql).toContain('received_at >= ?');
    expect(q.sql).toContain('from_domain = ?');
    expect(q.sql).toContain("subject LIKE ? ESCAPE '\\'");
    expect(q.sql).toContain('dmarc_pass = ?');
    expect(q.sql).toContain('(received_at < ? OR (received_at = ? AND id < ?))');
    expect(q.sql).toContain('ORDER BY received_at DESC, id DESC');
    expect(q.sql).toContain('LIMIT ?');

    // Params order
    expect(q.params[0]).toBe('signup@cottage.dpdns.org');
    expect(q.params[1]).toBe(1793671210000);
    expect(q.params[2]).toBe(1793671200000);
    expect(q.params[3]).toBe('example.com');
    expect(q.params[4]).toBe('%100\\%\\_code%');
    expect(q.params[5]).toBe(1);
    expect(q.params[6]).toBe(1793671205000);
    expect(q.params[7]).toBe(1793671205000);
    expect(q.params[8]).toBe('8c746a0e-7f90-4b13-a71c-9db724e57c02');
    expect(q.params[9]).toBe(21); // limit + 1
  });

  it('builds get message by id query enforcing serverTime expiration boundary', () => {
    const q = buildGetMessageByIdQuery('8c746a0e-7f90-4b13-a71c-9db724e57c02', 1793671210000);
    expect(q.sql).toContain('WHERE id = ? AND expires_at > ?');
    expect(q.params).toEqual(['8c746a0e-7f90-4b13-a71c-9db724e57c02', 1793671210000]);
  });

  it('builds delete message by id query enforcing serverTime expiration boundary', () => {
    const q = buildDeleteMessageByIdQuery('8c746a0e-7f90-4b13-a71c-9db724e57c02', 1793671210000);
    expect(q.sql).toContain('WHERE id = ? AND expires_at > ?');
    expect(q.params).toEqual(['8c746a0e-7f90-4b13-a71c-9db724e57c02', 1793671210000]);
  });

  it('builds clear mailbox query with exclusive before boundary', () => {
    const q = buildClearMailboxQuery('signup@cottage.dpdns.org', 1793671205000, 1793671210000);
    expect(q.sql).toContain('WHERE address = ? AND received_at < ? AND expires_at > ?');
    expect(q.params).toEqual(['signup@cottage.dpdns.org', 1793671205000, 1793671210000]);
  });

  it('builds delete expired query for cron cleanup', () => {
    const q = buildDeleteExpiredQuery(1793671210000, 100);
    expect(q.sql).toContain('WHERE expires_at <= ?');
    expect(q.params).toEqual([1793671210000, 100]);
  });
});
