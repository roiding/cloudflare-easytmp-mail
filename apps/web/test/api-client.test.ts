// @vitest-environment jsdom
import './setup';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { apiClient, ApiError } from '../src/api/client';
import {
  createMockListResponse,
  createMockMessageDetail,
  createMockRandomAddress,
} from './helpers/test-utils';

describe('API Client unit tests', () => {
  const originalFetch = global.fetch;

  beforeEach(() => {
    vi.restoreAllMocks();
  });

  afterEach(() => {
    global.fetch = originalFetch;
  });

  it('fetches random address successfully', async () => {
    const mockData = createMockRandomAddress('testuser123', 1793671200000);
    global.fetch = vi.fn().mockImplementation(() =>
      Promise.resolve(
        new Response(JSON.stringify(mockData), {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        }),
      ),
    );

    const res = await apiClient.getRandomAddress();
    expect(res.name).toBe('testuser123');
    expect(res.address).toBe('testuser123@cottage.dpdns.org');
    expect(res.serverTime).toBe(1793671200000);
    expect(global.fetch).toHaveBeenCalledWith('/api/v1/addresses/random', expect.any(Object));
  });

  it('queries message list with all query parameters formatted correctly', async () => {
    const mockList = createMockListResponse([], null, 'mybox');
    let capturedUrl = '';
    global.fetch = vi.fn().mockImplementation((url: string) => {
      capturedUrl = url;
      return Promise.resolve(
        new Response(JSON.stringify(mockList), {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        }),
      );
    });

    await apiClient.listMessages('mybox', {
      since: 1793671200000,
      fromDomain: 'example.com',
      subject: '验证码',
      dmarcPass: true,
      limit: 20,
      cursor: 'cur_abc123',
    });

    expect(capturedUrl).toContain('/api/v1/mailboxes/mybox/messages?');
    expect(capturedUrl).toContain('since=1793671200000');
    expect(capturedUrl).toContain('fromDomain=example.com');
    expect(capturedUrl).toContain('subject=%E9%AA%8C%E8%AF%81%E7%A0%81');
    expect(capturedUrl).toContain('dmarcPass=true');
    expect(capturedUrl).toContain('limit=20');
    expect(capturedUrl).toContain('cursor=cur_abc123');
  });

  it('fetches message detail and validates payload structure', async () => {
    const detail = createMockMessageDetail({ id: '8c746a0e-7f90-4b13-a71c-9db724e57c02' });
    global.fetch = vi.fn().mockImplementation(() =>
      Promise.resolve(
        new Response(JSON.stringify({ message: detail, serverTime: 1793671200000 }), {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        }),
      ),
    );

    const res = await apiClient.getMessage('8c746a0e-7f90-4b13-a71c-9db724e57c02');
    expect(res.message.id).toBe('8c746a0e-7f90-4b13-a71c-9db724e57c02');
    expect(res.message.htmlStatus).toBe('available');
    expect(res.message.links.length).toBe(1);
  });

  it('deletes message and returns deletion state', async () => {
    global.fetch = vi.fn().mockImplementation(() =>
      Promise.resolve(
        new Response(
          JSON.stringify({
            id: '8c746a0e-7f90-4b13-a71c-9db724e57c02',
            deleted: true,
            serverTime: 1793671200000,
          }),
          {
            status: 200,
            headers: { 'Content-Type': 'application/json' },
          },
        ),
      ),
    );

    const res = await apiClient.deleteMessage('8c746a0e-7f90-4b13-a71c-9db724e57c02');
    expect(res.deleted).toBe(true);
  });

  it('clears mailbox with optional before timestamp', async () => {
    let capturedUrl = '';
    global.fetch = vi.fn().mockImplementation((url: string) => {
      capturedUrl = url;
      return Promise.resolve(
        new Response(
          JSON.stringify({
            name: 'alice',
            address: 'alice@cottage.dpdns.org',
            before: 1793671200000,
            deletedCount: 5,
            serverTime: 1793671200000,
          }),
          {
            status: 200,
            headers: { 'Content-Type': 'application/json' },
          },
        ),
      );
    });

    const res = await apiClient.clearMailbox('alice', 1793671200000);
    expect(res.deletedCount).toBe(5);
    expect(capturedUrl).toBe('/api/v1/mailboxes/alice/messages?before=1793671200000');
  });

  it('handles 404 message not found correctly', async () => {
    global.fetch = vi.fn().mockImplementation(() =>
      Promise.resolve(
        new Response(
          JSON.stringify({
            error: 'message_not_found',
            message: 'Message not found or expired',
            details: [],
            requestId: 'req-404',
            serverTime: 1793671200000,
          }),
          {
            status: 404,
            headers: {
              'Content-Type': 'application/json',
              'X-Request-Id': 'req-404',
            },
          },
        ),
      ),
    );

    await expect(apiClient.getMessage('missing-id')).rejects.toThrow(ApiError);
    try {
      await apiClient.getMessage('missing-id');
    } catch (err: unknown) {
      const apiErr = err as ApiError;
      expect(apiErr.status).toBe(404);
      expect(apiErr.code).toBe('message_not_found');
      expect(apiErr.requestId).toBe('req-404');
    }
  });

  it('handles 429 rate limit with Retry-After header', async () => {
    global.fetch = vi.fn().mockImplementation(() =>
      Promise.resolve(
        new Response(
          JSON.stringify({
            error: 'rate_limited',
            message: 'Rate limit exceeded',
            details: [],
            requestId: 'req-429',
            serverTime: 1793671200000,
          }),
          {
            status: 429,
            headers: {
              'Content-Type': 'application/json',
              'Retry-After': '5',
              'X-Request-Id': 'req-429',
            },
          },
        ),
      ),
    );

    try {
      await apiClient.listMessages('box');
      expect.fail('Should have thrown');
    } catch (err: unknown) {
      const apiErr = err as ApiError;
      expect(apiErr.status).toBe(429);
      expect(apiErr.retryAfter).toBe(5);
      expect(apiErr.message).toContain('等待 5 秒后再试');
    }
  });

  it('handles 503 service unavailable with Retry-After header', async () => {
    global.fetch = vi.fn().mockImplementation(() =>
      Promise.resolve(
        new Response(
          JSON.stringify({
            error: 'service_unavailable',
            message: 'Database unavailable',
            details: [],
            requestId: 'req-503',
            serverTime: 1793671200000,
          }),
          {
            status: 503,
            headers: {
              'Content-Type': 'application/json',
              'Retry-After': '10',
              'X-Request-Id': 'req-503',
            },
          },
        ),
      ),
    );

    try {
      await apiClient.listMessages('box');
      expect.fail('Should have thrown');
    } catch (err: unknown) {
      const apiErr = err as ApiError;
      expect(apiErr.status).toBe(503);
      expect(apiErr.retryAfter).toBe(10);
      expect(apiErr.message).toContain('等待 10 秒后再试');
    }
  });

  it('handles non-JSON HTML gateway error gracefully without leaking raw HTML', async () => {
    global.fetch = vi.fn().mockImplementation(() =>
      Promise.resolve(
        new Response('<html><body>502 Bad Gateway</body></html>', {
          status: 502,
          headers: { 'Content-Type': 'text/html' },
        }),
      ),
    );

    try {
      await apiClient.listMessages('box');
      expect.fail('Should have thrown');
    } catch (err: unknown) {
      const apiErr = err as ApiError;
      expect(apiErr.status).toBe(502);
      expect(apiErr.message).not.toContain('<html>');
      expect(apiErr.message).toBe('服务暂时发生异常，请稍后重试');
    }
  });
});
