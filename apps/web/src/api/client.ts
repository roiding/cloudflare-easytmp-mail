import type {
  ClearMailboxResponse,
  DeleteMessageResponse,
  ErrorResponse,
  HealthResponse,
  MessageListResponse,
  MessageResponse,
  RandomAddressResponse,
} from '@easytmp/shared';

export class ApiError extends Error {
  public readonly status: number;
  public readonly code: string;
  public readonly details?: Array<{ field: string; message: string }>;
  public readonly retryAfter?: number;
  public readonly requestId?: string;

  constructor(options: {
    message: string;
    status: number;
    code?: string;
    details?: Array<{ field: string; message: string }>;
    retryAfter?: number;
    requestId?: string;
  }) {
    super(options.message);
    this.name = 'ApiError';
    this.status = options.status;
    this.code = options.code || (options.status >= 500 ? 'internal_error' : 'request_failed');
    this.details = options.details;
    this.retryAfter = options.retryAfter;
    this.requestId = options.requestId;
  }
}

/**
 * Safely parses response body as JSON.
 * Rejects with a readable ApiError if parsing fails or non-JSON returned.
 */
async function parseJsonResponse<T>(response: Response): Promise<T> {
  const contentType = response.headers.get('content-type') || '';
  const isJson = contentType.includes('application/json');

  let body: unknown = null;
  if (isJson) {
    try {
      body = await response.json();
    } catch {
      throw new ApiError({
        status: response.status,
        code: 'invalid_json',
        message: '服务返回了无效的 JSON 数据',
      });
    }
  } else {
    // If not JSON (e.g. gateway error HTML), consume text without throwing syntax error
    try {
      await response.text();
    } catch {
      // ignore
    }
  }

  if (!response.ok) {
    const errorBody = body as Partial<ErrorResponse> | null;
    const retryAfterHeader = response.headers.get('Retry-After');
    let retryAfter: number | undefined;
    if (retryAfterHeader) {
      const parsed = parseInt(retryAfterHeader, 10);
      if (!Number.isNaN(parsed) && parsed > 0) {
        retryAfter = parsed;
      }
    }

    const code = errorBody?.error || (response.status === 404 ? 'not_found' : 'http_error');
    let userMessage = errorBody?.message;

    if (response.status === 404) {
      userMessage = userMessage || '请求的邮件或资源不存在或已过期';
    } else if (response.status === 429) {
      userMessage = retryAfter
        ? `请求过于频繁，请等待 ${retryAfter} 秒后再试`
        : '请求过于频繁，请稍候再试';
    } else if (response.status === 503) {
      userMessage = retryAfter
        ? `服务暂时不可用，请等待 ${retryAfter} 秒后再试`
        : '服务暂时不可用，请稍候再试';
    } else if (response.status >= 500) {
      userMessage = '服务暂时发生异常，请稍后重试';
    } else {
      userMessage = userMessage || `请求失败 (HTTP ${response.status})`;
    }

    throw new ApiError({
      status: response.status,
      code,
      message: userMessage,
      details: errorBody?.details,
      retryAfter,
      requestId: errorBody?.requestId || response.headers.get('X-Request-Id') || undefined,
    });
  }

  if (body === null || typeof body !== 'object') {
    throw new ApiError({
      status: response.status,
      code: 'invalid_response',
      message: '服务响应格式异常',
    });
  }

  return body as T;
}

export interface ListMessagesOptions {
  since?: number;
  fromDomain?: string;
  subject?: string;
  dmarcPass?: boolean;
  limit?: number;
  cursor?: string;
  signal?: AbortSignal;
}

export const apiClient = {
  /**
   * Health check endpoint.
   */
  async getHealth(signal?: AbortSignal): Promise<HealthResponse> {
    const res = await fetch('/api/health', {
      method: 'GET',
      headers: { Accept: 'application/json' },
      signal,
    });
    const data = await parseJsonResponse<HealthResponse>(res);
    if (typeof data.serverTime !== 'number') {
      throw new ApiError({
        status: 200,
        code: 'invalid_response',
        message: '健康检查响应缺少有效时间戳',
      });
    }
    return data;
  },

  /**
   * Generates a random mailbox name and returns serverTime.
   */
  async getRandomAddress(signal?: AbortSignal): Promise<RandomAddressResponse> {
    const res = await fetch('/api/v1/addresses/random', {
      method: 'GET',
      headers: { Accept: 'application/json' },
      signal,
    });
    const data = await parseJsonResponse<RandomAddressResponse>(res);
    if (
      typeof data.name !== 'string' ||
      typeof data.address !== 'string' ||
      typeof data.serverTime !== 'number'
    ) {
      throw new ApiError({
        status: 200,
        code: 'invalid_response',
        message: '随机地址响应缺少必要字段',
      });
    }
    return data;
  },

  /**
   * Queries message list for a normalized mailbox name.
   */
  async listMessages(
    mailboxName: string,
    options: ListMessagesOptions = {},
  ): Promise<MessageListResponse> {
    const query = new URLSearchParams();
    if (typeof options.since === 'number') {
      query.set('since', options.since.toString());
    }
    if (options.fromDomain) {
      query.set('fromDomain', options.fromDomain);
    }
    if (options.subject) {
      query.set('subject', options.subject);
    }
    if (typeof options.dmarcPass === 'boolean') {
      query.set('dmarcPass', options.dmarcPass ? 'true' : 'false');
    }
    if (typeof options.limit === 'number') {
      query.set('limit', options.limit.toString());
    }
    if (options.cursor) {
      query.set('cursor', options.cursor);
    }

    const qs = query.toString();
    const url = `/api/v1/mailboxes/${encodeURIComponent(mailboxName)}/messages${qs ? `?${qs}` : ''}`;
    const res = await fetch(url, {
      method: 'GET',
      headers: { Accept: 'application/json' },
      signal: options.signal,
    });

    const data = await parseJsonResponse<MessageListResponse>(res);
    if (!Array.isArray(data.messages) || !data.pagination || typeof data.serverTime !== 'number') {
      throw new ApiError({
        status: 200,
        code: 'invalid_response',
        message: '邮件列表响应格式异常',
      });
    }
    return data;
  },

  /**
   * Fetches full message details.
   */
  async getMessage(id: string, signal?: AbortSignal): Promise<MessageResponse> {
    const res = await fetch(`/api/v1/messages/${encodeURIComponent(id)}`, {
      method: 'GET',
      headers: { Accept: 'application/json' },
      signal,
    });
    const data = await parseJsonResponse<MessageResponse>(res);
    if (!data.message || typeof data.message.id !== 'string') {
      throw new ApiError({
        status: 200,
        code: 'invalid_response',
        message: '邮件详情响应格式异常',
      });
    }
    return data;
  },

  /**
   * Deletes a single message by ID.
   */
  async deleteMessage(id: string, signal?: AbortSignal): Promise<DeleteMessageResponse> {
    const res = await fetch(`/api/v1/messages/${encodeURIComponent(id)}`, {
      method: 'DELETE',
      headers: { Accept: 'application/json' },
      signal,
    });
    return parseJsonResponse<DeleteMessageResponse>(res);
  },

  /**
   * Clears messages in a mailbox up to 'before' timestamp (exclusive).
   */
  async clearMailbox(
    mailboxName: string,
    before?: number,
    signal?: AbortSignal,
  ): Promise<ClearMailboxResponse> {
    const query = new URLSearchParams();
    if (typeof before === 'number') {
      query.set('before', before.toString());
    }
    const qs = query.toString();
    const url = `/api/v1/mailboxes/${encodeURIComponent(mailboxName)}/messages${qs ? `?${qs}` : ''}`;
    const res = await fetch(url, {
      method: 'DELETE',
      headers: { Accept: 'application/json' },
      signal,
    });
    return parseJsonResponse<ClearMailboxResponse>(res);
  },
};
