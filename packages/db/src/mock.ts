import { MessageRecord } from './types.js';

export function createMockD1Database(): D1Database {
  const records = new Map<string, MessageRecord>();

  const createMeta = (
    changes = 0,
    rows_read = 0,
    rows_written = 0,
  ): D1Meta & Record<string, unknown> => ({
    duration: 1,
    size_after: 0,
    rows_read,
    rows_written,
    last_row_id: 0,
    changed_db: changes > 0,
    changes,
  });

  const mockPreparedStatement = (query: string, params: unknown[] = []): D1PreparedStatement => {
    const stmt = {
      bind(...values: unknown[]) {
        return mockPreparedStatement(query, values);
      },

      async run<T = Record<string, unknown>>(): Promise<D1Result<T>> {
        const q = query.replace(/\s+/g, ' ').trim();

        if (q.startsWith('INSERT INTO messages')) {
          const [
            id,
            address,
            envelope_from,
            from_name,
            from_address,
            from_domain,
            subject,
            text_body,
            text_truncated,
            html_body,
            html_status,
            code_candidates_json,
            links_json,
            dmarc_pass,
            size_bytes,
            received_at,
            expires_at,
          ] = params;

          const record: MessageRecord = {
            id: id as string,
            address: address as string,
            envelope_from: (envelope_from as string | null) ?? null,
            from_name: from_name as string,
            from_address: (from_address as string | null) ?? null,
            from_domain: (from_domain as string | null) ?? null,
            subject: subject as string,
            text_body: text_body as string,
            text_truncated: text_truncated as number,
            html_body: (html_body as string | null) ?? null,
            html_status: html_status as MessageRecord['html_status'],
            code_candidates_json: code_candidates_json as string,
            links_json: links_json as string,
            dmarc_pass: dmarc_pass as number,
            size_bytes: size_bytes as number,
            received_at: received_at as number,
            expires_at: expires_at as number,
          };

          records.set(record.id, record);
          return {
            results: [],
            success: true,
            meta: createMeta(1, 0, 1),
          };
        }

        if (q.startsWith('DELETE FROM messages WHERE id = ? AND expires_at > ?')) {
          const [id, serverTime] = params as [string, number];
          const record = records.get(id);
          if (record && record.expires_at > serverTime) {
            records.delete(id);
            return {
              results: [],
              success: true,
              meta: createMeta(1, 1, 1),
            };
          }
          return {
            results: [],
            success: true,
            meta: createMeta(0, 1, 0),
          };
        }

        if (
          q.startsWith(
            'DELETE FROM messages WHERE address = ? AND received_at < ? AND expires_at > ?',
          )
        ) {
          const [address, before, serverTime] = params as [string, number, number];
          let changes = 0;
          for (const [id, record] of records.entries()) {
            if (
              record.address === address &&
              record.received_at < before &&
              record.expires_at > serverTime
            ) {
              records.delete(id);
              changes++;
            }
          }
          return {
            results: [],
            success: true,
            meta: createMeta(changes, records.size, changes),
          };
        }

        if (q.includes('WHERE expires_at <= ?')) {
          const [now, limit] = params as [number, number];
          let changes = 0;
          for (const [id, record] of records.entries()) {
            if (changes >= limit) break;
            if (record.expires_at <= now) {
              records.delete(id);
              changes++;
            }
          }
          return {
            results: [],
            success: true,
            meta: createMeta(changes, records.size, changes),
          };
        }

        return {
          results: [],
          success: true,
          meta: createMeta(0, 0, 0),
        };
      },

      async first<T = unknown>(): Promise<T | null> {
        const res = (await stmt.all()) as D1Result<T>;
        return res.results[0] || null;
      },

      async all<T = unknown>(): Promise<D1Result<T>> {
        const q = query.replace(/\s+/g, ' ').trim();

        if (q.startsWith('SELECT') && q.includes('WHERE id = ? AND expires_at > ?')) {
          const [id, serverTime] = params as [string, number];
          const record = records.get(id);
          if (record && record.expires_at > serverTime) {
            return {
              results: [record as unknown as T],
              success: true,
              meta: createMeta(0, 1, 0),
            };
          }
          return {
            results: [],
            success: true,
            meta: createMeta(0, 0, 0),
          };
        }

        if (q.startsWith('SELECT') && q.includes('FROM messages')) {
          let matched: MessageRecord[] = Array.from(records.values());

          let paramIdx = 0;
          const address = params[paramIdx++] as string;
          const serverTime = params[paramIdx++] as number;

          matched = matched.filter((r) => r.address === address && r.expires_at > serverTime);

          if (q.includes('received_at >= ?')) {
            const since = params[paramIdx++] as number;
            matched = matched.filter((r) => r.received_at >= since);
          }

          if (q.includes('from_domain = ?')) {
            const domain = params[paramIdx++] as string;
            matched = matched.filter((r) => r.from_domain === domain);
          }

          if (q.includes("subject LIKE ? ESCAPE '\\'")) {
            const likePattern = params[paramIdx++] as string;
            const inner = likePattern
              .slice(1, -1)
              .replace(/\\([%_\\])/g, '$1')
              .toLowerCase();
            matched = matched.filter((r) => r.subject.toLowerCase().includes(inner));
          }

          if (q.includes('dmarc_pass = ?')) {
            const dmarc = params[paramIdx++] as number;
            matched = matched.filter((r) => r.dmarc_pass === dmarc);
          }

          if (q.includes('(received_at < ? OR (received_at = ? AND id < ?))')) {
            const lastReceivedAt = params[paramIdx++] as number;
            paramIdx++;
            const lastId = params[paramIdx++] as string;

            matched = matched.filter(
              (r) =>
                r.received_at < lastReceivedAt ||
                (r.received_at === lastReceivedAt && r.id < lastId),
            );
          }

          matched.sort((a, b) => {
            if (b.received_at !== a.received_at) {
              return b.received_at - a.received_at;
            }
            return b.id.localeCompare(a.id);
          });

          const limit = params[paramIdx++] as number;
          if (limit !== undefined) {
            matched = matched.slice(0, limit);
          }

          return {
            results: matched as unknown as T[],
            success: true,
            meta: createMeta(0, matched.length, 0),
          };
        }

        return {
          results: [],
          success: true,
          meta: createMeta(0, 0, 0),
        };
      },
    };

    return stmt as unknown as D1PreparedStatement;
  };

  const db = {
    prepare(query: string) {
      return mockPreparedStatement(query);
    },
    _records: records,
  };

  return db as unknown as D1Database & { _records: Map<string, MessageRecord> };
}
