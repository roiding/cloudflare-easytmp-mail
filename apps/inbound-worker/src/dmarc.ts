/**
 * DMARC Verification Module for Cloudflare Inbound Email Worker.
 *
 * Re-exports strict DMARC validation logic from '@easytmp/shared'.
 *
 * Cloudflare Email Routing injects an Authentication-Results header at the
 * top of received emails with authserv-id `mx.cloudflare.net`.
 *
 * Security Policies:
 * 1. Strictly matches authserv-id against `/^mx\.cloudflare\.net$/i`.
 * 2. Evaluates ONLY the very first Authentication-Results header in document order.
 * 3. Truncates headers at the RFC 5322 body boundary (\r\n\r\n or \n\n) to ignore forged body content.
 * 4. Rejects emails if Cloudflare's first header fails DMARC, even if subsequent headers claim pass.
 * 5. Rejects non-matching authserv-ids (e.g. attacker.com, mx.cloudflare.net.evil.example, mx.cloudflare.com).
 */
export {
  type RawHeader,
  parseRawHeaders,
  isCloudflareDmarcPassHeader,
  verifyCloudflareDmarc,
} from '@easytmp/shared';
