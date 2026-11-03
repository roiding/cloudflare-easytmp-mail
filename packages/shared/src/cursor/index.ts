import { MAX_CURSOR_LENGTH, SAFE_MAX_INTEGER } from '../types/index.js';
import { MESSAGE_ID_REGEX } from '../validation/id.js';
import { validateMailboxName } from '../validation/mailbox.js';
import { DOMAIN_REGEX } from '../validation/query.js';

export interface CursorPayload {
  v: 1;
  name: string;
  since?: number;
  fromDomain?: string;
  subject?: string;
  dmarcPass?: boolean;
  lastReceivedAt: number;
  lastId: string;
}

export interface CursorFilterContext {
  name: string;
  since?: number;
  fromDomain?: string;
  subject?: string;
  dmarcPass?: boolean;
}

export function toBase64Url(str: string): string {
  const bytes = new TextEncoder().encode(str);
  let binary = '';
  for (let i = 0; i < bytes.byteLength; i++) {
    binary += String.fromCharCode(bytes[i]);
  }
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

export function fromBase64Url(base64url: string): string {
  let base64 = base64url.replace(/-/g, '+').replace(/_/g, '/');
  while (base64.length % 4 !== 0) {
    base64 += '=';
  }
  const binary = atob(base64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) {
    bytes[i] = binary.charCodeAt(i);
  }
  return new TextDecoder().decode(bytes);
}

export function encodeCursor(payload: CursorPayload): string {
  const json = JSON.stringify(payload);
  const encoded = toBase64Url(json);
  if (encoded.length > MAX_CURSOR_LENGTH) {
    throw new Error(`Encoded cursor exceeds maximum length of ${MAX_CURSOR_LENGTH}`);
  }
  return encoded;
}

export interface DecodeCursorResult {
  valid: boolean;
  payload?: CursorPayload;
  error?: string;
}

const ALLOWED_CURSOR_KEYS = new Set([
  'v',
  'name',
  'since',
  'fromDomain',
  'subject',
  'dmarcPass',
  'lastReceivedAt',
  'lastId',
]);

export function decodeCursor(cursorString: string): DecodeCursorResult {
  if (typeof cursorString !== 'string') {
    return { valid: false, error: 'Cursor must be a string' };
  }

  if (cursorString.length < 1 || cursorString.length > MAX_CURSOR_LENGTH) {
    return {
      valid: false,
      error: `Cursor length must be between 1 and ${MAX_CURSOR_LENGTH}`,
    };
  }

  try {
    const json = fromBase64Url(cursorString);
    const parsed = JSON.parse(json);

    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
      return { valid: false, error: 'Invalid cursor JSON structure' };
    }

    // 1. Strict key check: reject any unexpected / unknown attributes
    const keys = Object.keys(parsed);
    for (const key of keys) {
      if (!ALLOWED_CURSOR_KEYS.has(key)) {
        return { valid: false, error: `Disallowed attribute in cursor: ${key}` };
      }
    }

    // 2. Version
    if (parsed.v !== 1) {
      return { valid: false, error: 'Unsupported cursor version' };
    }

    // 3. Mailbox name: must be valid string
    if (typeof parsed.name !== 'string') {
      return { valid: false, error: 'Invalid mailbox name type in cursor' };
    }
    const nameCheck = validateMailboxName(parsed.name);
    if (!nameCheck.valid || !nameCheck.name || nameCheck.name !== parsed.name) {
      return { valid: false, error: 'Invalid or non-normalized mailbox name in cursor' };
    }

    // 4. lastReceivedAt: non-negative safe integer
    if (
      typeof parsed.lastReceivedAt !== 'number' ||
      !Number.isSafeInteger(parsed.lastReceivedAt) ||
      parsed.lastReceivedAt < 0 ||
      parsed.lastReceivedAt > SAFE_MAX_INTEGER
    ) {
      return { valid: false, error: 'Invalid lastReceivedAt in cursor' };
    }

    // 5. lastId: lowercase UUID v4
    if (
      typeof parsed.lastId !== 'string' ||
      parsed.lastId.length !== 36 ||
      !MESSAGE_ID_REGEX.test(parsed.lastId)
    ) {
      return { valid: false, error: 'Invalid lastId in cursor' };
    }

    // 6. Optional since: if present, must be non-negative safe integer
    if ('since' in parsed && parsed.since !== undefined) {
      if (
        typeof parsed.since !== 'number' ||
        !Number.isSafeInteger(parsed.since) ||
        parsed.since < 0 ||
        parsed.since > SAFE_MAX_INTEGER
      ) {
        return { valid: false, error: 'Invalid since timestamp in cursor' };
      }
    }

    // 7. Optional fromDomain: if present, must be lowercase valid domain between 3 and 253 chars
    if ('fromDomain' in parsed && parsed.fromDomain !== undefined) {
      if (
        typeof parsed.fromDomain !== 'string' ||
        parsed.fromDomain.length < 3 ||
        parsed.fromDomain.length > 253 ||
        !DOMAIN_REGEX.test(parsed.fromDomain) ||
        parsed.fromDomain !== parsed.fromDomain.toLowerCase()
      ) {
        return { valid: false, error: 'Invalid fromDomain in cursor' };
      }
    }

    // 8. Optional subject: if present, must be string between 1 and 200 code points
    if ('subject' in parsed && parsed.subject !== undefined) {
      if (typeof parsed.subject !== 'string') {
        return { valid: false, error: 'Invalid subject in cursor' };
      }
      const codePoints = Array.from(parsed.subject).length;
      if (codePoints < 1 || codePoints > 200) {
        return { valid: false, error: 'Invalid subject length in cursor' };
      }
    }

    // 9. Optional dmarcPass: if present, must be strictly boolean
    if ('dmarcPass' in parsed && parsed.dmarcPass !== undefined) {
      if (typeof parsed.dmarcPass !== 'boolean') {
        return { valid: false, error: 'Invalid dmarcPass in cursor' };
      }
    }

    return {
      valid: true,
      payload: parsed as CursorPayload,
    };
  } catch {
    return { valid: false, error: 'Failed to decode cursor' };
  }
}

/**
 * Validates that the cursor's bound filter parameters match the active query filters.
 */
export function validateCursorMatchesFilter(
  payload: CursorPayload,
  filter: CursorFilterContext,
): boolean {
  if (payload.name !== filter.name) return false;
  if ((payload.since ?? undefined) !== (filter.since ?? undefined)) return false;
  if ((payload.fromDomain ?? undefined) !== (filter.fromDomain ?? undefined)) return false;
  if ((payload.subject ?? undefined) !== (filter.subject ?? undefined)) return false;
  if ((payload.dmarcPass ?? undefined) !== (filter.dmarcPass ?? undefined)) return false;

  return true;
}
