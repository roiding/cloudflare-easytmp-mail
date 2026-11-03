import { generatePreview, MessageDetail, MessageSummary } from '@easytmp/shared';
import { MessageRecord, NewMessageInput } from './types.js';

export function mapInputToMessageRecord(input: NewMessageInput): MessageRecord {
  return {
    id: input.id,
    address: input.address,
    envelope_from: input.envelopeFrom,
    from_name: input.from.name,
    from_address: input.from.address,
    from_domain: input.from.domain,
    subject: input.subject,
    text_body: input.textBody,
    text_truncated: input.textTruncated ? 1 : 0,
    html_body: input.htmlBody,
    html_status: input.htmlStatus,
    code_candidates_json: JSON.stringify(input.codeCandidates),
    links_json: JSON.stringify(input.links),
    dmarc_pass: input.dmarcPass ? 1 : 0,
    size_bytes: input.sizeBytes,
    received_at: input.receivedAt,
    expires_at: input.expiresAt,
  };
}

export function mapRowToMessageSummary(row: MessageRecord): MessageSummary {
  let codeCandidates = [];
  try {
    codeCandidates = JSON.parse(row.code_candidates_json);
  } catch {
    codeCandidates = [];
  }

  const hasHtml = row.html_status === 'available' && typeof row.html_body === 'string';
  const preview = generatePreview(row.text_body, 200);

  return {
    id: row.id,
    address: row.address,
    from: {
      name: row.from_name,
      address: row.from_address,
      domain: row.from_domain,
    },
    subject: row.subject,
    preview,
    receivedAt: row.received_at,
    expiresAt: row.expires_at,
    dmarcPass: Boolean(row.dmarc_pass),
    codeCandidates,
    hasHtml,
  };
}

export function mapRowToMessageDetail(row: MessageRecord): MessageDetail {
  const summary = mapRowToMessageSummary(row);

  let links = [];
  try {
    links = JSON.parse(row.links_json);
  } catch {
    links = [];
  }

  return {
    ...summary,
    envelopeFrom: row.envelope_from,
    textBody: row.text_body,
    htmlBody: row.html_body,
    textTruncated: Boolean(row.text_truncated),
    htmlStatus: row.html_status,
    links,
    sizeBytes: row.size_bytes,
  };
}
