import {
  DEFAULT_PAGE_LIMIT,
  ErrorDetail,
  MAX_CURSOR_LENGTH,
  MAX_PAGE_LIMIT,
  MIN_PAGE_LIMIT,
  SAFE_MAX_INTEGER,
} from '../types/index.js';

export const DOMAIN_REGEX =
  /^(?:[A-Za-z0-9](?:[A-Za-z0-9-]{0,61}[A-Za-z0-9])?\.)+[A-Za-z0-9](?:[A-Za-z0-9-]{0,61}[A-Za-z0-9])?$/;
export const STRICT_INTEGER_REGEX = /^(?:0|[1-9][0-9]*)$/;
export const CURSOR_BASE64URL_REGEX = /^[A-Za-z0-9_-]+$/;

export interface ParsedListMessagesQuery {
  since?: number;
  fromDomain?: string;
  subject?: string;
  dmarcPass?: boolean;
  limit: number;
  cursor?: string;
}

export interface ParsedClearMailboxQuery {
  before?: number;
}

export interface QueryValidationResult<T> {
  valid: boolean;
  data?: T;
  details: ErrorDetail[];
}

/**
 * Extracts and checks query parameters from a URL or search string.
 * Rejects duplicate keys, empty parameter values, and unknown keys.
 */
export function parseAndValidateSearchParams(
  search: string | URLSearchParams,
  allowedKeys: Set<string>,
): {
  valid: boolean;
  params: Map<string, string>;
  details: ErrorDetail[];
} {
  const searchParams = typeof search === 'string' ? new URLSearchParams(search) : search;
  const details: ErrorDetail[] = [];
  const params = new Map<string, string>();
  const seenKeys = new Set<string>();

  for (const [key, value] of searchParams.entries()) {
    if (seenKeys.has(key)) {
      if (details.length < 10) {
        details.push({
          field: key,
          message: `Duplicate query parameter '${key}' is not allowed`,
        });
      }
      continue;
    }
    seenKeys.add(key);

    if (!allowedKeys.has(key)) {
      if (details.length < 10) {
        details.push({
          field: key,
          message: `Unknown query parameter '${key}' is not allowed`,
        });
      }
      continue;
    }

    if (value === '') {
      if (details.length < 10) {
        details.push({
          field: key,
          message: `Empty value for query parameter '${key}' is not allowed`,
        });
      }
      continue;
    }

    params.set(key, value);
  }

  return {
    valid: details.length === 0,
    params,
    details,
  };
}

const ALLOWED_LIST_PARAMS = new Set([
  'since',
  'fromDomain',
  'subject',
  'dmarcPass',
  'limit',
  'cursor',
]);

export function validateListMessagesQuery(
  search: string | URLSearchParams,
): QueryValidationResult<ParsedListMessagesQuery> {
  const { valid, params, details } = parseAndValidateSearchParams(search, ALLOWED_LIST_PARAMS);
  if (!valid) {
    return { valid: false, details };
  }

  const result: ParsedListMessagesQuery = {
    limit: DEFAULT_PAGE_LIMIT,
  };

  // 1. since
  if (params.has('since')) {
    const rawSince = params.get('since')!;
    if (!STRICT_INTEGER_REGEX.test(rawSince)) {
      details.push({
        field: 'since',
        message: 'Must be a non-negative safe integer in Unix milliseconds without leading zeros',
      });
    } else {
      const num = Number(rawSince);
      if (num > SAFE_MAX_INTEGER) {
        details.push({
          field: 'since',
          message: 'Timestamp exceeds safe integer range',
        });
      } else {
        result.since = num;
      }
    }
  }

  // 2. fromDomain
  if (params.has('fromDomain')) {
    const rawDomain = params.get('fromDomain')!;
    if (rawDomain.length < 3 || rawDomain.length > 253 || !DOMAIN_REGEX.test(rawDomain)) {
      details.push({
        field: 'fromDomain',
        message:
          'Must be a valid domain between 3 and 253 characters without leading @ or trailing dot',
      });
    } else {
      result.fromDomain = rawDomain.toLowerCase();
    }
  }

  // 3. subject
  if (params.has('subject')) {
    const rawSubject = params.get('subject')!;
    const codePointCount = Array.from(rawSubject).length;
    if (codePointCount < 1 || codePointCount > 200) {
      details.push({
        field: 'subject',
        message: 'Subject query must be between 1 and 200 Unicode code points',
      });
    } else {
      result.subject = rawSubject;
    }
  }

  // 4. dmarcPass
  if (params.has('dmarcPass')) {
    const rawDmarc = params.get('dmarcPass')!;
    if (rawDmarc === 'true') {
      result.dmarcPass = true;
    } else if (rawDmarc === 'false') {
      result.dmarcPass = false;
    } else {
      details.push({
        field: 'dmarcPass',
        message: "Must be strictly 'true' or 'false'",
      });
    }
  }

  // 5. limit
  if (params.has('limit')) {
    const rawLimit = params.get('limit')!;
    if (!STRICT_INTEGER_REGEX.test(rawLimit)) {
      details.push({
        field: 'limit',
        message: 'Limit must be a decimal integer without leading zeros',
      });
    } else {
      const num = Number(rawLimit);
      if (num < MIN_PAGE_LIMIT || num > MAX_PAGE_LIMIT) {
        details.push({
          field: 'limit',
          message: `Limit must be between ${MIN_PAGE_LIMIT} and ${MAX_PAGE_LIMIT}`,
        });
      } else {
        result.limit = num;
      }
    }
  }

  // 6. cursor
  if (params.has('cursor')) {
    const rawCursor = params.get('cursor')!;
    if (
      rawCursor.length < 1 ||
      rawCursor.length > MAX_CURSOR_LENGTH ||
      !CURSOR_BASE64URL_REGEX.test(rawCursor)
    ) {
      details.push({
        field: 'cursor',
        message: `Cursor must be a base64url string up to ${MAX_CURSOR_LENGTH} characters`,
      });
    } else {
      result.cursor = rawCursor;
    }
  }

  return {
    valid: details.length === 0,
    data: details.length === 0 ? result : undefined,
    details: details.slice(0, 10),
  };
}

const ALLOWED_CLEAR_PARAMS = new Set(['before']);

export function validateClearMailboxQuery(
  search: string | URLSearchParams,
  serverTime: number,
): QueryValidationResult<ParsedClearMailboxQuery> {
  const { valid, params, details } = parseAndValidateSearchParams(search, ALLOWED_CLEAR_PARAMS);
  if (!valid) {
    return { valid: false, details };
  }

  const result: ParsedClearMailboxQuery = {};

  if (params.has('before')) {
    const rawBefore = params.get('before')!;
    if (!STRICT_INTEGER_REGEX.test(rawBefore)) {
      details.push({
        field: 'before',
        message: 'Must be a non-negative safe integer in Unix milliseconds without leading zeros',
      });
    } else {
      const num = Number(rawBefore);
      if (num > SAFE_MAX_INTEGER) {
        details.push({
          field: 'before',
          message: 'Timestamp exceeds safe integer range',
        });
      } else if (num > serverTime) {
        details.push({
          field: 'before',
          message: 'Timestamp before cannot be in the future relative to serverTime',
        });
      } else {
        result.before = num;
      }
    }
  }

  return {
    valid: details.length === 0,
    data: details.length === 0 ? result : undefined,
    details: details.slice(0, 10),
  };
}

export function validateNoQueryParams(
  search: string | URLSearchParams,
): QueryValidationResult<Record<string, never>> {
  const searchParams = typeof search === 'string' ? new URLSearchParams(search) : search;
  const details: ErrorDetail[] = [];

  for (const [key] of searchParams.entries()) {
    if (details.length < 10) {
      details.push({
        field: key,
        message: `Query parameter '${key}' is not allowed for this endpoint`,
      });
    }
  }

  return {
    valid: details.length === 0,
    data: details.length === 0 ? {} : undefined,
    details,
  };
}
