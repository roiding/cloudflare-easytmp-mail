export interface RawHeader {
  key: string;
  value: string;
}

const CLOUDFLARE_AUTHSERV_REGEX = /^(?:[a-z0-9-]+\.)*cloudflare(?:\.com)?$/i;
const DMARC_PASS_REGEX = /(?:^|[;\s])dmarc\s*=\s*pass(?:\s|[;(]|$)/i;

/**
 * Extracts and unfolds RFC 5322 email headers from raw content.
 * Stops strictly at the header/body boundary (\r\n\r\n or \n\n) to guarantee
 * that text in the email body is never misconstrued as an email header.
 */
export function parseRawHeaders(raw: string | Uint8Array | ArrayBuffer): RawHeader[] {
  let text = '';
  if (typeof raw === 'string') {
    text = raw;
  } else {
    const bytes = raw instanceof Uint8Array ? raw : new Uint8Array(raw);
    // RFC 5322 email headers typically fit well within 64KB.
    // Decoding only the header prefix avoids allocating large strings for big attachments.
    const limit = Math.min(bytes.byteLength, 65536);
    text = new TextDecoder('utf-8', { fatal: false }).decode(bytes.subarray(0, limit));
  }

  let headerEnd = text.indexOf('\r\n\r\n');
  if (headerEnd === -1) {
    headerEnd = text.indexOf('\n\n');
  }
  const headerBlock = headerEnd !== -1 ? text.slice(0, headerEnd) : text;

  // Unfold multi-line headers (CRLF/LF followed by space or tab)
  const unfolded = headerBlock.replace(/\r?\n[ \t]+/g, ' ');
  const lines = unfolded.split(/\r?\n/);

  const headers: RawHeader[] = [];
  for (const line of lines) {
    const colonIdx = line.indexOf(':');
    if (colonIdx === -1) continue;
    const key = line.slice(0, colonIdx).trim().toLowerCase();
    const value = line.slice(colonIdx + 1).trim();
    headers.push({ key, value });
  }

  return headers;
}

/**
 * Validates a single Authentication-Results header value to ensure:
 * 1. The authserv-id corresponds to Cloudflare (e.g., mx.cloudflare.com).
 * 2. The result parameters contain dmarc=pass.
 */
export function isCloudflareDmarcPassHeader(headerValue: string): boolean {
  const semiIndex = headerValue.indexOf(';');
  if (semiIndex === -1) {
    return false;
  }

  const authservIdPart = headerValue.slice(0, semiIndex).trim();
  // RFC 8601: <authserv-id> [version]
  const authservId = authservIdPart.split(/\s+/)[0].toLowerCase();

  if (!CLOUDFLARE_AUTHSERV_REGEX.test(authservId)) {
    return false;
  }

  const resultsPart = headerValue.slice(semiIndex + 1);
  return DMARC_PASS_REGEX.test(resultsPart);
}

/**
 * Evaluates DMARC authentication status under Cloudflare Email Routing semantics.
 *
 * Security Trust Boundary:
 * 1. Cloudflare Email Routing injects its Authentication-Results header at the very top of
 *    the email headers. Any prior or forged Authentication-Results headers from the sender
 *    or intermediate relays will appear after Cloudflare's header.
 * 2. Only the FIRST Authentication-Results header in header order is evaluated.
 * 3. The authserv-id must be Cloudflare's MTA (e.g. mx.cloudflare.com).
 * 4. Strings in the email body or non-header parts are strictly ignored.
 */
export function verifyCloudflareDmarc(
  headers: Array<{ key: string; value: string }>,
  fallbackHeaders?: Headers,
): boolean {
  // 1. Check headers in document order; ONLY consider the very first Authentication-Results
  const firstAuthResult = headers.find((h) => h.key.toLowerCase() === 'authentication-results');
  if (firstAuthResult) {
    return isCloudflareDmarcPassHeader(firstAuthResult.value);
  }

  // 2. Fallback to Headers object if provided (e.g. in synthetic mocks without raw header blocks)
  if (fallbackHeaders && typeof fallbackHeaders.get === 'function') {
    const authHeader = fallbackHeaders.get('authentication-results');
    if (authHeader) {
      // In Fetch Headers, multiple headers of the same name are joined by comma.
      // We evaluate the first segment before comma.
      const firstSegment = authHeader.split(/,\s*(?=[a-zA-Z0-9.-]+\s*;)/)[0];
      return isCloudflareDmarcPassHeader(firstSegment);
    }
  }

  return false;
}
