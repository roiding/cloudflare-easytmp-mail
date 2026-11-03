export const MAIL_DOMAIN = 'cottage.dpdns.org';
export const WEB_AND_API_DOMAIN = 'inbox.cottage.dpdns.org';
export const MESSAGE_RETENTION_MS = 604_800_000; // 7 days in ms
export const MESSAGE_RETENTION_SECONDS = 604_800;
export const MAX_EMAIL_BYTES = 1_048_576; // 1MB default
export const MAX_ALLOWED_EMAIL_BYTES = 2_097_152; // 2MB hard limit
export const MAX_TEXT_CHARS = 32_768; // 32KB default characters
export const MAX_ALLOWED_TEXT_CHARS = 131_072;
export const MAX_HTML_BYTES = 262_144; // 256KB default
export const MAX_ALLOWED_HTML_BYTES = 524_288;
export const MAX_HTTP_BODY_BYTES = 8192;
export const MAX_CODE_CANDIDATES = 10;
export const MAX_LINKS = 20;
export const DEFAULT_PAGE_LIMIT = 20;
export const MIN_PAGE_LIMIT = 1;
export const MAX_PAGE_LIMIT = 100;
export const MAX_CURSOR_LENGTH = 1024;
export const SAFE_MAX_INTEGER = 9007199254740991; // Number.MAX_SAFE_INTEGER

export interface Sender {
  name: string;
  address: string | null;
  domain: string | null;
}

export interface CodeCandidate {
  value: string;
  source: 'subject' | 'textBody';
  context: string;
}

export interface LinkCandidate {
  url: string;
  text: string;
  host: string;
}

export type HtmlStatus = 'available' | 'not_present' | 'too_large' | 'unavailable';

export interface MessageSummary {
  id: string;
  address: string;
  from: Sender;
  subject: string;
  preview: string;
  receivedAt: number;
  expiresAt: number;
  dmarcPass: boolean;
  codeCandidates: CodeCandidate[];
  hasHtml: boolean;
}

export interface MessageDetail extends MessageSummary {
  envelopeFrom: string | null;
  textBody: string;
  htmlBody: string | null;
  textTruncated: boolean;
  htmlStatus: HtmlStatus;
  links: LinkCandidate[];
  sizeBytes: number;
}

export interface Pagination {
  limit: number;
  nextCursor: string | null;
}

export interface HealthResponse {
  status: 'ok';
  service: 'easytmp-mail';
  apiVersion: '1';
  serverTime: number;
}

export interface RandomAddressResponse {
  name: string;
  address: string;
  serverTime: number;
}

export interface MessageListResponse {
  name: string;
  address: string;
  messages: MessageSummary[];
  pagination: Pagination;
  serverTime: number;
}

export interface MessageResponse {
  message: MessageDetail;
  serverTime: number;
}

export interface DeleteMessageResponse {
  id: string;
  deleted: boolean;
  serverTime: number;
}

export interface ClearMailboxResponse {
  name: string;
  address: string;
  before: number;
  deletedCount: number;
  serverTime: number;
}

export type ErrorCode =
  | 'invalid_mailbox_name'
  | 'invalid_message_id'
  | 'invalid_query'
  | 'invalid_cursor'
  | 'unexpected_body'
  | 'message_not_found'
  | 'route_not_found'
  | 'method_not_allowed'
  | 'request_too_large'
  | 'rate_limited'
  | 'internal_error'
  | 'service_unavailable';

export interface ErrorDetail {
  field: string;
  message: string;
}

export interface ErrorResponse {
  error: ErrorCode;
  message: string;
  details: ErrorDetail[];
  requestId: string;
  serverTime: number;
}
