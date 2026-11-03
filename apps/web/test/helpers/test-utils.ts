import type {
  MessageDetail,
  MessageListResponse,
  MessageSummary,
  RandomAddressResponse,
} from '@easytmp/shared';

export function createMockRandomAddress(
  name = 'p7x4m9q2v6k8n3r5',
  serverTime = 1793671200000,
): RandomAddressResponse {
  return {
    name,
    address: `${name}@cottage.dpdns.org`,
    serverTime,
  };
}

export function createMockMessageSummary(overrides: Partial<MessageSummary> = {}): MessageSummary {
  const id = overrides.id || '8c746a0e-7f90-4b13-a71c-9db724e57c02';
  return {
    id,
    address: overrides.address || 'signup@cottage.dpdns.org',
    from: overrides.from || {
      name: 'Acme Security',
      address: 'verify@example.com',
      domain: 'example.com',
    },
    subject: overrides.subject ?? '你的验证码：123456',
    preview: overrides.preview ?? '你的注册验证码是 123456，5分钟内有效。',
    receivedAt: overrides.receivedAt ?? 1793671205000,
    expiresAt: overrides.expiresAt ?? 1794276005000,
    dmarcPass: overrides.dmarcPass ?? true,
    codeCandidates: overrides.codeCandidates ?? [
      {
        value: '123456',
        source: 'subject',
        context: '你的验证码：123456',
      },
    ],
    hasHtml: overrides.hasHtml ?? true,
  };
}

export function createMockMessageDetail(overrides: Partial<MessageDetail> = {}): MessageDetail {
  const summary = createMockMessageSummary(overrides);
  return {
    ...summary,
    envelopeFrom: overrides.envelopeFrom ?? 'bounce@example.com',
    textBody:
      overrides.textBody ??
      '你的注册验证码是 123456，5分钟内有效。\n点击链接完成验证：https://example.com/verify?token=abc',
    htmlBody:
      overrides.htmlBody !== undefined
        ? overrides.htmlBody
        : '<p>你的注册验证码是 <strong>123456</strong></p><a href="https://example.com/verify?token=abc" target="_blank" rel="noopener noreferrer">点击验证</a>',
    textTruncated: overrides.textTruncated ?? false,
    htmlStatus: overrides.htmlStatus ?? 'available',
    links: overrides.links ?? [
      {
        url: 'https://example.com/verify?token=abc',
        text: '点击验证',
        host: 'example.com',
      },
    ],
    sizeBytes: overrides.sizeBytes ?? 2048,
  };
}

export function createMockListResponse(
  messages: MessageSummary[] = [],
  nextCursor: string | null = null,
  name = 'signup',
  serverTime = 1793671210000,
): MessageListResponse {
  return {
    name,
    address: `${name}@cottage.dpdns.org`,
    messages,
    pagination: {
      limit: 20,
      nextCursor,
    },
    serverTime,
  };
}
