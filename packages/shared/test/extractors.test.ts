import { describe, expect, it } from 'vitest';
import { extractCodeCandidates } from '../src/extractor/codes.js';
import { extractLinks } from '../src/extractor/links.js';
import { generatePreview, htmlToPlainText } from '../src/extractor/text.js';

describe('Extractors', () => {
  describe('Verification Code Extraction', () => {
    it('preserves leading zeros on codes', () => {
      const subject = 'Your verification code is 012345';
      const body = 'Please use code 009876 to login.';

      const candidates = extractCodeCandidates(subject, body);
      expect(candidates.length).toBe(2);

      expect(candidates[0].value).toBe('012345');
      expect(candidates[0].source).toBe('subject');
      expect(candidates[0].context).toContain('012345');

      expect(candidates[1].value).toBe('009876');
      expect(candidates[1].source).toBe('textBody');
      expect(candidates[1].context).toContain('009876');
    });

    it('processes subject before textBody and deduplicates case-sensitively', () => {
      const subject = 'Code: 987654';
      const body = 'Your code is 987654. Another code is ABCD99.';

      const candidates = extractCodeCandidates(subject, body);
      expect(candidates.length).toBe(2);
      expect(candidates[0].value).toBe('987654');
      expect(candidates[0].source).toBe('subject');
      expect(candidates[1].value).toBe('ABCD99');
      expect(candidates[1].source).toBe('textBody');
    });

    it('limits candidates to 10 and max context 160 code points', () => {
      const longBody = Array.from({ length: 20 }, (_, i) => `Code ${1000 + i}`).join(' ');
      const candidates = extractCodeCandidates('Subject', longBody);

      expect(candidates.length).toBeLessThanOrEqual(10);
      for (const c of candidates) {
        expect(Array.from(c.context).length).toBeLessThanOrEqual(160);
      }
    });
  });

  describe('Link Extraction', () => {
    it('extracts HTTPS links from HTML in DOM order followed by textBody', () => {
      const html = `
        <div>
          <a href="https://example.com/verify?token=1">Verify Account</a>
          <a href="https://example.com/help">Help Center</a>
        </div>
      `;
      const text = 'Or visit https://example.com/terms for terms. Also https://example.com/help';

      const links = extractLinks(html, text);
      expect(links.length).toBe(3);

      expect(links[0].url).toBe('https://example.com/verify?token=1');
      expect(links[0].text).toBe('Verify Account');
      expect(links[0].host).toBe('example.com');

      expect(links[1].url).toBe('https://example.com/help');
      expect(links[1].text).toBe('Help Center');

      expect(links[2].url).toBe('https://example.com/terms');
      expect(links[2].text).toBe('');
      expect(links[2].host).toBe('example.com');
    });

    it('rejects non-https, credentials, and caps at 20', () => {
      const text = 'Visit http://plain.com and https://user:pass@evil.com and https://safe.com';
      const links = extractLinks(null, text);

      expect(links.length).toBe(1);
      expect(links[0].url).toBe('https://safe.com/');
    });
  });

  describe('Text and Preview Extraction', () => {
    it('collapses whitespace and limits preview to 200 code points', () => {
      const rawText = 'Line 1\n\n   Line 2\t\tLine 3   ' + '😊'.repeat(300);
      const preview = generatePreview(rawText, 200);

      expect(preview.startsWith('Line 1 Line 2 Line 3')).toBe(true);
      expect(Array.from(preview).length).toBe(200);
    });

    it('converts HTML to plain text with proper block spacing', () => {
      const html = '<p>Paragraph 1</p><p>Paragraph 2</p><br/><div>Div content</div>';
      const text = htmlToPlainText(html);

      expect(text).toContain('Paragraph 1');
      expect(text).toContain('Paragraph 2');
      expect(text).toContain('Div content');
    });
  });
});
