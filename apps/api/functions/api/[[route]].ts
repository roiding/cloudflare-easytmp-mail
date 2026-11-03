import {
  ClearMailboxResponse,
  createErrorResponse,
  createJsonResponse,
  createOptionsResponse,
  CURSOR_BASE64URL_REGEX,
  CursorPayload,
  decodeCursor,
  DEFAULT_PAGE_LIMIT,
  DeleteMessageResponse,
  DOMAIN_REGEX,
  encodeCursor,
  ErrorDetail,
  generateMessageId,
  generateRandomMailbox,
  HealthResponse,
  MAIL_DOMAIN,
  MAX_CURSOR_LENGTH,
  MAX_HTTP_BODY_BYTES,
  MAX_PAGE_LIMIT,
  MessageDetail,
  MessageListResponse,
  MessageResponse,
  MIN_PAGE_LIMIT,
  RandomAddressResponse,
  SAFE_MAX_INTEGER,
  STRICT_INTEGER_REGEX,
  validateCursorMatchesFilter,
  validateMailboxName,
  validateMessageId,
} from '@easytmp/shared';
import { MessageRepository } from '@easytmp/db';
import { Context, Hono } from 'hono';
import { handle } from 'hono/cloudflare-pages';

export type PagesEnv = {
  DB: D1Database;
  MAIL_DOMAIN?: string;
};

type Variables = {
  serverTime: number;
  requestId: string;
};

type AppContext = Context<{ Bindings: PagesEnv; Variables: Variables }>;

const app = new Hono<{ Bindings: PagesEnv; Variables: Variables }>().basePath('/api');

// Middleware 1: Fixed serverTime and requestId per request
app.use('*', async (c, next) => {
  const serverTime = Date.now();
  const requestId = generateMessageId();
  c.set('serverTime', serverTime);
  c.set('requestId', requestId);
  await next();
});

// Middleware 2: Content-Length and body stream inspection for GET, DELETE, and HEAD
app.use('*', async (c, next) => {
  const { serverTime, requestId } = getReqContext(c);
  const method = c.req.method.toUpperCase();

  // Fast-fail if Content-Length exceeds 8192 on any request
  const clHeader = c.req.header('content-length');
  if (clHeader !== undefined) {
    const clNum = parseInt(clHeader, 10);
    if (!Number.isNaN(clNum) && clNum > MAX_HTTP_BODY_BYTES) {
      return createErrorResponse({
        status: 413,
        error: 'request_too_large',
        message: 'Request body exceeds 8192 bytes',
        details: [],
        requestId,
        serverTime,
      });
    }
  }

  // Enforce zero body for GET, DELETE, and HEAD
  if (method === 'GET' || method === 'DELETE' || method === 'HEAD') {
    if (c.req.raw.body) {
      const reader = c.req.raw.body.getReader();
      let totalBytes = 0;
      try {
        while (true) {
          const { done, value } = await reader.read();
          if (done) break;
          if (value) {
            totalBytes += value.byteLength;
            if (totalBytes > MAX_HTTP_BODY_BYTES) {
              try {
                await reader.cancel();
              } catch {
                // ignore
              }
              return createErrorResponse({
                status: 413,
                error: 'request_too_large',
                message: 'Request body exceeds 8192 bytes',
                details: [],
                requestId,
                serverTime,
              });
            }
          }
        }
      } catch {
        // stream read error
      }

      if (totalBytes > 0) {
        return createErrorResponse({
          status: 400,
          error: 'unexpected_body',
          message: 'GET and DELETE requests must not include a request body',
          details: [{ field: 'body', message: 'Request body must be empty' }],
          requestId,
          serverTime,
        });
      }
    }
  }

  await next();
});

function getReqContext(c: AppContext): { serverTime: number; requestId: string } {
  return {
    serverTime: c.get('serverTime') ?? Date.now(),
    requestId: c.get('requestId') ?? generateMessageId(),
  };
}

function validateNoQueryParams(c: AppContext): Response | null {
  const { serverTime, requestId } = getReqContext(c);
  const qIndex = c.req.url.indexOf('?');
  if (qIndex === -1) return null;

  const rawSearch = c.req.url.slice(qIndex + 1);
  if (rawSearch.length === 0) return null;

  const parts = rawSearch.split('&');
  const details: ErrorDetail[] = [];
  for (const part of parts) {
    if (!part) continue;
    const rawKey = part.split('=')[0];
    let key = rawKey;
    try {
      key = decodeURIComponent(rawKey.replace(/\+/g, ' '));
    } catch {
      return createErrorResponse({
        status: 400,
        error: 'invalid_query',
        message: 'Invalid query parameter',
        details: [{ field: 'query', message: 'Query string contains invalid percent encoding' }],
        requestId,
        serverTime,
      });
    }
    if (key && details.length < 10) {
      details.push({
        field: key,
        message: `Query parameter '${key}' is not allowed for this endpoint`,
      });
    }
  }

  if (details.length === 0) {
    details.push({
      field: 'query',
      message: 'Query parameters are not allowed for this endpoint',
    });
  }

  return createErrorResponse({
    status: 400,
    error: 'invalid_query',
    message: 'Query parameters are not allowed for this endpoint',
    details,
    requestId,
    serverTime,
  });
}

interface ValidatedListQuery {
  since?: number;
  fromDomain?: string;
  subject?: string;
  dmarcPass?: boolean;
  limit: number;
  cursorPayload?: CursorPayload;
}

function parseAndValidateListQuery(
  c: AppContext,
  normalizedMailboxName: string,
): { valid: true; data: ValidatedListQuery } | { valid: false; response: Response } {
  const { serverTime, requestId } = getReqContext(c);
  const qIndex = c.req.url.indexOf('?');
  if (qIndex === -1 || qIndex === c.req.url.length - 1) {
    return {
      valid: true,
      data: { limit: DEFAULT_PAGE_LIMIT },
    };
  }

  const rawSearch = c.req.url.slice(qIndex + 1);
  const parts = rawSearch.split('&');
  const details: ErrorDetail[] = [];
  const params = new Map<string, string>();
  const seenKeys = new Set<string>();

  const ALLOWED_KEYS = new Set(['since', 'fromDomain', 'subject', 'dmarcPass', 'limit', 'cursor']);

  for (const part of parts) {
    if (part === '') {
      if (details.length < 10) {
        details.push({
          field: 'query',
          message: 'Empty query parameter is not allowed',
        });
      }
      continue;
    }

    const eqIndex = part.indexOf('=');
    const rawKey = eqIndex === -1 ? part : part.slice(0, eqIndex);
    const rawVal = eqIndex === -1 ? '' : part.slice(eqIndex + 1);

    let decodedKey: string;
    let decodedVal: string;
    try {
      decodedKey = decodeURIComponent(rawKey.replace(/\+/g, ' '));
    } catch {
      if (details.length < 10) {
        details.push({
          field: 'query',
          message: 'Query string contains invalid percent encoding in parameter name',
        });
      }
      continue;
    }

    try {
      decodedVal = decodeURIComponent(rawVal.replace(/\+/g, ' '));
    } catch {
      if (details.length < 10) {
        details.push({
          field: decodedKey || 'query',
          message: 'Query string contains invalid percent encoding in parameter value',
        });
      }
      continue;
    }

    if (seenKeys.has(decodedKey)) {
      if (details.length < 10) {
        details.push({
          field: decodedKey,
          message: `Duplicate query parameter '${decodedKey}' is not allowed`,
        });
      }
      continue;
    }
    seenKeys.add(decodedKey);

    if (!ALLOWED_KEYS.has(decodedKey)) {
      if (details.length < 10) {
        details.push({
          field: decodedKey,
          message: `Unknown query parameter '${decodedKey}' is not allowed`,
        });
      }
      continue;
    }

    if (decodedVal === '' || eqIndex === -1) {
      if (details.length < 10) {
        details.push({
          field: decodedKey,
          message: `Empty value for query parameter '${decodedKey}' is not allowed`,
        });
      }
      continue;
    }

    params.set(decodedKey, decodedVal);
  }

  if (details.length > 0) {
    return {
      valid: false,
      response: createErrorResponse({
        status: 400,
        error: 'invalid_query',
        message: 'Invalid query parameter',
        details,
        requestId,
        serverTime,
      }),
    };
  }

  const result: ValidatedListQuery = {
    limit: DEFAULT_PAGE_LIMIT,
  };

  // 1. since
  if (params.has('since')) {
    const val = params.get('since')!;
    if (!STRICT_INTEGER_REGEX.test(val)) {
      details.push({
        field: 'since',
        message: 'Must be a non-negative safe integer in Unix milliseconds without leading zeros',
      });
    } else {
      const num = Number(val);
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
    const val = params.get('fromDomain')!;
    if (val.length < 3 || val.length > 253 || !DOMAIN_REGEX.test(val)) {
      details.push({
        field: 'fromDomain',
        message:
          'Must be a valid domain between 3 and 253 characters without leading @ or trailing dot',
      });
    } else {
      result.fromDomain = val.toLowerCase();
    }
  }

  // 3. subject
  if (params.has('subject')) {
    const val = params.get('subject')!;
    const codePointCount = Array.from(val).length;
    if (codePointCount < 1 || codePointCount > 200) {
      details.push({
        field: 'subject',
        message: 'Subject query must be between 1 and 200 Unicode code points',
      });
    } else {
      result.subject = val;
    }
  }

  // 4. dmarcPass
  if (params.has('dmarcPass')) {
    const val = params.get('dmarcPass')!;
    if (val === 'true') {
      result.dmarcPass = true;
    } else if (val === 'false') {
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
    const val = params.get('limit')!;
    if (!STRICT_INTEGER_REGEX.test(val)) {
      details.push({
        field: 'limit',
        message: 'Limit must be a decimal integer without leading zeros',
      });
    } else {
      const num = Number(val);
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

  if (details.length > 0) {
    return {
      valid: false,
      response: createErrorResponse({
        status: 400,
        error: 'invalid_query',
        message: 'Invalid query parameter',
        details,
        requestId,
        serverTime,
      }),
    };
  }

  // 6. cursor
  if (params.has('cursor')) {
    const rawCursor = params.get('cursor')!;
    if (
      rawCursor.length < 1 ||
      rawCursor.length > MAX_CURSOR_LENGTH ||
      !CURSOR_BASE64URL_REGEX.test(rawCursor)
    ) {
      return {
        valid: false,
        response: createErrorResponse({
          status: 400,
          error: 'invalid_cursor',
          message: 'Cursor is invalid or does not match this query',
          details: [
            {
              field: 'cursor',
              message: `Cursor must be a base64url string up to ${MAX_CURSOR_LENGTH} characters`,
            },
          ],
          requestId,
          serverTime,
        }),
      };
    }

    const decoded = decodeCursor(rawCursor);
    if (!decoded.valid || !decoded.payload) {
      return {
        valid: false,
        response: createErrorResponse({
          status: 400,
          error: 'invalid_cursor',
          message: 'Cursor is invalid or does not match this query',
          details: [
            {
              field: 'cursor',
              message: decoded.error || 'Failed to decode cursor',
            },
          ],
          requestId,
          serverTime,
        }),
      };
    }

    const matches = validateCursorMatchesFilter(decoded.payload, {
      name: normalizedMailboxName,
      since: result.since,
      fromDomain: result.fromDomain,
      subject: result.subject,
      dmarcPass: result.dmarcPass,
    });

    if (!matches) {
      return {
        valid: false,
        response: createErrorResponse({
          status: 400,
          error: 'invalid_cursor',
          message: 'Cursor is invalid or does not match this query',
          details: [
            {
              field: 'cursor',
              message: 'Restart from the first page with the intended filters',
            },
          ],
          requestId,
          serverTime,
        }),
      };
    }

    result.cursorPayload = decoded.payload;
  }

  return {
    valid: true,
    data: result,
  };
}

function parseClearMailboxQuery(
  url: string,
  serverTime: number,
  requestId: string,
): { valid: true; before: number } | { valid: false; response: Response } {
  const qIndex = url.indexOf('?');
  if (qIndex === -1) {
    return { valid: true, before: serverTime };
  }
  const rawSearch = url.slice(qIndex + 1);
  if (rawSearch.length === 0) {
    return { valid: true, before: serverTime };
  }

  const parts = rawSearch.split('&');
  const details: ErrorDetail[] = [];
  const seenKeys = new Set<string>();
  let rawBeforeValue: string | null = null;

  for (const part of parts) {
    if (part === '') {
      if (details.length < 10) {
        details.push({
          field: 'query',
          message: 'Empty query parameter is not allowed',
        });
      }
      continue;
    }
    const eqIndex = part.indexOf('=');
    const rawKey = eqIndex === -1 ? part : part.slice(0, eqIndex);
    const rawVal = eqIndex === -1 ? '' : part.slice(eqIndex + 1);

    let decodedKey: string;
    let decodedVal: string;
    try {
      decodedKey = decodeURIComponent(rawKey.replace(/\+/g, ' '));
    } catch {
      if (details.length < 10) {
        details.push({
          field: 'query',
          message: 'Query string contains invalid percent encoding in parameter name',
        });
      }
      continue;
    }

    try {
      decodedVal = decodeURIComponent(rawVal.replace(/\+/g, ' '));
    } catch {
      if (details.length < 10) {
        details.push({
          field: decodedKey || 'query',
          message: 'Query string contains invalid percent encoding in parameter value',
        });
      }
      continue;
    }

    if (seenKeys.has(decodedKey)) {
      if (details.length < 10) {
        details.push({
          field: decodedKey,
          message: `Duplicate query parameter '${decodedKey}' is not allowed`,
        });
      }
      continue;
    }
    seenKeys.add(decodedKey);

    if (decodedKey !== 'before') {
      if (details.length < 10) {
        details.push({
          field: decodedKey,
          message: `Unknown query parameter '${decodedKey}' is not allowed`,
        });
      }
      continue;
    }

    if (decodedVal === '' || eqIndex === -1) {
      if (details.length < 10) {
        details.push({
          field: 'before',
          message: "Empty value for query parameter 'before' is not allowed",
        });
      }
      continue;
    }

    rawBeforeValue = decodedVal;
  }

  if (details.length > 0) {
    return {
      valid: false,
      response: createErrorResponse({
        status: 400,
        error: 'invalid_query',
        message: 'Invalid query parameter',
        details,
        requestId,
        serverTime,
      }),
    };
  }

  if (rawBeforeValue === null) {
    return { valid: true, before: serverTime };
  }

  if (!STRICT_INTEGER_REGEX.test(rawBeforeValue)) {
    return {
      valid: false,
      response: createErrorResponse({
        status: 400,
        error: 'invalid_query',
        message: 'Invalid query parameter',
        details: [
          {
            field: 'before',
            message:
              'Must be a non-negative safe integer in Unix milliseconds without leading zeros',
          },
        ],
        requestId,
        serverTime,
      }),
    };
  }

  const beforeNum = Number(rawBeforeValue);
  if (beforeNum > SAFE_MAX_INTEGER) {
    return {
      valid: false,
      response: createErrorResponse({
        status: 400,
        error: 'invalid_query',
        message: 'Invalid query parameter',
        details: [
          {
            field: 'before',
            message: 'Timestamp exceeds safe integer range',
          },
        ],
        requestId,
        serverTime,
      }),
    };
  }

  if (beforeNum > serverTime) {
    return {
      valid: false,
      response: createErrorResponse({
        status: 400,
        error: 'invalid_query',
        message: 'Invalid query parameter',
        details: [
          {
            field: 'before',
            message: 'Timestamp before cannot be in the future relative to serverTime',
          },
        ],
        requestId,
        serverTime,
      }),
    };
  }

  return { valid: true, before: beforeNum };
}

function extractAndValidateMailboxName(
  c: AppContext,
): { valid: true; name: string } | { valid: false; response: Response } {
  const { serverTime, requestId } = getReqContext(c);
  const urlObj = new URL(c.req.url);
  const match = urlObj.pathname.match(/^\/api\/v1\/mailboxes\/([^/]+)\/messages$/);
  if (!match) {
    return {
      valid: false,
      response: createErrorResponse({
        status: 404,
        error: 'route_not_found',
        message: `API route ${urlObj.pathname} not found`,
        details: [],
        requestId,
        serverTime,
      }),
    };
  }

  const rawSegment = match[1];
  let decodedName: string;
  try {
    decodedName = decodeURIComponent(rawSegment);
  } catch {
    return {
      valid: false,
      response: createErrorResponse({
        status: 400,
        error: 'invalid_mailbox_name',
        message: 'Invalid mailbox name',
        details: [{ field: 'name', message: 'Mailbox name contains invalid percent encoding' }],
        requestId,
        serverTime,
      }),
    };
  }

  const validation = validateMailboxName(decodedName);
  if (!validation.valid || !validation.name) {
    return {
      valid: false,
      response: createErrorResponse({
        status: 400,
        error: 'invalid_mailbox_name',
        message: 'Invalid mailbox name',
        details: [{ field: 'name', message: validation.error || 'Invalid mailbox name' }],
        requestId,
        serverTime,
      }),
    };
  }

  return { valid: true, name: validation.name };
}

function extractAndValidateMessageId(
  c: AppContext,
): { valid: true; id: string } | { valid: false; response: Response } {
  const { serverTime, requestId } = getReqContext(c);
  const urlObj = new URL(c.req.url);
  const match = urlObj.pathname.match(/^\/api\/v1\/messages\/([^/]+)$/);
  if (!match) {
    return {
      valid: false,
      response: createErrorResponse({
        status: 404,
        error: 'route_not_found',
        message: `API route ${urlObj.pathname} not found`,
        details: [],
        requestId,
        serverTime,
      }),
    };
  }

  const rawId = match[1];
  let decodedId = rawId;
  try {
    decodedId = decodeURIComponent(rawId);
  } catch {
    // If decoding throws, validateMessageId will reject it
  }

  const validation = validateMessageId(decodedId);
  if (!validation.valid || !validation.id) {
    return {
      valid: false,
      response: createErrorResponse({
        status: 400,
        error: 'invalid_message_id',
        message: 'Invalid message ID format',
        details: [
          {
            field: 'id',
            message: validation.error || 'Message ID must be a lowercase standard UUID v4',
          },
        ],
        requestId,
        serverTime,
      }),
    };
  }

  return { valid: true, id: validation.id };
}

function getRepository(c: AppContext): { repo: MessageRepository } | { response: Response } {
  const { serverTime, requestId } = getReqContext(c);
  if (!c.env?.DB) {
    return {
      response: createErrorResponse({
        status: 503,
        error: 'service_unavailable',
        message: 'Database service is unavailable',
        details: [],
        requestId,
        serverTime,
        retryAfterSeconds: 3,
      }),
    };
  }
  return { repo: new MessageRepository(c.env.DB) };
}

// ==========================================
// 1. OPTIONS Preflight Handlers
// ==========================================
app.options('/health', () => createOptionsResponse('GET, OPTIONS'));
app.options('/v1/addresses/random', () => createOptionsResponse('GET, OPTIONS'));
app.options('/v1/mailboxes/:name/messages', () => createOptionsResponse('GET, DELETE, OPTIONS'));
app.options('/v1/messages/:id', () => createOptionsResponse('GET, DELETE, OPTIONS'));
app.options('*', () => createOptionsResponse('GET, DELETE, OPTIONS'));

// ==========================================
// 2. GET /api/health
// ==========================================
app.get('/health', (c) => {
  const { serverTime, requestId } = getReqContext(c);
  const queryErr = validateNoQueryParams(c);
  if (queryErr) return queryErr;

  const responseBody: HealthResponse = {
    status: 'ok',
    service: 'easytmp-mail',
    apiVersion: '1',
    serverTime,
  };

  return createJsonResponse(responseBody, 200, { requestId });
});

// ==========================================
// 3. GET /api/v1/addresses/random
// ==========================================
app.get('/v1/addresses/random', (c) => {
  const { serverTime, requestId } = getReqContext(c);
  const queryErr = validateNoQueryParams(c);
  if (queryErr) return queryErr;

  const mailDomain = c.env?.MAIL_DOMAIN || MAIL_DOMAIN;
  const { name, address } = generateRandomMailbox(mailDomain);

  const responseBody: RandomAddressResponse = {
    name,
    address,
    serverTime,
  };

  return createJsonResponse(responseBody, 200, { requestId });
});

// ==========================================
// 4. GET /api/v1/mailboxes/{name}/messages
// ==========================================
app.get('/v1/mailboxes/:name/messages', async (c) => {
  const { serverTime, requestId } = getReqContext(c);

  const repoCheck = getRepository(c);
  if ('response' in repoCheck) return repoCheck.response;

  const nameCheck = extractAndValidateMailboxName(c);
  if (!nameCheck.valid) return nameCheck.response;
  const normalizedName = nameCheck.name;

  const queryCheck = parseAndValidateListQuery(c, normalizedName);
  if (!queryCheck.valid) return queryCheck.response;
  const parsed = queryCheck.data;

  const mailDomain = c.env?.MAIL_DOMAIN || MAIL_DOMAIN;
  const address = `${normalizedName}@${mailDomain}`;

  const cursorAnchor = parsed.cursorPayload
    ? {
        lastReceivedAt: parsed.cursorPayload.lastReceivedAt,
        lastId: parsed.cursorPayload.lastId,
      }
    : undefined;

  let result;
  try {
    result = await repoCheck.repo.listMessages({
      address,
      serverTime,
      since: parsed.since,
      fromDomain: parsed.fromDomain,
      subject: parsed.subject,
      dmarcPass: parsed.dmarcPass,
      limit: parsed.limit,
      cursor: cursorAnchor,
    });
  } catch {
    return createErrorResponse({
      status: 503,
      error: 'service_unavailable',
      message: 'Database query failed',
      details: [],
      requestId,
      serverTime,
      retryAfterSeconds: 3,
    });
  }

  let nextCursor: string | null = null;
  if (result.hasMore && result.nextAnchor) {
    nextCursor = encodeCursor({
      v: 1,
      name: normalizedName,
      since: parsed.since,
      fromDomain: parsed.fromDomain,
      subject: parsed.subject,
      dmarcPass: parsed.dmarcPass,
      lastReceivedAt: result.nextAnchor.lastReceivedAt,
      lastId: result.nextAnchor.lastId,
    });
  }

  const responseBody: MessageListResponse = {
    name: normalizedName,
    address,
    messages: result.messages,
    pagination: {
      limit: parsed.limit,
      nextCursor,
    },
    serverTime,
  };

  return createJsonResponse(responseBody, 200, { requestId });
});

// ==========================================
// 5. DELETE /api/v1/mailboxes/{name}/messages
// ==========================================
app.delete('/v1/mailboxes/:name/messages', async (c) => {
  const { serverTime, requestId } = getReqContext(c);

  const repoCheck = getRepository(c);
  if ('response' in repoCheck) return repoCheck.response;

  const nameCheck = extractAndValidateMailboxName(c);
  if (!nameCheck.valid) return nameCheck.response;
  const normalizedName = nameCheck.name;

  const queryCheck = parseClearMailboxQuery(c.req.url, serverTime, requestId);
  if (!queryCheck.valid) return queryCheck.response;
  const before = queryCheck.before;

  const mailDomain = c.env?.MAIL_DOMAIN || MAIL_DOMAIN;
  const address = `${normalizedName}@${mailDomain}`;

  let deletedCount: number;
  try {
    deletedCount = await repoCheck.repo.clearMailbox(address, before, serverTime);
  } catch {
    return createErrorResponse({
      status: 503,
      error: 'service_unavailable',
      message: 'Database query failed',
      details: [],
      requestId,
      serverTime,
      retryAfterSeconds: 3,
    });
  }

  const responseBody: ClearMailboxResponse = {
    name: normalizedName,
    address,
    before,
    deletedCount,
    serverTime,
  };

  return createJsonResponse(responseBody, 200, { requestId });
});

// ==========================================
// 6. GET /api/v1/messages/{id}
// ==========================================
app.get('/v1/messages/:id', async (c) => {
  const { serverTime, requestId } = getReqContext(c);

  const queryErr = validateNoQueryParams(c);
  if (queryErr) return queryErr;

  const repoCheck = getRepository(c);
  if ('response' in repoCheck) return repoCheck.response;

  const idCheck = extractAndValidateMessageId(c);
  if (!idCheck.valid) return idCheck.response;
  const id = idCheck.id;

  let message: MessageDetail | null;
  try {
    message = await repoCheck.repo.getMessageById(id, serverTime);
  } catch {
    return createErrorResponse({
      status: 503,
      error: 'service_unavailable',
      message: 'Database query failed',
      details: [],
      requestId,
      serverTime,
      retryAfterSeconds: 3,
    });
  }

  if (!message) {
    return createErrorResponse({
      status: 404,
      error: 'message_not_found',
      message: 'Message not found',
      details: [],
      requestId,
      serverTime,
    });
  }

  const responseBody: MessageResponse = {
    message,
    serverTime,
  };

  return createJsonResponse(responseBody, 200, { requestId });
});

// ==========================================
// 7. DELETE /api/v1/messages/{id}
// ==========================================
app.delete('/v1/messages/:id', async (c) => {
  const { serverTime, requestId } = getReqContext(c);

  const queryErr = validateNoQueryParams(c);
  if (queryErr) return queryErr;

  const repoCheck = getRepository(c);
  if ('response' in repoCheck) return repoCheck.response;

  const idCheck = extractAndValidateMessageId(c);
  if (!idCheck.valid) return idCheck.response;
  const id = idCheck.id;

  let deleted: boolean;
  try {
    deleted = await repoCheck.repo.deleteMessageById(id, serverTime);
  } catch {
    return createErrorResponse({
      status: 503,
      error: 'service_unavailable',
      message: 'Database query failed',
      details: [],
      requestId,
      serverTime,
      retryAfterSeconds: 3,
    });
  }

  const responseBody: DeleteMessageResponse = {
    id,
    deleted,
    serverTime,
  };

  return createJsonResponse(responseBody, 200, { requestId });
});

// ==========================================
// 8. 405 Method Not Allowed Traps for Defined Routes
// ==========================================
app.all('/health', (c) => {
  const { serverTime, requestId } = getReqContext(c);
  return createErrorResponse({
    status: 405,
    error: 'method_not_allowed',
    message: 'Method not allowed',
    details: [],
    requestId,
    serverTime,
    allowMethods: 'GET, OPTIONS',
  });
});

app.all('/v1/addresses/random', (c) => {
  const { serverTime, requestId } = getReqContext(c);
  return createErrorResponse({
    status: 405,
    error: 'method_not_allowed',
    message: 'Method not allowed',
    details: [],
    requestId,
    serverTime,
    allowMethods: 'GET, OPTIONS',
  });
});

app.all('/v1/mailboxes/:name/messages', (c) => {
  const { serverTime, requestId } = getReqContext(c);
  return createErrorResponse({
    status: 405,
    error: 'method_not_allowed',
    message: 'Method not allowed',
    details: [],
    requestId,
    serverTime,
    allowMethods: 'GET, DELETE, OPTIONS',
  });
});

app.all('/v1/messages/:id', (c) => {
  const { serverTime, requestId } = getReqContext(c);
  return createErrorResponse({
    status: 405,
    error: 'method_not_allowed',
    message: 'Method not allowed',
    details: [],
    requestId,
    serverTime,
    allowMethods: 'GET, DELETE, OPTIONS',
  });
});

// ==========================================
// 9. 404 Route Not Found for Any Undefined /api/* Route
// ==========================================
app.notFound((c) => {
  const { serverTime, requestId } = getReqContext(c);
  return createErrorResponse({
    status: 404,
    error: 'route_not_found',
    message: `API route ${c.req.path} not found`,
    details: [],
    requestId,
    serverTime,
  });
});

// ==========================================
// 10. 500 Internal Error Trap
// ==========================================
app.onError((_err, c) => {
  const { serverTime, requestId } = getReqContext(c);
  return createErrorResponse({
    status: 500,
    error: 'internal_error',
    message: 'Internal server error',
    details: [],
    requestId,
    serverTime,
  });
});

export const onRequest = handle(app);
export default app;
