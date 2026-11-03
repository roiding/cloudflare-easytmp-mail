import React, { useMemo } from 'react';

interface SandboxIframeProps {
  htmlBody: string;
  title?: string;
}

export const SandboxIframe: React.FC<SandboxIframeProps> = ({ htmlBody, title = '邮件正文' }) => {
  const wrappedSrcDoc = useMemo(() => {
    // Strictly isolate email content with sandbox CSP:
    // Block all remote images, external network connections, scripts, fonts, and sub-frames.
    const csp =
      "default-src 'none'; style-src 'unsafe-inline'; font-src 'none'; img-src data:; base-uri 'none'; form-action 'none'; connect-src 'none'; media-src 'none'; object-src 'none'; frame-src 'none';";

    const baseCss = `
      html, body {
        margin: 0;
        padding: 16px;
        font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, "Helvetica Neue", Arial, sans-serif;
        font-size: 14px;
        line-height: 1.6;
        color: #1f2937;
        background-color: #ffffff;
        word-wrap: break-word;
        overflow-wrap: break-word;
        box-sizing: border-box;
      }
      *, *:before, *:after {
        box-sizing: inherit;
      }
      img {
        max-width: 100%;
        height: auto;
      }
      a {
        color: #00a884;
        text-decoration: underline;
      }
      table {
        max-width: 100%;
        border-collapse: collapse;
      }
      pre, code {
        font-family: ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace;
        white-space: pre-wrap;
      }
    `;

    return `<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <meta http-equiv="Content-Security-Policy" content="${csp}">
  <base target="_blank">
  <style>${baseCss}</style>
</head>
<body>
  ${htmlBody}
</body>
</html>`;
  }, [htmlBody]);

  return (
    <iframe
      title={title}
      srcDoc={wrappedSrcDoc}
      sandbox="allow-popups allow-popups-to-escape-sandbox"
      className="sandbox-iframe"
      style={{
        width: '100%',
        minHeight: '380px',
        border: '1px solid #e5e7eb',
        borderRadius: '8px',
        backgroundColor: '#ffffff',
      }}
    />
  );
};
