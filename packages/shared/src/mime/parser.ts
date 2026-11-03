import PostalMime from 'postal-mime';
import { extractCodeCandidates } from '../extractor/codes.js';
import { extractLinks } from '../extractor/links.js';
import { generatePreview, htmlToPlainText, truncateTextBody } from '../extractor/text.js';
import { sanitizeHtml } from '../sanitizer/html.js';
import {
  CodeCandidate,
  HtmlStatus,
  LinkCandidate,
  MAX_HTML_BYTES,
  MAX_TEXT_CHARS,
  Sender,
} from '../types/index.js';
import {
  isCloudflareDmarcPassHeader,
  parseRawHeaders,
  RawHeader,
  verifyCloudflareDmarc,
} from './dmarc.js';

export { isCloudflareDmarcPassHeader, parseRawHeaders, type RawHeader, verifyCloudflareDmarc };

export interface ParsedEmailResult {
  from: Sender;
  envelopeFrom: string | null;
  subject: string;
  preview: string;
  textBody: string;
  textTruncated: boolean;
  htmlBody: string | null;
  htmlStatus: HtmlStatus;
  codeCandidates: CodeCandidate[];
  links: LinkCandidate[];
  dmarcPass: boolean;
  sizeBytes: number;
}

export interface ParseEmailOptions {
  envelopeFrom?: string | null;
  maxTextChars?: number;
  maxHtmlBytes?: number;
}

function parseDomainFromAddress(address: string): string | null {
  const atIndex = address.lastIndexOf('@');
  if (atIndex === -1 || atIndex === address.length - 1) return null;
  const domain = address
    .slice(atIndex + 1)
    .toLowerCase()
    .trim();
  return domain.length > 0 && domain.length <= 253 ? domain : null;
}

function truncateCodePoints(str: string, maxCodePoints: number): string {
  const codePoints = Array.from(str);
  return codePoints.slice(0, maxCodePoints).join('');
}

/**
 * Checks Cloudflare-injected Authentication-Results header for dmarc=pass.
 * Strictly checks ONLY the first Authentication-Results header in header order,
 * and requires authserv-id to match Cloudflare.
 */
export function checkDmarcPassFromHeaders(headers: Array<{ key: string; value: string }>): boolean {
  return verifyCloudflareDmarc(headers);
}

/**
 * Parses raw email content into validated, sanitized fields conforming to schema.
 */
export async function parseRawEmail(
  rawContent: string | ArrayBuffer,
  options: ParseEmailOptions = {},
): Promise<ParsedEmailResult> {
  const parser = new PostalMime();
  const parsed = await parser.parse(rawContent as unknown as string);

  let sizeBytes = 0;
  if (typeof rawContent === 'string') {
    sizeBytes = new TextEncoder().encode(rawContent).byteLength;
  } else if (rawContent instanceof ArrayBuffer) {
    sizeBytes = rawContent.byteLength;
  }

  // 1. Sender
  let fromName = '';
  let fromAddress: string | null = null;
  let fromDomain: string | null = null;

  if (parsed.from) {
    if (parsed.from.name) {
      fromName = truncateCodePoints(parsed.from.name.trim(), 256);
    }
    if (parsed.from.address) {
      const addr = parsed.from.address.trim();
      if (addr.length > 0 && addr.length <= 254) {
        const domain = parseDomainFromAddress(addr);
        if (domain) {
          const localPart = addr.slice(0, addr.lastIndexOf('@'));
          fromAddress = `${localPart}@${domain}`;
          fromDomain = domain;
        } else {
          fromAddress = addr;
        }
      }
    }
  }

  // 2. Envelope From
  let envelopeFrom: string | null = options.envelopeFrom ? options.envelopeFrom.trim() : null;
  if (!envelopeFrom && parsed.headers) {
    const returnPathHeader = parsed.headers.find((h) => h.key.toLowerCase() === 'return-path');
    if (returnPathHeader) {
      const match = returnPathHeader.value.match(/<([^>]+)>/) || [
        null,
        returnPathHeader.value.trim(),
      ];
      if (match[1]) {
        envelopeFrom = match[1].trim();
      }
    }
  }
  if (envelopeFrom && envelopeFrom.length > 254) {
    envelopeFrom = envelopeFrom.slice(0, 254);
  }

  // 3. Subject
  const rawSubject = (parsed.subject || '').trim();
  const subject = truncateCodePoints(rawSubject, 998);

  // 4. Text body & truncation
  const maxTextChars = options.maxTextChars ?? MAX_TEXT_CHARS;
  let rawText = parsed.text ? parsed.text.trim() : '';
  if (!rawText && parsed.html) {
    rawText = htmlToPlainText(parsed.html);
  }

  const { text: textBody, truncated: textTruncated } = truncateTextBody(rawText, maxTextChars);

  // 5. HTML sanitize
  const maxHtmlBytes = options.maxHtmlBytes ?? MAX_HTML_BYTES;
  const { htmlStatus, htmlBody } = sanitizeHtml(parsed.html, maxHtmlBytes);

  // 6. Preview
  const preview = generatePreview(textBody, 200);

  // 7. Code candidates (subject first, then textBody)
  const codeCandidates = extractCodeCandidates(subject, textBody);

  // 8. Links (from cleaned HTML first, then textBody)
  const links = extractLinks(htmlBody, textBody);

  // 9. DMARC pass: strictly verify first Authentication-Results from raw email headers
  const rawHeaders = parseRawHeaders(rawContent);
  let dmarcPass = verifyCloudflareDmarc(rawHeaders);
  if (!dmarcPass && parsed.headers && rawHeaders.length === 0) {
    dmarcPass = checkDmarcPassFromHeaders(parsed.headers);
  }

  return {
    from: {
      name: fromName,
      address: fromAddress,
      domain: fromDomain,
    },
    envelopeFrom,
    subject,
    preview,
    textBody,
    textTruncated,
    htmlBody,
    htmlStatus,
    codeCandidates,
    links,
    dmarcPass,
    sizeBytes,
  };
}
