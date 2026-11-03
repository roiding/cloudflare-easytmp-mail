import { describe, expect, it } from 'vitest';
import { sanitizeHtml } from '../src/sanitizer/html.js';

describe('HTML Sanitizer', () => {
  it('strips script tags and executable content', () => {
    const dangerous = '<div>Hello<script>alert(1)</script><p>World</p></div>';
    const result = sanitizeHtml(dangerous);

    expect(result.htmlStatus).toBe('available');
    expect(result.htmlBody).not.toContain('script');
    expect(result.htmlBody).not.toContain('alert');
    expect(result.htmlBody).toContain('Hello');
    expect(result.htmlBody).toContain('World');
  });

  it('strips iframes, forms, and objects', () => {
    const input =
      '<form action="https://evil.com"><input type="text"><iframe src="https://evil.com"></iframe><object data="test"></object><p>Safe content</p></form>';
    const result = sanitizeHtml(input);

    expect(result.htmlStatus).toBe('available');
    expect(result.htmlBody).not.toContain('iframe');
    expect(result.htmlBody).not.toContain('form');
    expect(result.htmlBody).not.toContain('input');
    expect(result.htmlBody).not.toContain('object');
    expect(result.htmlBody).toContain('Safe content');
  });

  it('strips event handlers (onclick, onerror, onload, etc.)', () => {
    const input = '<div onclick="steal()" onmouseover="boom()" onerror="bad()"><p>Text</p></div>';
    const result = sanitizeHtml(input);

    expect(result.htmlStatus).toBe('available');
    expect(result.htmlBody).not.toContain('onclick');
    expect(result.htmlBody).not.toContain('onmouseover');
    expect(result.htmlBody).not.toContain('onerror');
  });

  it('preserves valid HTTPS links and sets target="_blank" rel="noopener noreferrer"', () => {
    const input = '<a href="https://example.com/verify?token=123" title="Verify Email">Verify</a>';
    const result = sanitizeHtml(input);

    expect(result.htmlStatus).toBe('available');
    expect(result.htmlBody).toContain('href="https://example.com/verify?token=123"');
    expect(result.htmlBody).toContain('target="_blank"');
    expect(result.htmlBody).toContain('rel="noopener noreferrer"');
    expect(result.htmlBody).toContain('title="Verify Email"');
  });

  it('rejects http, javascript, data URLs in links', () => {
    const input =
      '<a href="http://insecure.com">Insecure</a><a href="javascript:alert(1)">JS</a><a href="https://user:pass@example.com">Auth</a><p>Keep</p>';
    const result = sanitizeHtml(input);

    expect(result.htmlStatus).toBe('available');
    expect(result.htmlBody).not.toContain('http://insecure.com');
    expect(result.htmlBody).not.toContain('javascript:');
    expect(result.htmlBody).not.toContain('user:pass@');
    // Link text should be preserved even if link tag was unwrapped
    expect(result.htmlBody).toContain('Insecure');
    expect(result.htmlBody).toContain('JS');
  });

  it('preserves tables and basic typography with safe styling', () => {
    const input = `
      <table border="1" cellpadding="5">
        <thead><tr><th>Header</th></tr></thead>
        <tbody>
          <tr><td style="color: red; padding: 10px; background-color: #fff">Cell</td></tr>
        </tbody>
      </table>
    `;
    const result = sanitizeHtml(input);

    expect(result.htmlStatus).toBe('available');
    expect(result.htmlBody).toContain('<table');
    expect(result.htmlBody).toContain('<th');
    expect(result.htmlBody).toContain('<td');
    expect(result.htmlBody).toContain('color: red');
    expect(result.htmlBody).toContain('background-color: #fff');
  });

  it('strips url() and @import from styles', () => {
    const input =
      '<div style="background: url(\'https://tracker.com/p.png\'); color: blue">Test</div>';
    const result = sanitizeHtml(input);

    expect(result.htmlStatus).toBe('available');
    expect(result.htmlBody).not.toContain('tracker.com');
    expect(result.htmlBody).toContain('color: blue');
  });

  it('returns too_large when HTML exceeds byte limit', () => {
    const hugeHtml = '<p>' + 'A'.repeat(500) + '</p>';
    const result = sanitizeHtml(hugeHtml, 200);

    expect(result.htmlStatus).toBe('too_large');
    expect(result.htmlBody).toBeNull();
  });

  it('returns not_present for empty or null HTML', () => {
    expect(sanitizeHtml(null).htmlStatus).toBe('not_present');
    expect(sanitizeHtml('').htmlStatus).toBe('not_present');
    expect(sanitizeHtml('   ').htmlStatus).toBe('not_present');
  });
});
