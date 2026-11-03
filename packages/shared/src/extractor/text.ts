import { parseFragment } from 'parse5';

interface AstNode {
  nodeName: string;
  tagName?: string;
  childNodes?: AstNode[];
  value?: string;
}

const BLOCK_TAGS = new Set([
  'p',
  'div',
  'h1',
  'h2',
  'h3',
  'h4',
  'h5',
  'h6',
  'li',
  'tr',
  'br',
  'hr',
  'blockquote',
  'header',
  'footer',
  'section',
  'article',
]);

const IGNORED_TAGS = new Set(['script', 'style', 'head', 'noscript']);

function extractTextFromNode(node: AstNode, chunks: string[]): void {
  if (node.nodeName === '#text') {
    if (node.value) {
      chunks.push(node.value);
    }
    return;
  }

  const tagName = node.tagName?.toLowerCase();
  if (tagName && IGNORED_TAGS.has(tagName)) {
    return;
  }

  const isBlock = tagName && BLOCK_TAGS.has(tagName);
  if (isBlock && chunks.length > 0 && !chunks[chunks.length - 1].endsWith('\n')) {
    chunks.push('\n');
  }

  if (node.childNodes) {
    for (const child of node.childNodes) {
      extractTextFromNode(child, chunks);
    }
  }

  if (isBlock && chunks.length > 0 && !chunks[chunks.length - 1].endsWith('\n')) {
    chunks.push('\n');
  }
}

/**
 * Extracts plain text from an HTML fragment with sensible spacing for block elements.
 */
export function htmlToPlainText(html: string): string {
  if (!html || !html.trim()) return '';

  try {
    const fragment = parseFragment(html) as unknown as AstNode;
    const chunks: string[] = [];

    for (const child of fragment.childNodes || []) {
      extractTextFromNode(child, chunks);
    }

    return chunks.join('').replace(/\r\n/g, '\n').replace(/\r/g, '\n').trim();
  } catch {
    return '';
  }
}

/**
 * Generates preview text by collapsing all whitespace into a single space
 * and taking the first 200 Unicode code points.
 */
export function generatePreview(text: string, maxCodePoints = 200): string {
  if (!text) return '';

  const collapsed = text.replace(/\s+/g, ' ').trim();
  const codePoints = Array.from(collapsed);

  return codePoints.slice(0, maxCodePoints).join('');
}

/**
 * Truncates text body to max characters if needed.
 */
export function truncateTextBody(
  text: string,
  maxChars: number,
): { text: string; truncated: boolean } {
  if (!text) {
    return { text: '', truncated: false };
  }

  const codePoints = Array.from(text);
  if (codePoints.length <= maxChars) {
    return { text, truncated: false };
  }

  return {
    text: codePoints.slice(0, maxChars).join(''),
    truncated: true,
  };
}
