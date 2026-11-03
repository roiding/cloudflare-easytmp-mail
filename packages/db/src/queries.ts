import { ListMessagesDbParams } from './types.js';

export function escapeSqlLike(str: string): string {
  return str.replace(/\\/g, '\\\\').replace(/%/g, '\\%').replace(/_/g, '\\_');
}

export interface SqlStatement {
  sql: string;
  params: unknown[];
}

export function buildListMessagesQuery(params: ListMessagesDbParams): SqlStatement {
  const conditions: string[] = ['address = ?', 'expires_at > ?'];
  const queryParams: unknown[] = [params.address, params.serverTime];

  if (params.since !== undefined) {
    conditions.push('received_at >= ?');
    queryParams.push(params.since);
  }

  if (params.fromDomain !== undefined) {
    conditions.push('from_domain = ?');
    queryParams.push(params.fromDomain.toLowerCase());
  }

  if (params.subject !== undefined) {
    conditions.push("subject LIKE ? ESCAPE '\\'");
    queryParams.push(`%${escapeSqlLike(params.subject)}%`);
  }

  if (params.dmarcPass !== undefined) {
    conditions.push('dmarc_pass = ?');
    queryParams.push(params.dmarcPass ? 1 : 0);
  }

  if (params.cursor !== undefined) {
    conditions.push('(received_at < ? OR (received_at = ? AND id < ?))');
    queryParams.push(
      params.cursor.lastReceivedAt,
      params.cursor.lastReceivedAt,
      params.cursor.lastId,
    );
  }

  const limitWithExtra = params.limit + 1;
  queryParams.push(limitWithExtra);

  const sql = `
SELECT id, address, envelope_from, from_name, from_address, from_domain,
       subject, text_body, text_truncated, html_body, html_status,
       code_candidates_json, links_json, dmarc_pass, size_bytes,
       received_at, expires_at
FROM messages
WHERE ${conditions.join('\n  AND ')}
ORDER BY received_at DESC, id DESC
LIMIT ?;
`.trim();

  return { sql, params: queryParams };
}

export function buildGetMessageByIdQuery(id: string, serverTime: number): SqlStatement {
  const sql = `
SELECT id, address, envelope_from, from_name, from_address, from_domain,
       subject, text_body, text_truncated, html_body, html_status,
       code_candidates_json, links_json, dmarc_pass, size_bytes,
       received_at, expires_at
FROM messages
WHERE id = ? AND expires_at > ?
LIMIT 1;
`.trim();

  return { sql, params: [id, serverTime] };
}

export function buildDeleteMessageByIdQuery(id: string, serverTime: number): SqlStatement {
  const sql = `
DELETE FROM messages
WHERE id = ? AND expires_at > ?;
`.trim();

  return { sql, params: [id, serverTime] };
}

export function buildClearMailboxQuery(
  address: string,
  before: number,
  serverTime: number,
): SqlStatement {
  const sql = `
DELETE FROM messages
WHERE address = ? AND received_at < ? AND expires_at > ?;
`.trim();

  return { sql, params: [address, before, serverTime] };
}

export function buildDeleteExpiredQuery(now: number, limit: number): SqlStatement {
  const sql = `
DELETE FROM messages
WHERE id IN (
  SELECT id FROM messages
  WHERE expires_at <= ?
  LIMIT ?
);
`.trim();

  return { sql, params: [now, limit] };
}
