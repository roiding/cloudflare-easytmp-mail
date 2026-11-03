import { parseFragment, serialize, type DefaultTreeAdapterMap } from 'parse5';
import { HtmlStatus, MAX_HTML_BYTES } from '../types/index.js';

export interface SanitizeHtmlResult {
  htmlStatus: HtmlStatus;
  htmlBody: string | null;
}

// These tags drop their entire subtree
const DROP_SUBTREE_TAGS = new Set([
  'script',
  'iframe',
  'frame',
  'frameset',
  'object',
  'embed',
  'applet',
  'meta',
  'link',
  'base',
  'noscript',
  'svg',
  'math',
  'audio',
  'video',
  'source',
  'track',
  'canvas',
  'dialog',
  'img', // External resources not stored/loaded per spec
  'input',
  'button',
  'select',
  'textarea',
  'optgroup',
  'option',
]);

// Tags that should be unwrapped (drop the tag itself, but preserve cleaned children)
const UNWRAP_TAGS = new Set([
  'form',
  'fieldset',
  'legend',
  'center',
  'font',
  'blink',
  'marquee',
  'details',
  'summary',
]);

const ALLOWED_TAGS = new Set([
  // Layout & structural
  'div',
  'p',
  'span',
  'hr',
  'br',
  'pre',
  'blockquote',
  'address',
  'article',
  'section',
  'header',
  'footer',
  'main',
  // Headings
  'h1',
  'h2',
  'h3',
  'h4',
  'h5',
  'h6',
  // Formatting & typography
  'strong',
  'b',
  'em',
  'i',
  'u',
  's',
  'strike',
  'del',
  'sub',
  'sup',
  'small',
  'mark',
  'code',
  'kbd',
  'samp',
  'var',
  'time',
  // Lists
  'ul',
  'ol',
  'li',
  'dl',
  'dt',
  'dd',
  // Tables
  'table',
  'thead',
  'tbody',
  'tfoot',
  'tr',
  'th',
  'td',
  'caption',
  'colgroup',
  'col',
  // Links
  'a',
  // Styles
  'style',
]);

const ALLOWED_STYLE_PROPERTIES = new Set([
  'color',
  'background',
  'background-color',
  'font-family',
  'font-size',
  'font-weight',
  'font-style',
  'line-height',
  'letter-spacing',
  'text-align',
  'text-decoration',
  'text-transform',
  'text-indent',
  'padding',
  'padding-top',
  'padding-bottom',
  'padding-left',
  'padding-right',
  'margin',
  'margin-top',
  'margin-bottom',
  'margin-left',
  'margin-right',
  'border',
  'border-top',
  'border-bottom',
  'border-left',
  'border-right',
  'border-radius',
  'border-color',
  'border-width',
  'border-style',
  'border-collapse',
  'border-spacing',
  'width',
  'height',
  'max-width',
  'max-height',
  'min-width',
  'min-height',
  'display',
  'vertical-align',
  'box-sizing',
  'word-break',
  'overflow-wrap',
  'word-wrap',
  'white-space',
  'list-style',
  'list-style-type',
  'table-layout',
]);

function sanitizeCssValue(value: string): boolean {
  const lower = value.toLowerCase();
  if (
    lower.includes('url(') ||
    lower.includes('@import') ||
    lower.includes('expression(') ||
    lower.includes('javascript:') ||
    lower.includes('behavior') ||
    lower.includes('-moz-binding') ||
    lower.includes('vbscript:') ||
    lower.includes('data:')
  ) {
    return false;
  }
  return true;
}

function sanitizeInlineStyle(styleText: string): string {
  const declarations = styleText.split(';');
  const safeDeclarations: string[] = [];

  for (const decl of declarations) {
    const colonIndex = decl.indexOf(':');
    if (colonIndex === -1) continue;

    const property = decl.slice(0, colonIndex).trim().toLowerCase();
    const value = decl.slice(colonIndex + 1).trim();

    if (!ALLOWED_STYLE_PROPERTIES.has(property)) continue;
    if (!sanitizeCssValue(value)) continue;

    safeDeclarations.push(`${property}: ${value}`);
  }

  return safeDeclarations.join('; ');
}

function sanitizeStyleTagText(cssText: string): string {
  const cleaned = cssText
    .replace(/@import\s+[^;]+;?/gi, '')
    .replace(/url\([^)]*\)/gi, 'none')
    .replace(/expression\([^)]*\)/gi, 'none')
    .replace(/behavior\s*:[^;]+;?/gi, '')
    .replace(/-moz-binding\s*:[^;]+;?/gi, '');

  return cleaned.trim();
}

function isValidHttpsUrl(rawUrl: string): boolean {
  try {
    const trimmed = rawUrl.trim();
    if (!trimmed.toLowerCase().startsWith('https://')) return false;

    const parsed = new URL(trimmed);
    if (parsed.protocol !== 'https:') return false;
    if (parsed.username || parsed.password) return false;

    return true;
  } catch {
    return false;
  }
}

interface AstNode {
  nodeName: string;
  tagName?: string;
  attrs?: Array<{ name: string; value: string }>;
  childNodes?: AstNode[];
  value?: string;
}

function cleanNode(node: AstNode): AstNode[] {
  // 1. Text node
  if (node.nodeName === '#text') {
    return [node];
  }

  // 2. Comments - drop
  if (node.nodeName === '#comment') {
    return [];
  }

  const tagName = node.tagName?.toLowerCase() || '';

  // 3. Disallowed tags - completely drop tag and its children
  if (DROP_SUBTREE_TAGS.has(tagName)) {
    return [];
  }

  // 4. Style tag text sanitization
  if (tagName === 'style') {
    const cleanedCss = sanitizeStyleTagText(
      (node.childNodes || []).map((c) => c.value || '').join(''),
    );
    if (!cleanedCss) {
      return [];
    }
    return [
      {
        nodeName: 'style',
        tagName: 'style',
        attrs: [],
        childNodes: [{ nodeName: '#text', value: cleanedCss }],
      },
    ];
  }

  // Recursively clean children
  const cleanedChildren: AstNode[] = [];
  if (node.childNodes) {
    for (const child of node.childNodes) {
      cleanedChildren.push(...cleanNode(child));
    }
  }

  // 5. Unwrapped or unknown tags - drop the tag wrapper, preserve cleaned children
  if (UNWRAP_TAGS.has(tagName) || !ALLOWED_TAGS.has(tagName)) {
    return cleanedChildren;
  }

  // 6. Whitelisted tags - sanitize attributes
  const safeAttrs: Array<{ name: string; value: string }> = [];
  const rawAttrs = node.attrs || [];

  if (tagName === 'a') {
    let hrefValue: string | null = null;
    let titleValue: string | null = null;

    for (const attr of rawAttrs) {
      const attrName = attr.name.toLowerCase();
      if (attrName === 'href' && isValidHttpsUrl(attr.value)) {
        hrefValue = attr.value.trim();
      } else if (attrName === 'title') {
        titleValue = attr.value;
      }
    }

    if (!hrefValue) {
      // If href is not a valid HTTPS URL, unwrap the link so text is preserved
      return cleanedChildren;
    }

    safeAttrs.push({ name: 'href', value: hrefValue });
    safeAttrs.push({ name: 'target', value: '_blank' });
    safeAttrs.push({ name: 'rel', value: 'noopener noreferrer' });
    if (titleValue) {
      safeAttrs.push({ name: 'title', value: titleValue });
    }
  } else {
    for (const attr of rawAttrs) {
      const attrName = attr.name.toLowerCase();

      // Reject all event handlers
      if (attrName.startsWith('on')) continue;

      if (attrName === 'style') {
        const cleanStyle = sanitizeInlineStyle(attr.value);
        if (cleanStyle) {
          safeAttrs.push({ name: 'style', value: cleanStyle });
        }
      } else if (
        attrName === 'class' ||
        attrName === 'id' ||
        attrName === 'dir' ||
        attrName === 'lang' ||
        attrName === 'title'
      ) {
        safeAttrs.push({ name: attrName, value: attr.value });
      } else if (
        tagName === 'table' ||
        tagName === 'td' ||
        tagName === 'th' ||
        tagName === 'tr' ||
        tagName === 'colgroup' ||
        tagName === 'col'
      ) {
        if (
          attrName === 'border' ||
          attrName === 'cellpadding' ||
          attrName === 'cellspacing' ||
          attrName === 'width' ||
          attrName === 'height' ||
          attrName === 'align' ||
          attrName === 'valign' ||
          attrName === 'bgcolor' ||
          attrName === 'colspan' ||
          attrName === 'rowspan'
        ) {
          safeAttrs.push({ name: attrName, value: attr.value });
        }
      }
    }
  }

  return [
    {
      ...node,
      attrs: safeAttrs,
      childNodes: cleanedChildren,
    },
  ];
}

export function sanitizeHtml(
  rawHtml: string | null | undefined,
  maxHtmlBytes: number = MAX_HTML_BYTES,
): SanitizeHtmlResult {
  if (rawHtml === null || rawHtml === undefined || rawHtml.trim() === '') {
    return {
      htmlStatus: 'not_present',
      htmlBody: null,
    };
  }

  try {
    const fragment = parseFragment(rawHtml) as unknown as AstNode;
    const cleanedChildren: AstNode[] = [];

    for (const child of fragment.childNodes || []) {
      cleanedChildren.push(...cleanNode(child));
    }

    const cleanFragment: AstNode = {
      nodeName: '#document-fragment',
      childNodes: cleanedChildren,
    };

    const serialized = serialize(cleanFragment as unknown as DefaultTreeAdapterMap['parentNode']);
    const byteLength = new TextEncoder().encode(serialized).byteLength;

    if (byteLength > maxHtmlBytes) {
      return {
        htmlStatus: 'too_large',
        htmlBody: null,
      };
    }

    if (serialized.trim() === '') {
      return {
        htmlStatus: 'not_present',
        htmlBody: null,
      };
    }

    return {
      htmlStatus: 'available',
      htmlBody: serialized,
    };
  } catch {
    return {
      htmlStatus: 'unavailable',
      htmlBody: null,
    };
  }
}
