import React from 'react';
import type { MessageSummary } from '@easytmp/shared';
import { useClipboard } from '../hooks/useClipboard';
import { formatDateTime, formatRelativeTime } from '../utils/formatters';
import { IconCheck, IconCopy, IconShieldCheck } from './Icons';

interface MessageItemProps {
  message: MessageSummary;
  onClick: (id: string) => void;
}

export const MessageItem: React.FC<MessageItemProps> = ({ message, onClick }) => {
  const { copy, copiedText } = useClipboard(2000);

  const handleCopyCode = async (e: React.MouseEvent, codeValue: string) => {
    e.stopPropagation();
    await copy(codeValue);
  };

  const senderDisplay = message.from.name
    ? `${message.from.name} <${message.from.address || '未知地址'}>`
    : message.from.address || '未知发件人';

  const relativeTime = formatRelativeTime(message.receivedAt);
  const fullTime = formatDateTime(message.receivedAt);

  return (
    <article
      className="message-item"
      onClick={() => onClick(message.id)}
      role="button"
      tabIndex={0}
      onKeyDown={(e) => {
        if (e.key === 'Enter' || e.key === ' ') {
          e.preventDefault();
          onClick(message.id);
        }
      }}
      aria-label={`查看来自 ${message.from.name || message.from.address || '未知'} 的邮件：${message.subject || '无主题'}`}
    >
      <div className="message-item-header">
        <div className="sender-group">
          <span className="sender-name">{senderDisplay}</span>
          {message.dmarcPass && (
            <span className="dmarc-tag dmarc-pass" title="通过可信 Cloudflare DMARC 验证">
              <IconShieldCheck size={12} />
              <span>DMARC 通过</span>
            </span>
          )}
        </div>
        <time
          className="message-time"
          dateTime={new Date(message.receivedAt).toISOString()}
          title={fullTime}
        >
          {relativeTime}
        </time>
      </div>

      <div className="message-subject-row">
        <h3 className="message-subject">{message.subject || '(无主题)'}</h3>
        {message.hasHtml && <span className="format-tag">HTML</span>}
      </div>

      {message.codeCandidates && message.codeCandidates.length > 0 && (
        <div className="code-candidates-bar" onClick={(e) => e.stopPropagation()}>
          {message.codeCandidates.map((code) => {
            const isCopied = copiedText === code.value;
            return (
              <div key={code.value} className="code-badge-group">
                <span className="code-label">验证码</span>
                <span className="code-value">{code.value}</span>
                <button
                  type="button"
                  className={`btn-code-copy ${isCopied ? 'btn-copied' : ''}`}
                  onClick={(e) => handleCopyCode(e, code.value)}
                  aria-label={`复制验证码 ${code.value}`}
                  title="一键复制验证码"
                >
                  {isCopied ? (
                    <>
                      <IconCheck size={13} />
                      <span>已复制</span>
                    </>
                  ) : (
                    <>
                      <IconCopy size={13} />
                      <span>复制</span>
                    </>
                  )}
                </button>
              </div>
            );
          })}
        </div>
      )}

      {message.preview && <p className="message-preview">{message.preview}</p>}
    </article>
  );
};
