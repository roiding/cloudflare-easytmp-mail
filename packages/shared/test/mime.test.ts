import { describe, expect, it } from 'vitest';
import {
  checkDmarcPassFromHeaders,
  parseRawEmail,
  parseRawHeaders,
  verifyCloudflareDmarc,
} from '../src/mime/parser.js';

describe('MIME Email Parsing & Strict Cloudflare DMARC Security', () => {
  it('parses multipart email with text, HTML, sender and Cloudflare DMARC header', async () => {
    const raw = `From: "Acme Service" <support@acme.com>
To: user@cottage.dpdns.org
Subject: Verify your email: 049281
Authentication-Results: mx.cloudflare.net; dmarc=pass header.from=acme.com
Return-Path: <bounces@acme.com>
Content-Type: multipart/alternative; boundary="BOUNDARY"

--BOUNDARY
Content-Type: text/plain; charset=utf-8

Please verify your email using code 049281.
Or visit https://acme.com/confirm

--BOUNDARY
Content-Type: text/html; charset=utf-8

<p>Please verify your email using code <b>049281</b>.</p>
<a href="https://acme.com/confirm" target="_blank">Confirm Now</a>
<script>alert("evil")</script>

--BOUNDARY--`;

    const result = await parseRawEmail(raw);

    // Sender
    expect(result.from.name).toBe('Acme Service');
    expect(result.from.address).toBe('support@acme.com');
    expect(result.from.domain).toBe('acme.com');
    expect(result.envelopeFrom).toBe('bounces@acme.com');

    // Subject
    expect(result.subject).toBe('Verify your email: 049281');

    // DMARC
    expect(result.dmarcPass).toBe(true);

    // Text & Preview
    expect(result.textBody).toContain('049281');
    expect(result.textTruncated).toBe(false);
    expect(result.preview).toContain('Please verify your email');

    // HTML sanitization
    expect(result.htmlStatus).toBe('available');
    expect(result.htmlBody).toContain('Confirm Now');
    expect(result.htmlBody).not.toContain('script');

    // Code candidate with leading zero preserved
    expect(result.codeCandidates.length).toBeGreaterThanOrEqual(1);
    expect(result.codeCandidates[0].value).toBe('049281');

    // Links
    expect(result.links.length).toBeGreaterThanOrEqual(1);
    expect(result.links[0].url).toBe('https://acme.com/confirm');
    expect(result.links[0].text).toBe('Confirm Now');
  });

  it('falls back to extracting text from HTML when plain text part is missing', async () => {
    const raw = `From: no-reply@example.com
To: user@cottage.dpdns.org
Subject: Notification
Content-Type: text/html; charset=utf-8

<p>This email has <strong>HTML only</strong> with code 883921.</p>`;

    const result = await parseRawEmail(raw);

    expect(result.textBody).toContain('This email has HTML only with code 883921.');
    expect(result.codeCandidates[0].value).toBe('883921');
    expect(result.htmlStatus).toBe('available');
  });

  // Attack test 1a: First Authentication-Results header is forged by attacker MTA (attacker.com)
  it('rejects forged first Authentication-Results from attacker.com even if dmarc=pass', async () => {
    const raw = `From: attacker@evil.com
To: user@cottage.dpdns.org
Subject: Phishing Attack
Authentication-Results: attacker.com; dmarc=pass header.from=evil.com
Authentication-Results: mx.cloudflare.net; dmarc=pass
Content-Type: text/plain

Fake email`;

    const headers = parseRawHeaders(raw);
    expect(verifyCloudflareDmarc(headers)).toBe(false);
    expect(checkDmarcPassFromHeaders(headers)).toBe(false);

    const parsed = await parseRawEmail(raw);
    expect(parsed.dmarcPass).toBe(false);
  });

  // Attack test 1b: First Authentication-Results header uses deceptive subdomain suffix (mx.cloudflare.net.evil.example)
  it('rejects deceptive authserv-id like mx.cloudflare.net.evil.example even if dmarc=pass', async () => {
    const raw = `From: attacker@evil.example
To: user@cottage.dpdns.org
Subject: Subdomain Spoofing
Authentication-Results: mx.cloudflare.net.evil.example; dmarc=pass header.from=evil.example
Authentication-Results: mx.cloudflare.net; dmarc=pass
Content-Type: text/plain

Subdomain spoof email`;

    const headers = parseRawHeaders(raw);
    expect(verifyCloudflareDmarc(headers)).toBe(false);
    expect(checkDmarcPassFromHeaders(headers)).toBe(false);

    const parsed = await parseRawEmail(raw);
    expect(parsed.dmarcPass).toBe(false);
  });

  // Attack test 1c: Old cloudflare.com authserv-id is strictly rejected
  it('rejects legacy or non-matching mx.cloudflare.com authserv-id', async () => {
    const raw = `From: user@example.com
To: user@cottage.dpdns.org
Subject: Legacy Authserv-id
Authentication-Results: mx.cloudflare.com; dmarc=pass header.from=example.com
Content-Type: text/plain

Legacy domain email`;

    const headers = parseRawHeaders(raw);
    expect(verifyCloudflareDmarc(headers)).toBe(false);
    expect(checkDmarcPassFromHeaders(headers)).toBe(false);

    const parsed = await parseRawEmail(raw);
    expect(parsed.dmarcPass).toBe(false);
  });

  // Attack test 2: Cloudflare MTA evaluates fail, but sender injected a second forged pass header
  it('rejects when Cloudflare first header is dmarc=fail even if followed by forged dmarc=pass', async () => {
    const raw = `From: attacker@spoofed.com
To: user@cottage.dpdns.org
Subject: Spoofing Attempt
Authentication-Results: mx.cloudflare.net; dmarc=fail (p=reject) header.from=spoofed.com
Authentication-Results: mx.cloudflare.net; dmarc=pass header.from=spoofed.com
Content-Type: text/plain

Spoofed email body`;

    const headers = parseRawHeaders(raw);
    expect(verifyCloudflareDmarc(headers)).toBe(false);
    expect(checkDmarcPassFromHeaders(headers)).toBe(false);

    const parsed = await parseRawEmail(raw);
    expect(parsed.dmarcPass).toBe(false);
  });

  // Attack test 3: Forged Cloudflare Authentication-Results header inside email body
  it('rejects forged Cloudflare pass header located inside the email body', async () => {
    const raw = `From: sender@unknown.com
To: user@cottage.dpdns.org
Subject: Normal Email
Return-Path: <bounce@unknown.com>
Content-Type: text/plain

Here is the body.
Authentication-Results: mx.cloudflare.net; dmarc=pass header.from=unknown.com
Some more body text.`;

    const headers = parseRawHeaders(raw);
    expect(verifyCloudflareDmarc(headers)).toBe(false);
    expect(checkDmarcPassFromHeaders(headers)).toBe(false);

    const parsed = await parseRawEmail(raw);
    expect(parsed.dmarcPass).toBe(false);
  });

  // Legitimate test: Legitimate Cloudflare MTA first header with dmarc=pass
  it('accepts legitimate first Cloudflare Authentication-Results header with dmarc=pass', async () => {
    const raw = `Authentication-Results: mx.cloudflare.net; dmarc=pass (p=reject sp=reject dis=none) header.from=legit.org
From: admin@legit.org
To: user@cottage.dpdns.org
Subject: Welcome
Content-Type: text/plain

Legit email content`;

    const headers = parseRawHeaders(raw);
    expect(verifyCloudflareDmarc(headers)).toBe(true);
    expect(checkDmarcPassFromHeaders(headers)).toBe(true);

    const parsed = await parseRawEmail(raw);
    expect(parsed.dmarcPass).toBe(true);
  });
});
