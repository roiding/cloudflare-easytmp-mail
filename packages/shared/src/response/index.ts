import { ErrorCode, ErrorDetail, ErrorResponse } from '../types/index.js';
import { generateMessageId } from '../validation/id.js';

export interface StandardHeadersOptions {
  requestId?: string;
  retryAfterSeconds?: number;
  allowMethods?: string;
}

export function createStandardHeaders(options: StandardHeadersOptions = {}): Headers {
  const headers = new Headers();
  const requestId = options.requestId || generateMessageId();

  headers.set('Cache-Control', 'no-store');
  headers.set('Access-Control-Allow-Origin', '*');
  headers.set('Access-Control-Expose-Headers', 'Retry-After, X-Request-Id');
  headers.set('X-Request-Id', requestId);
  headers.set('X-Content-Type-Options', 'nosniff');

  if (options.retryAfterSeconds !== undefined && options.retryAfterSeconds > 0) {
    headers.set('Retry-After', String(Math.floor(options.retryAfterSeconds)));
  }

  if (options.allowMethods) {
    headers.set('Allow', options.allowMethods);
  }

  return headers;
}

export function createJsonResponse<T>(
  data: T,
  status = 200,
  options: StandardHeadersOptions = {},
): Response {
  const headers = createStandardHeaders(options);
  headers.set('Content-Type', 'application/json; charset=utf-8');

  return new Response(JSON.stringify(data), {
    status,
    headers,
  });
}

export function createOptionsResponse(allowMethods = 'GET, DELETE, OPTIONS'): Response {
  const headers = createStandardHeaders({ allowMethods });
  headers.set('Access-Control-Allow-Methods', allowMethods);
  headers.set('Access-Control-Allow-Headers', 'Content-Type');

  return new Response(null, {
    status: 204,
    headers,
  });
}

export interface CreateErrorResponseOptions {
  status: number;
  error: ErrorCode;
  message: string;
  details?: ErrorDetail[];
  requestId?: string;
  serverTime?: number;
  retryAfterSeconds?: number;
  allowMethods?: string;
}

export function createErrorResponse(options: CreateErrorResponseOptions): Response {
  const requestId = options.requestId || generateMessageId();
  const serverTime = options.serverTime ?? Date.now();
  const details = (options.details || []).slice(0, 10);

  const errorBody: ErrorResponse = {
    error: options.error,
    message: options.message,
    details,
    requestId,
    serverTime,
  };

  const headers = createStandardHeaders({
    requestId,
    retryAfterSeconds: options.retryAfterSeconds,
    allowMethods: options.allowMethods,
  });
  headers.set('Content-Type', 'application/json; charset=utf-8');

  return new Response(JSON.stringify(errorBody), {
    status: options.status,
    headers,
  });
}
