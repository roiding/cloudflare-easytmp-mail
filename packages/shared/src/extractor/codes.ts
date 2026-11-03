import { CodeCandidate, MAX_CODE_CANDIDATES } from '../types/index.js';

const KEYWORDS_AND_STOPWORDS = new Set([
  'code',
  'token',
  'verify',
  'verification',
  'email',
  'emails',
  'message',
  'messages',
  'your',
  'please',
  'another',
  'account',
  'security',
  'login',
  'signin',
  'signup',
  'service',
  'welcome',
  'hello',
  'thanks',
  'thank',
  'click',
  'check',
  'confirm',
  'confirmation',
  'notice',
  'number',
  'subject',
  'inbox',
  'password',
  'passcode',
  'temporary',
  'expire',
  'expires',
  'minute',
  'minutes',
  'valid',
  'online',
  'regards',
  'support',
  'system',
  'device',
  'request',
  'requested',
  'html',
  'http',
  'https',
  'smtp',
  'imap',
  'json',
  'mime',
  'text',
  'from',
  'date',
]);

const VERIFICATION_KEYWORD_REGEX =
  /(?:code|verification|verify|otp|pin|token|auth|security|验证码|校验码|动态码|确认码|激活码|授权码|安全码)/i;

/**
 * Extracts a window of up to 160 Unicode code points surrounding the match index.
 */
function extractContext(text: string, startIndex: number, length: number): string {
  const codePoints = Array.from(text);
  let charCount = 0;
  let cpStart = 0;
  let cpEnd = 0;

  for (let i = 0; i < codePoints.length; i++) {
    if (charCount === startIndex) {
      cpStart = i;
    }
    charCount += codePoints[i].length;
    if (charCount >= startIndex + length && cpEnd === 0) {
      cpEnd = i + 1;
    }
  }

  if (cpEnd === 0) cpEnd = codePoints.length;

  const totalLength = 160;
  const matchCpLength = cpEnd - cpStart;
  const remaining = Math.max(0, totalLength - matchCpLength);
  const beforeCount = Math.floor(remaining / 2);
  const afterCount = remaining - beforeCount;

  const sliceStart = Math.max(0, cpStart - beforeCount);
  const sliceEnd = Math.min(codePoints.length, cpEnd + afterCount);

  return codePoints.slice(sliceStart, sliceEnd).join('').trim();
}

/**
 * Evaluates whether an alphanumeric token is a likely verification code candidate.
 */
function isLikelyCandidate(token: string, context: string): boolean {
  if (token.length < 4 || token.length > 12) return false;
  if (!/^[A-Za-z0-9]+$/.test(token)) return false;

  const lower = token.toLowerCase();
  if (KEYWORDS_AND_STOPWORDS.has(lower)) {
    return false;
  }

  // 1. Pure digits (e.g. "012345", "987654"): ALWAYS a candidate, preserving leading zeros!
  if (/^\d+$/.test(token)) {
    return true;
  }

  // 2. Contains both digits and letters (e.g. "ABCD99", "7K29", "A1B2C3"): Strong candidate
  if (/\d/.test(token) && /[A-Za-z]/.test(token)) {
    return true;
  }

  // 3. Pure uppercase letters without digits (e.g. "ABCD"):
  // Only accept if nearby context mentions verification keywords (e.g. "code: ABCD")
  // to avoid picking up arbitrary acronyms like "HTML" or "HTTP".
  if (/^[A-Z]{4,8}$/.test(token) && VERIFICATION_KEYWORD_REGEX.test(context)) {
    return true;
  }

  return false;
}

/**
 * Finds candidate tokens from a single text source.
 */
function findCandidatesInText(
  text: string,
  source: 'subject' | 'textBody',
  seenValues: Set<string>,
  results: CodeCandidate[],
): void {
  if (!text) return;

  // Match sequences of 4-12 ASCII alphanumeric characters bounded by non-alphanumeric or edges
  const tokenRegex = /(?<![A-Za-z0-9])([A-Za-z0-9]{4,12})(?![A-Za-z0-9])/g;
  let match: RegExpExecArray | null;

  while ((match = tokenRegex.exec(text)) !== null) {
    if (results.length >= MAX_CODE_CANDIDATES) return;

    const token = match[1];
    const startIndex = match.index;

    // Case-sensitive deduplication - only first occurrence is kept
    if (seenValues.has(token)) continue;

    const context = extractContext(text, startIndex, token.length);

    if (isLikelyCandidate(token, context)) {
      seenValues.add(token);
      results.push({
        value: token,
        source,
        context,
      });
    }
  }
}

/**
 * Extracts verification code candidates from subject and text body.
 * Subject candidates are processed first, then textBody.
 * Case-sensitive deduplication, maximum 10 candidates.
 * Leading zeros are strictly preserved.
 */
export function extractCodeCandidates(subject: string, textBody: string): CodeCandidate[] {
  const results: CodeCandidate[] = [];
  const seenValues = new Set<string>();

  findCandidatesInText(subject, 'subject', seenValues, results);
  findCandidatesInText(textBody, 'textBody', seenValues, results);

  return results;
}
