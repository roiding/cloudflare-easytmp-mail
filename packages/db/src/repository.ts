import { MessageDetail } from '@easytmp/shared';
import {
  mapInputToMessageRecord,
  mapRowToMessageDetail,
  mapRowToMessageSummary,
} from './mappers.js';
import {
  buildClearMailboxQuery,
  buildDeleteExpiredQuery,
  buildDeleteMessageByIdQuery,
  buildGetMessageByIdQuery,
  buildListMessagesQuery,
} from './queries.js';
import {
  ListMessagesDbParams,
  ListMessagesDbResult,
  MessageRecord,
  NewMessageInput,
} from './types.js';

export class MessageRepository {
  constructor(private readonly db: D1Database) {}

  async insertMessage(input: NewMessageInput): Promise<void> {
    const row = mapInputToMessageRecord(input);
    const sql = `
INSERT INTO messages (
  id, address, envelope_from, from_name, from_address, from_domain,
  subject, text_body, text_truncated, html_body, html_status,
  code_candidates_json, links_json, dmarc_pass, size_bytes,
  received_at, expires_at
) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?);
`.trim();

    await this.db
      .prepare(sql)
      .bind(
        row.id,
        row.address,
        row.envelope_from,
        row.from_name,
        row.from_address,
        row.from_domain,
        row.subject,
        row.text_body,
        row.text_truncated,
        row.html_body,
        row.html_status,
        row.code_candidates_json,
        row.links_json,
        row.dmarc_pass,
        row.size_bytes,
        row.received_at,
        row.expires_at,
      )
      .run();
  }

  async listMessages(params: ListMessagesDbParams): Promise<ListMessagesDbResult> {
    const { sql, params: queryParams } = buildListMessagesQuery(params);
    const result = await this.db
      .prepare(sql)
      .bind(...queryParams)
      .all<MessageRecord>();

    const rows = result.results || [];
    const hasMore = rows.length > params.limit;
    const pageRows = hasMore ? rows.slice(0, params.limit) : rows;

    let nextAnchor: { lastReceivedAt: number; lastId: string } | undefined;
    if (hasMore && pageRows.length > 0) {
      const lastRow = pageRows[pageRows.length - 1];
      nextAnchor = {
        lastReceivedAt: lastRow.received_at,
        lastId: lastRow.id,
      };
    }

    return {
      messages: pageRows.map(mapRowToMessageSummary),
      hasMore,
      nextAnchor,
    };
  }

  async getMessageById(id: string, serverTime: number): Promise<MessageDetail | null> {
    const { sql, params } = buildGetMessageByIdQuery(id, serverTime);
    const row = await this.db
      .prepare(sql)
      .bind(...params)
      .first<MessageRecord>();

    if (!row) {
      return null;
    }

    return mapRowToMessageDetail(row);
  }

  async deleteMessageById(id: string, serverTime: number): Promise<boolean> {
    const { sql, params } = buildDeleteMessageByIdQuery(id, serverTime);
    const res = await this.db
      .prepare(sql)
      .bind(...params)
      .run();

    return (res.meta.changes ?? 0) > 0;
  }

  async clearMailbox(address: string, before: number, serverTime: number): Promise<number> {
    const { sql, params } = buildClearMailboxQuery(address, before, serverTime);
    const res = await this.db
      .prepare(sql)
      .bind(...params)
      .run();

    return res.meta.changes ?? 0;
  }

  async deleteExpiredMessages(now: number, limit = 100): Promise<number> {
    const { sql, params } = buildDeleteExpiredQuery(now, limit);
    const res = await this.db
      .prepare(sql)
      .bind(...params)
      .run();

    return res.meta.changes ?? 0;
  }
}
