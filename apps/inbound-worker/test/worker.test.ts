import { createMockD1Database, MessageRecord } from '@easytmp/db';
import { MESSAGE_RETENTION_MS } from '@easytmp/shared';
import { describe, expect, it, vi } from 'vitest';
import worker from '../src/index.js';

interface MockMessageOptions {
  to: string;
  from?: string;
  rawContent?: string | Uint8Array;
  rawStream?: ReadableStream<Uint8Array>;
  size?: number;
  rawSize?: number;
  headers?: Headers;
}

function createMockEmailMessage(opts: MockMessageOptions) {
  let rejectedReason = '';
  let streamReadCount = 0;

  let rawStream = opts.rawStream;
  if (!rawStream) {
    const bytes =
      typeof opts.rawContent === 'string'
        ? new TextEncoder().encode(opts.rawContent)
        : opts.rawContent || new Uint8Array();

    rawStream = new ReadableStream<Uint8Array>({
      start(controller) {
        streamReadCount++;
        controller.enqueue(bytes);
        controller.close();
      },
    });
  }

  const message = {
    to: opts.to,
    from: opts.from || 'sender@example.com',
    raw: rawStream,
    headers: opts.headers || new Headers(),
    size: opts.size,
    rawSize: opts.rawSize,
    setReject(reason: string) {
      rejectedReason = reason;
    },
    forward: vi.fn(),
    reply: vi.fn(),
  } as unknown as ForwardableEmailMessage & {
    getRejectedReason: () => string;
    getStreamReadCount: () => number;
  };

  message.getRejectedReason = () => rejectedReason;
  message.getStreamReadCount = () => streamReadCount;

  return message;
}

const VALID_EMAIL_MIME = `Authentication-Results: mx.cloudflare.com; dmarc=pass
From: "Test Sender" <sender@example.com>
To: user@cottage.dpdns.org
Subject: Verification Code: 049281
Content-Type: text/plain; charset=utf-8

Hello, your code is 049281.`;

describe('Inbound Worker: Recipient Domain & Address Validation', () => {
  it('rejects email sent to non-configured domain', async () => {
    const msg = createMockEmailMessage({
      to: 'user@otherdomain.com',
      rawContent: VALID_EMAIL_MIME,
    });
    const db = createMockD1Database();

    await worker.email(msg, { DB: db, MAIL_DOMAIN: 'cottage.dpdns.org' }, {} as ExecutionContext);

    expect(msg.getRejectedReason()).toBe('Recipient domain must be cottage.dpdns.org');
  });

  it('rejects email missing recipient domain or with invalid format', async () => {
    const db = createMockD1Database();

    const noDomainMsg = createMockEmailMessage({ to: 'invaliduser', rawContent: VALID_EMAIL_MIME });
    await worker.email(noDomainMsg, { DB: db }, {} as ExecutionContext);
    expect(noDomainMsg.getRejectedReason()).toBe('Invalid recipient address');

    const multiAtMsg = createMockEmailMessage({
      to: 'a@b@cottage.dpdns.org',
      rawContent: VALID_EMAIL_MIME,
    });
    await worker.email(multiAtMsg, { DB: db }, {} as ExecutionContext);
    expect(multiAtMsg.getRejectedReason()).toBe('Invalid recipient address');

    const emptyMsg = createMockEmailMessage({ to: '   ', rawContent: VALID_EMAIL_MIME });
    await worker.email(emptyMsg, { DB: db }, {} as ExecutionContext);
    expect(emptyMsg.getRejectedReason()).toBe('Invalid recipient address');
  });

  it('accepts recipient wrapped in angle brackets or display names', async () => {
    const db = createMockD1Database() as D1Database & { _records: Map<string, MessageRecord> };
    const msg = createMockEmailMessage({
      to: 'Recipient Name <testuser@cottage.dpdns.org>',
      rawContent: VALID_EMAIL_MIME,
    });

    await worker.email(msg, { DB: db }, {} as ExecutionContext);

    expect(msg.getRejectedReason()).toBe('');
    expect(db._records.size).toBe(1);
    const stored = Array.from(db._records.values())[0];
    expect(stored.address).toBe('testuser@cottage.dpdns.org');
  });

  it('normalizes uppercase recipient domain and local-part to lowercase', async () => {
    const db = createMockD1Database() as D1Database & { _records: Map<string, MessageRecord> };
    const msg = createMockEmailMessage({
      to: 'Alice.Bob_99@COTTAGE.DPDNS.ORG',
      rawContent: VALID_EMAIL_MIME,
    });

    await worker.email(msg, { DB: db }, {} as ExecutionContext);

    expect(msg.getRejectedReason()).toBe('');
    expect(db._records.size).toBe(1);
    const stored = Array.from(db._records.values())[0];
    expect(stored.address).toBe('alice.bob_99@cottage.dpdns.org');
  });

  it('rejects invalid mailbox local-part characters and patterns', async () => {
    const db = createMockD1Database();

    // Consecutive dots
    const dotsMsg = createMockEmailMessage({
      to: 'bad..name@cottage.dpdns.org',
      rawContent: VALID_EMAIL_MIME,
    });
    await worker.email(dotsMsg, { DB: db }, {} as ExecutionContext);
    expect(dotsMsg.getRejectedReason()).toBe('Invalid mailbox local part');

    // Starting with dot
    const startDotMsg = createMockEmailMessage({
      to: '.badname@cottage.dpdns.org',
      rawContent: VALID_EMAIL_MIME,
    });
    await worker.email(startDotMsg, { DB: db }, {} as ExecutionContext);
    expect(startDotMsg.getRejectedReason()).toBe('Invalid mailbox local part');

    // Ending with hyphen
    const endHyphenMsg = createMockEmailMessage({
      to: 'badname-@cottage.dpdns.org',
      rawContent: VALID_EMAIL_MIME,
    });
    await worker.email(endHyphenMsg, { DB: db }, {} as ExecutionContext);
    expect(endHyphenMsg.getRejectedReason()).toBe('Invalid mailbox local part');

    // Plus addressing is unsupported
    const plusMsg = createMockEmailMessage({
      to: 'user+tag@cottage.dpdns.org',
      rawContent: VALID_EMAIL_MIME,
    });
    await worker.email(plusMsg, { DB: db }, {} as ExecutionContext);
    expect(plusMsg.getRejectedReason()).toBe('Invalid mailbox local part');
  });

  it('allows never-visited mailbox to receive email directly without prior registration', async () => {
    const db = createMockD1Database() as D1Database & { _records: Map<string, MessageRecord> };
    const uniqueMailbox = 'brandnewmailbox9988@cottage.dpdns.org';

    const msg = createMockEmailMessage({
      to: uniqueMailbox,
      rawContent: VALID_EMAIL_MIME,
    });

    await worker.email(msg, { DB: db }, {} as ExecutionContext);

    expect(msg.getRejectedReason()).toBe('');
    expect(db._records.size).toBe(1);
    const stored = Array.from(db._records.values())[0];
    expect(stored.address).toBe(uniqueMailbox);
  });
});

describe('Inbound Worker: Size Limits (Declared and Streaming)', () => {
  it('rejects email immediately when declared message.size exceeds limit without reading stream', async () => {
    const stream = new ReadableStream<Uint8Array>();
    let readerCalled = false;
    const origGetReader = stream.getReader.bind(stream);
    stream.getReader = (...args) => {
      readerCalled = true;
      return origGetReader(...args);
    };

    const msg = createMockEmailMessage({
      to: 'user@cottage.dpdns.org',
      rawStream: stream,
      size: 2_000_000, // 2MB declared
    });
    const db = createMockD1Database();

    await worker.email(msg, { DB: db, MAX_EMAIL_BYTES: 1048576 }, {} as ExecutionContext);

    expect(msg.getRejectedReason()).toContain('Email exceeds size limit');
    expect(readerCalled).toBe(false); // Stream was NOT read
  });

  it('rejects email immediately when declared message.rawSize exceeds limit without reading stream', async () => {
    const stream = new ReadableStream<Uint8Array>();
    let readerCalled = false;
    const origGetReader = stream.getReader.bind(stream);
    stream.getReader = (...args) => {
      readerCalled = true;
      return origGetReader(...args);
    };

    const msg = createMockEmailMessage({
      to: 'user@cottage.dpdns.org',
      rawStream: stream,
      rawSize: 3_000_000,
    });
    const db = createMockD1Database();

    await worker.email(msg, { DB: db, MAX_EMAIL_BYTES: 1048576 }, {} as ExecutionContext);

    expect(msg.getRejectedReason()).toContain('Email exceeds size limit');
    expect(readerCalled).toBe(false);
  });

  it('aborts streaming and rejects when actual stream bytes exceed limit', async () => {
    let streamCancelled = false;
    let chunksSent = 0;

    const stream = new ReadableStream<Uint8Array>({
      pull(controller) {
        chunksSent++;
        // Emit 50KB chunks
        controller.enqueue(new Uint8Array(50 * 1024));
        if (chunksSent > 20) {
          controller.close();
        }
      },
      cancel() {
        streamCancelled = true;
      },
    });

    const msg = createMockEmailMessage({
      to: 'user@cottage.dpdns.org',
      rawStream: stream,
    });
    const db = createMockD1Database() as D1Database & { _records: Map<string, MessageRecord> };

    // Set max limit to 100KB
    await worker.email(msg, { DB: db, MAX_EMAIL_BYTES: 100 * 1024 }, {} as ExecutionContext);

    expect(msg.getRejectedReason()).toContain('Email exceeds size limit of 102400 bytes');
    expect(streamCancelled).toBe(true);
    expect(db._records.size).toBe(0);
  });

  it('clamps out-of-range configuration values to architecture safe bounds', async () => {
    const db = createMockD1Database() as D1Database & { _records: Map<string, MessageRecord> };

    // Configure MAX_EMAIL_BYTES too low (500 < 1024 min)
    // Should be clamped to 1024. A 2000-byte email should be rejected.
    const msgOversized = createMockEmailMessage({
      to: 'user@cottage.dpdns.org',
      rawContent: 'A'.repeat(2000),
    });

    await worker.email(msgOversized, { DB: db, MAX_EMAIL_BYTES: 500 }, {} as ExecutionContext);
    expect(msgOversized.getRejectedReason()).toBe('Email exceeds size limit of 1024 bytes');

    // Email of 500 bytes should pass the clamped 1024 limit (though might fail dmarc if missing)
    const validSmall = `Authentication-Results: mx.cloudflare.com; dmarc=pass
From: a@b.com
To: user@cottage.dpdns.org
Subject: Hi

Body`;
    const msgValid = createMockEmailMessage({
      to: 'user@cottage.dpdns.org',
      rawContent: validSmall,
    });
    await worker.email(msgValid, { DB: db, MAX_EMAIL_BYTES: 500 }, {} as ExecutionContext);
    expect(msgValid.getRejectedReason()).toBe('');
  });
});

describe('Inbound Worker: DMARC Trust Boundary & Anti-Spoofing', () => {
  it('accepts email with trusted Cloudflare Authentication-Results header', async () => {
    const db = createMockD1Database() as D1Database & { _records: Map<string, MessageRecord> };
    const raw = `Authentication-Results: mx.cloudflare.com; dmarc=pass (p=reject dis=none) header.from=example.com
From: support@example.com
To: user@cottage.dpdns.org
Subject: Valid DMARC

Hello world.`;

    const msg = createMockEmailMessage({ to: 'user@cottage.dpdns.org', rawContent: raw });
    await worker.email(msg, { DB: db, REQUIRE_DMARC_PASS: 'true' }, {} as ExecutionContext);

    expect(msg.getRejectedReason()).toBe('');
    expect(db._records.size).toBe(1);
    const stored = Array.from(db._records.values())[0];
    expect(stored.dmarc_pass).toBe(1);
  });

  it('rejects email when Cloudflare Authentication-Results indicates dmarc=fail', async () => {
    const db = createMockD1Database() as D1Database & { _records: Map<string, MessageRecord> };
    const raw = `Authentication-Results: mx.cloudflare.com; dmarc=fail (p=reject dis=reject) header.from=evil.com
From: support@evil.com
To: user@cottage.dpdns.org
Subject: Spoofed Mail

Fake invoice.`;

    const msg = createMockEmailMessage({ to: 'user@cottage.dpdns.org', rawContent: raw });
    await worker.email(msg, { DB: db, REQUIRE_DMARC_PASS: 'true' }, {} as ExecutionContext);

    expect(msg.getRejectedReason()).toBe('Email rejected: DMARC authentication pass is required');
    expect(db._records.size).toBe(0);
  });

  it('rejects email when only an attacker forged Authentication-Results header is present', async () => {
    const db = createMockD1Database() as D1Database & { _records: Map<string, MessageRecord> };
    const raw = `Authentication-Results: attacker.com; dmarc=pass
From: attacker@evil.com
To: user@cottage.dpdns.org
Subject: Forged Header

Phishing attack.`;

    const msg = createMockEmailMessage({ to: 'user@cottage.dpdns.org', rawContent: raw });
    await worker.email(msg, { DB: db, REQUIRE_DMARC_PASS: 'true' }, {} as ExecutionContext);

    expect(msg.getRejectedReason()).toBe('Email rejected: DMARC authentication pass is required');
    expect(db._records.size).toBe(0);
  });

  it('rejects email when Cloudflare header fails even if subsequent forged header claims dmarc=pass', async () => {
    const db = createMockD1Database() as D1Database & { _records: Map<string, MessageRecord> };
    // First header is Cloudflare fail, second header is forged pass
    const raw = `Authentication-Results: mx.cloudflare.com; dmarc=fail (p=reject dis=reject)
Authentication-Results: mx.cloudflare.com; dmarc=pass
From: spoofed@example.com
To: user@cottage.dpdns.org
Subject: Multi-header Attack

Hello`;

    const msg = createMockEmailMessage({ to: 'user@cottage.dpdns.org', rawContent: raw });
    await worker.email(msg, { DB: db, REQUIRE_DMARC_PASS: 'true' }, {} as ExecutionContext);

    expect(msg.getRejectedReason()).toBe('Email rejected: DMARC authentication pass is required');
    expect(db._records.size).toBe(0);
  });

  it('strictly ignores dmarc=pass inside email body', async () => {
    const db = createMockD1Database() as D1Database & { _records: Map<string, MessageRecord> };
    const raw = `From: attacker@example.com
To: user@cottage.dpdns.org
Subject: Tricky body

Authentication-Results: mx.cloudflare.com; dmarc=pass
This is in the body, not a header!`;

    const msg = createMockEmailMessage({ to: 'user@cottage.dpdns.org', rawContent: raw });
    await worker.email(msg, { DB: db, REQUIRE_DMARC_PASS: 'true' }, {} as ExecutionContext);

    expect(msg.getRejectedReason()).toBe('Email rejected: DMARC authentication pass is required');
    expect(db._records.size).toBe(0);
  });

  it('allows non-DMARC email when REQUIRE_DMARC_PASS is explicitly false but records dmarc_pass as 0', async () => {
    const db = createMockD1Database() as D1Database & { _records: Map<string, MessageRecord> };
    const raw = `From: dev@local.test
To: user@cottage.dpdns.org
Subject: Dev Email

Testing without DMARC.`;

    const msg = createMockEmailMessage({ to: 'user@cottage.dpdns.org', rawContent: raw });
    await worker.email(msg, { DB: db, REQUIRE_DMARC_PASS: 'false' }, {} as ExecutionContext);

    expect(msg.getRejectedReason()).toBe('');
    expect(db._records.size).toBe(1);
    const stored = Array.from(db._records.values())[0];
    expect(stored.dmarc_pass).toBe(0);
  });
});

describe('Inbound Worker: MIME Parsing, HTML Sanitization, Codes and Attachments', () => {
  it('parses multipart email with text, HTML, leading zeros verification code and links', async () => {
    const db = createMockD1Database() as D1Database & { _records: Map<string, MessageRecord> };
    const raw = `Authentication-Results: mx.cloudflare.com; dmarc=pass
From: "Security Team" <security@service.com>
To: user@cottage.dpdns.org
Subject: Verification Code 003819
Content-Type: multipart/alternative; boundary="BNDR"

--BNDR
Content-Type: text/plain; charset=utf-8

Please use code 003819 to log in. Or visit https://service.com/login?u=1

--BNDR
Content-Type: text/html; charset=utf-8

<p>Your security code is <b>003819</b></p>
<a href="https://service.com/login?u=1">Log in here</a>
<script>alert("hacked")</script>

--BNDR--`;

    const msg = createMockEmailMessage({ to: 'user@cottage.dpdns.org', rawContent: raw });
    await worker.email(msg, { DB: db }, {} as ExecutionContext);

    expect(msg.getRejectedReason()).toBe('');
    expect(db._records.size).toBe(1);
    const stored = Array.from(db._records.values())[0];

    // Sender
    expect(stored.from_name).toBe('Security Team');
    expect(stored.from_address).toBe('security@service.com');
    expect(stored.from_domain).toBe('service.com');

    // Subject & Text
    expect(stored.subject).toBe('Verification Code 003819');
    expect(stored.text_body).toContain('003819');

    // HTML sanitization
    expect(stored.html_status).toBe('available');
    expect(stored.html_body).toContain('Log in here');
    expect(stored.html_body).not.toContain('<script');
    expect(stored.html_body).toContain('rel="noopener noreferrer"');

    // Verification code preserving leading zeros
    const codes = JSON.parse(stored.code_candidates_json);
    expect(codes.length).toBeGreaterThanOrEqual(1);
    expect(codes[0].value).toBe('003819');

    // Links
    const links = JSON.parse(stored.links_json);
    expect(links.length).toBeGreaterThanOrEqual(1);
    expect(links[0].url).toBe('https://service.com/login?u=1');
  });

  it('handles email with attachments: extracts text and codes but never saves attachment data to D1', async () => {
    const db = createMockD1Database() as D1Database & { _records: Map<string, MessageRecord> };
    const attachmentBinary =
      'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=';

    const raw = `Authentication-Results: mx.cloudflare.com; dmarc=pass
From: "Billing" <billing@corp.com>
To: user@cottage.dpdns.org
Subject: Invoice Attached 091823
Content-Type: multipart/mixed; boundary="MIXED_BNDR"

--MIXED_BNDR
Content-Type: text/plain; charset=utf-8

Please find your invoice attached. Your payment authorization code is 091823.

--MIXED_BNDR
Content-Type: image/png; name="invoice.png"
Content-Disposition: attachment; filename="invoice.png"
Content-Transfer-Encoding: base64

${attachmentBinary}
--MIXED_BNDR--`;

    const msg = createMockEmailMessage({ to: 'user@cottage.dpdns.org', rawContent: raw });
    await worker.email(msg, { DB: db }, {} as ExecutionContext);

    expect(msg.getRejectedReason()).toBe('');
    expect(db._records.size).toBe(1);
    const stored = Array.from(db._records.values())[0];

    // Text and code candidate are extracted and stored
    expect(stored.text_body).toContain('Please find your invoice attached');
    const codes = JSON.parse(stored.code_candidates_json);
    expect(codes[0].value).toBe('091823');

    // Explicitly assert that attachment contents/metadata are NOT saved into any D1 column
    expect(stored.text_body).not.toContain(attachmentBinary);
    expect(stored.text_body).not.toContain('image/png');
    expect(stored.text_body).not.toContain('invoice.png');
    if (stored.html_body) {
      expect(stored.html_body).not.toContain(attachmentBinary);
      expect(stored.html_body).not.toContain('invoice.png');
    }

    // Inspect all string fields in D1 record to ensure zero leakage of attachment payload
    for (const [_key, value] of Object.entries(stored)) {
      if (typeof value === 'string') {
        expect(value).not.toContain(attachmentBinary);
      }
    }
  });

  it('stores receivedAt as service time and expiresAt as receivedAt + 7 days', async () => {
    const db = createMockD1Database() as D1Database & { _records: Map<string, MessageRecord> };
    const beforeCall = Date.now();

    const msg = createMockEmailMessage({
      to: 'user@cottage.dpdns.org',
      rawContent: VALID_EMAIL_MIME,
    });
    await worker.email(msg, { DB: db }, {} as ExecutionContext);

    const afterCall = Date.now();
    expect(db._records.size).toBe(1);
    const stored = Array.from(db._records.values())[0];

    expect(stored.received_at).toBeGreaterThanOrEqual(beforeCall);
    expect(stored.received_at).toBeLessThanOrEqual(afterCall);
    expect(stored.expires_at).toBe(stored.received_at + MESSAGE_RETENTION_MS);
    expect(stored.expires_at - stored.received_at).toBe(604_800_000);
  });

  it('propagates D1 insert error so Cloudflare platform can record failure or retry', async () => {
    const faultyDb = {
      prepare() {
        return {
          bind() {
            return {
              async run() {
                throw new Error('D1 storage connection failure');
              },
            };
          },
        };
      },
    } as unknown as D1Database;

    const msg = createMockEmailMessage({
      to: 'user@cottage.dpdns.org',
      rawContent: VALID_EMAIL_MIME,
    });

    await expect(worker.email(msg, { DB: faultyDb }, {} as ExecutionContext)).rejects.toThrow(
      'D1 storage connection failure',
    );
    // Did not silently reject
    expect(msg.getRejectedReason()).toBe('');
  });
});

describe('Inbound Worker: Cron Expiration Cleanup', () => {
  it('deletes expired messages while keeping unexpired messages intact', async () => {
    const db = createMockD1Database() as D1Database & { _records: Map<string, MessageRecord> };
    const now = Date.now();

    // Expired 5 minutes ago
    db._records.set('expired-1', {
      id: 'expired-1',
      address: 'user@cottage.dpdns.org',
      envelope_from: null,
      from_name: '',
      from_address: null,
      from_domain: null,
      subject: 'Old',
      text_body: '',
      text_truncated: 0,
      html_body: null,
      html_status: 'not_present',
      code_candidates_json: '[]',
      links_json: '[]',
      dmarc_pass: 1,
      size_bytes: 100,
      expires_at: now - 300_000,
      received_at: now - 604_800_000 - 300_000,
    });

    // Valid for another 2 days
    db._records.set('valid-1', {
      id: 'valid-1',
      address: 'user@cottage.dpdns.org',
      envelope_from: null,
      from_name: '',
      from_address: null,
      from_domain: null,
      subject: 'New',
      text_body: '',
      text_truncated: 0,
      html_body: null,
      html_status: 'not_present',
      code_candidates_json: '[]',
      links_json: '[]',
      dmarc_pass: 1,
      size_bytes: 100,
      expires_at: now + 172_800_000,
      received_at: now + 172_800_000 - 604_800_000,
    });

    await worker.scheduled({} as ScheduledEvent, { DB: db }, {} as ExecutionContext);

    expect(db._records.has('expired-1')).toBe(false);
    expect(db._records.has('valid-1')).toBe(true);
  });

  it('deletes expired messages in batches up to maxTotalDelete limit', async () => {
    const db = createMockD1Database() as D1Database & { _records: Map<string, MessageRecord> };
    const now = Date.now();

    // Insert 250 expired records
    for (let i = 0; i < 250; i++) {
      const id = `expired-${i}`;
      db._records.set(id, {
        id,
        address: 'user@cottage.dpdns.org',
        envelope_from: null,
        from_name: '',
        from_address: null,
        from_domain: null,
        subject: `Msg ${i}`,
        text_body: '',
        text_truncated: 0,
        html_body: null,
        html_status: 'not_present',
        code_candidates_json: '[]',
        links_json: '[]',
        dmarc_pass: 1,
        size_bytes: 50,
        expires_at: now - 1000,
        received_at: now - 604_801_000,
      });
    }

    expect(db._records.size).toBe(250);

    // Call scheduled handler (batchSize=100, should do 3 iterations: 100, 100, 50)
    await worker.scheduled({} as ScheduledEvent, { DB: db }, {} as ExecutionContext);

    expect(db._records.size).toBe(0);
  });

  it('respects total cap when expired records exceed maxTotalDelete', async () => {
    const db = createMockD1Database() as D1Database & { _records: Map<string, MessageRecord> };
    const now = Date.now();

    // Insert 1200 expired records (exceeds default cap of 1000)
    for (let i = 0; i < 1200; i++) {
      const id = `bulk-${i}`;
      db._records.set(id, {
        id,
        address: 'user@cottage.dpdns.org',
        envelope_from: null,
        from_name: '',
        from_address: null,
        from_domain: null,
        subject: `Bulk ${i}`,
        text_body: '',
        text_truncated: 0,
        html_body: null,
        html_status: 'not_present',
        code_candidates_json: '[]',
        links_json: '[]',
        dmarc_pass: 1,
        size_bytes: 50,
        expires_at: now - 1000,
        received_at: now - 604_801_000,
      });
    }

    await worker.scheduled({} as ScheduledEvent, { DB: db }, {} as ExecutionContext);

    // Default maxTotalDelete is 1000, so exactly 200 should remain for next cron run
    expect(db._records.size).toBe(200);
  });
});
