import { CodeCandidate, HtmlStatus, LinkCandidate, MessageSummary, Sender } from '@easytmp/shared';

export interface MessageRecord {
  id: string;
  address: string;
  envelope_from: string | null;
  from_name: string;
  from_address: string | null;
  from_domain: string | null;
  subject: string;
  text_body: string;
  text_truncated: number; // 0 or 1
  html_body: string | null;
  html_status: HtmlStatus;
  code_candidates_json: string;
  links_json: string;
  dmarc_pass: number; // 0 or 1
  size_bytes: number;
  received_at: number;
  expires_at: number;
}

export interface NewMessageInput {
  id: string;
  address: string;
  envelopeFrom: string | null;
  from: Sender;
  subject: string;
  textBody: string;
  textTruncated: boolean;
  htmlBody: string | null;
  htmlStatus: HtmlStatus;
  codeCandidates: CodeCandidate[];
  links: LinkCandidate[];
  dmarcPass: boolean;
  sizeBytes: number;
  receivedAt: number;
  expiresAt: number;
}

export interface ListMessagesDbParams {
  address: string;
  serverTime: number;
  since?: number;
  fromDomain?: string;
  subject?: string;
  dmarcPass?: boolean;
  cursor?: {
    lastReceivedAt: number;
    lastId: string;
  };
  limit: number;
}

export interface ListMessagesDbResult {
  messages: MessageSummary[];
  hasMore: boolean;
  nextAnchor?: {
    lastReceivedAt: number;
    lastId: string;
  };
}
