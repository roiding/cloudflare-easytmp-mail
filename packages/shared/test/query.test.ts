import { describe, expect, it } from 'vitest';
import { validateClearMailboxQuery, validateListMessagesQuery } from '../src/validation/query.js';

describe('Query parameter validation', () => {
  it('validates valid list query params', () => {
    const query =
      'since=1793671200000&fromDomain=example.com&subject=验证码&dmarcPass=true&limit=50';
    const res = validateListMessagesQuery(query);

    expect(res.valid).toBe(true);
    expect(res.data).toEqual({
      since: 1793671200000,
      fromDomain: 'example.com',
      subject: '验证码',
      dmarcPass: true,
      limit: 50,
    });
  });

  it('rejects unknown or duplicate query parameters', () => {
    const unknown = validateListMessagesQuery('foo=bar');
    expect(unknown.valid).toBe(false);
    expect(unknown.details[0].field).toBe('foo');

    const duplicate = validateListMessagesQuery('limit=10&limit=20');
    expect(duplicate.valid).toBe(false);
    expect(duplicate.details[0].field).toBe('limit');

    const empty = validateListMessagesQuery('since=');
    expect(empty.valid).toBe(false);
    expect(empty.details[0].field).toBe('since');
  });

  it('rejects invalid numeric formats with leading zeros or decimals', () => {
    expect(validateListMessagesQuery('since=0123').valid).toBe(false);
    expect(validateListMessagesQuery('since=12.34').valid).toBe(false);
    expect(validateListMessagesQuery('since=-100').valid).toBe(false);
    expect(validateListMessagesQuery('limit=0').valid).toBe(false);
    expect(validateListMessagesQuery('limit=101').valid).toBe(false);
  });

  it('validates clear mailbox query with before <= serverTime', () => {
    const serverTime = 1793671210000;

    const validPast = validateClearMailboxQuery('before=1793671200000', serverTime);
    expect(validPast.valid).toBe(true);
    expect(validPast.data?.before).toBe(1793671200000);

    const validEqual = validateClearMailboxQuery(`before=${serverTime}`, serverTime);
    expect(validEqual.valid).toBe(true);
    expect(validEqual.data?.before).toBe(serverTime);

    // Future before is rejected
    const invalidFuture = validateClearMailboxQuery(`before=${serverTime + 1000}`, serverTime);
    expect(invalidFuture.valid).toBe(false);
    expect(invalidFuture.details[0].field).toBe('before');
  });
});
