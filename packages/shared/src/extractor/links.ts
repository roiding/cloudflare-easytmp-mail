import { parseFragment } from 'parse5';
import { LinkCandidate, MAX_LINKS } from '../types/index.js';

interface AstNode {
  nodeName: string;
  tagName?: string;
  attrs?: Array<{ name: string; value: string }>;
  childNodes?: AstNode[];
  value?: string;
}

function getNodeText(node: AstNode): string {
  if (node.nodeName === '#text') {
    return node.value || '';
  }
  let text = '';
  if (node.childNodes) {
    for (const child of node.childNodes) {
      text += getNodeText(child);
    }
  }
  return text;
}

function normalizeHttpsUrl(rawUrl: string): { normalizedUrl: string; host: string } | null {
  try {
    const trimmed = rawUrl.trim();
    if (!trimmed.toLowerCase().startsWith('https://')) return null;

    const parsed = new URL(trimmed);
    if (parsed.protocol !== 'https:') return null;
    if (parsed.username || parsed.password) return null;

    return {
      normalizedUrl: parsed.href,
      host: parsed.hostname.toLowerCase(),
    };
  } catch {
    return null;
  }
}

function truncateText(text: string, maxCodePoints = 256): string {
  const collapsed = text.replace(/\s+/g, ' ').trim();
  const codePoints = Array.from(collapsed);
  return codePoints.slice(0, maxCodePoints).join('');
}

function collectHtmlLinks(
  node: AstNode,
  seenUrls: Map<string, LinkCandidate>,
  results: LinkCandidate[],
): void {
  if (results.length >= MAX_LINKS) return;

  const tagName = node.tagName?.toLowerCase();
  if (tagName === 'a' && node.attrs) {
    const hrefAttr = node.attrs.find((a) => a.name.toLowerCase() === 'href');
    if (hrefAttr) {
      const normalized = normalizeHttpsUrl(hrefAttr.value);
      if (normalized) {
        const linkText = truncateText(getNodeText(node));

        if (seenUrls.has(normalized.normalizedUrl)) {
          const existing = seenUrls.get(normalized.normalizedUrl)!;
          if (!existing.text && linkText) {
            existing.text = linkText;
          }
        } else {
          const candidate: LinkCandidate = {
            url: normalized.normalizedUrl,
            text: linkText,
            host: normalized.host,
          };
          seenUrls.set(normalized.normalizedUrl, candidate);
          results.push(candidate);
        }
      }
    }
  }

  if (node.childNodes) {
    for (const child of node.childNodes) {
      collectHtmlLinks(child, seenUrls, results);
    }
  }
}

const TEXT_URL_REGEX = /https:\/\/[^\s<>"'`]+/gi;

function collectTextLinks(
  text: string,
  seenUrls: Map<string, LinkCandidate>,
  results: LinkCandidate[],
): void {
  if (!text) return;

  let match: RegExpExecArray | null;
  while ((match = TEXT_URL_REGEX.exec(text)) !== null) {
    if (results.length >= MAX_LINKS) return;

    // Strip trailing punctuation often attached to URLs in prose (e.g. .,;:)
    let rawUrl = match[0];
    rawUrl = rawUrl.replace(/[.,;:!?]+$/, '');

    const normalized = normalizeHttpsUrl(rawUrl);
    if (!normalized) continue;

    if (!seenUrls.has(normalized.normalizedUrl)) {
      const candidate: LinkCandidate = {
        url: normalized.normalizedUrl,
        text: '',
        host: normalized.host,
      };
      seenUrls.set(normalized.normalizedUrl, candidate);
      results.push(candidate);
    }
  }
}

/**
 * Extracts HTTPS link candidates from cleaned HTML and plain text body.
 * DOM order from HTML first, followed by appearance order in text.
 * Deduplicated by normalized URL, preserving first non-empty text.
 * Max 20 links.
 */
export function extractLinks(
  htmlBody: string | null | undefined,
  textBody: string,
): LinkCandidate[] {
  const results: LinkCandidate[] = [];
  const seenUrls = new Map<string, LinkCandidate>();

  if (htmlBody) {
    try {
      const fragment = parseFragment(htmlBody) as unknown as AstNode;
      for (const child of fragment.childNodes || []) {
        collectHtmlLinks(child, seenUrls, results);
      }
    } catch {
      // Ignore HTML parse failure, continue with text
    }
  }

  collectTextLinks(textBody, seenUrls, results);

  return results.slice(0, MAX_LINKS);
}
