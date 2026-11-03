import React, { useState, useEffect } from 'react';
import type { MessageDetail as IMessageDetail } from '@easytmp/shared';
import { apiClient, ApiError } from '../api/client';
import { useClipboard } from '../hooks/useClipboard';
import { formatBytes, formatDateTime, formatExpiration } from '../utils/formatters';
import {
  IconAlert,
  IconCheck,
  IconClose,
  IconCopy,
  IconExternalLink,
  IconShieldCheck,
  IconTrash,
} from './Icons';
import { SandboxIframe } from './SandboxIframe';

interface MessageDetailProps {
  id: string;
  onClose: () => void;
  onDelete: (id: string) => Promise<boolean>;
}

export const MessageDetail: React.FC<MessageDetailProps> = ({ id, onClose, onDelete }) => {
  const [detail, setDetail] = useState<IMessageDetail | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [viewMode, setViewMode] = useState<'html' | 'text'>('html');
  const [isDeleting, setIsDeleting] = useState(false);

  const { copy, copiedText } = useClipboard(2000);

  useEffect(() => {
    let isMounted = true;
    const controller = new AbortController();

    async function load() {
      setIsLoading(true);
      setError(null);
      try {
        const res = await apiClient.getMessage(id, controller.signal);
        if (!isMounted) return;
        setDetail(res.message);
        if (res.message.htmlStatus === 'available' && res.message.htmlBody) {
          setViewMode('html');
        } else {
          setViewMode('text');
        }
      } catch (err: unknown) {
        if (!isMounted) return;
        if (err instanceof DOMException && err.name === 'AbortError') return;
        if (err instanceof ApiError) {
          if (err.status === 404) {
            setError('该邮件已被删除或已超过 7 天保留期');
          } else {
            setError(err.message);
          }
        } else {
          setError('加载邮件详情失败，请检查网络连接');
        }
      } finally {
        if (isMounted) {
          setIsLoading(false);
        }
      }
    }

    load();

    return () => {
      isMounted = false;
      controller.abort();
    };
  }, [id]);

  const handleDelete = async () => {
    const confirmed = window.confirm('确定要删除这封邮件吗？此操作不可恢复。');
    if (!confirmed) return;

    setIsDeleting(true);
    try {
      const deleted = await onDelete(id);
      if (deleted) {
        onClose();
      }
    } finally {
      setIsDeleting(false);
    }
  };

  return (
    <div
      className="detail-modal-overlay"
      role="dialog"
      aria-modal="true"
      aria-labelledby="detail-title"
    >
      <div className="detail-modal-container">
        {/* Detail Header */}
        <div className="detail-header">
          <div className="detail-title-wrapper">
            <button type="button" className="btn-back" onClick={onClose} aria-label="返回收件箱">
              ← 返回列表
            </button>
            <h2 id="detail-title" className="detail-subject">
              {detail?.subject || (isLoading ? '正在加载邮件...' : '(无主题)')}
            </h2>
          </div>

          <div className="detail-actions">
            <button
              type="button"
              className="btn btn-danger-outline"
              onClick={handleDelete}
              disabled={isLoading || isDeleting}
              title="彻底删除此封邮件"
            >
              <IconTrash size={16} />
              <span>{isDeleting ? '正在删除...' : '删除邮件'}</span>
            </button>
            <button type="button" className="btn-icon" onClick={onClose} aria-label="关闭详情窗口">
              <IconClose size={20} />
            </button>
          </div>
        </div>

        {/* Loading and Error states */}
        {isLoading && (
          <div className="detail-loading">
            <p>正在读取邮件内容...</p>
          </div>
        )}

        {error && (
          <div className="detail-error-box" role="alert">
            <IconAlert size={20} />
            <div className="error-content">
              <h4>读取失败</h4>
              <p>{error}</p>
            </div>
            <button type="button" className="btn btn-secondary" onClick={onClose}>
              返回收件箱
            </button>
          </div>
        )}

        {/* Detail Content Body */}
        {detail && !isLoading && (
          <div className="detail-body-scroll">
            {/* Metadata Card */}
            <section className="metadata-card" aria-label="邮件元数据">
              <div className="meta-grid">
                <div className="meta-item">
                  <span className="meta-label">发件人：</span>
                  <span className="meta-value">
                    {detail.from.name ? (
                      <>
                        <strong>{detail.from.name}</strong> &lt;{detail.from.address || '未知'}&gt;
                      </>
                    ) : (
                      detail.from.address || '未知发件人'
                    )}
                  </span>
                </div>

                <div className="meta-item">
                  <span className="meta-label">收件人：</span>
                  <span className="meta-value">{detail.address}</span>
                </div>

                <div className="meta-item">
                  <span className="meta-label">接收时间：</span>
                  <span className="meta-value">{formatDateTime(detail.receivedAt)}</span>
                </div>

                <div className="meta-item">
                  <span className="meta-label">到期时间：</span>
                  <span className="meta-value text-warning">
                    {formatExpiration(detail.expiresAt).formattedDate} (
                    {formatExpiration(detail.expiresAt).remainingText} · 保留 7 天)
                  </span>
                </div>

                <div className="meta-item">
                  <span className="meta-label">DMARC：</span>
                  <span className="meta-value">
                    {detail.dmarcPass ? (
                      <span className="dmarc-tag dmarc-pass">
                        <IconShieldCheck size={14} />
                        DMARC 验证通过
                      </span>
                    ) : (
                      <span className="dmarc-tag dmarc-fail">未通过验证或无标记</span>
                    )}
                  </span>
                </div>

                <div className="meta-item">
                  <span className="meta-label">邮件大小：</span>
                  <span className="meta-value">{formatBytes(detail.sizeBytes)}</span>
                </div>
              </div>
            </section>

            {/* Code Candidates Highlight */}
            {detail.codeCandidates && detail.codeCandidates.length > 0 && (
              <section className="code-candidates-section" aria-label="识别到的验证码">
                <h3 className="section-subtitle">识别到的验证码候选</h3>
                <div className="code-cards-grid">
                  {detail.codeCandidates.map((code) => {
                    const isCopied = copiedText === code.value;
                    return (
                      <div key={code.value} className="code-candidate-card">
                        <div className="code-value-row">
                          <span className="code-highlight">{code.value}</span>
                          <button
                            type="button"
                            className={`btn btn-copy-code ${isCopied ? 'btn-copied' : ''}`}
                            onClick={() => copy(code.value)}
                            aria-label={`复制验证码 ${code.value}`}
                          >
                            {isCopied ? (
                              <>
                                <IconCheck size={14} />
                                <span>已复制</span>
                              </>
                            ) : (
                              <>
                                <IconCopy size={14} />
                                <span>复制验证码</span>
                              </>
                            )}
                          </button>
                        </div>
                        {code.context && (
                          <p className="code-context-snippet">上下文：{code.context}</p>
                        )}
                        <span className="code-source-badge">
                          来源：{code.source === 'subject' ? '邮件主题' : '正文内容'}
                        </span>
                      </div>
                    );
                  })}
                </div>
              </section>
            )}

            {/* Extracted Links Section */}
            {detail.links && detail.links.length > 0 && (
              <section className="links-section" aria-label="提取到的安全链接">
                <h3 className="section-subtitle">提取到的链接 ({detail.links.length})</h3>
                <ul className="extracted-links-list">
                  {detail.links.map((link, idx) => (
                    <li key={idx} className="link-item">
                      <a
                        href={link.url}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="extracted-link"
                      >
                        <span className="link-text">{link.text || link.url}</span>
                        <IconExternalLink size={14} />
                      </a>
                      <span className="link-host-tag">{link.host}</span>
                    </li>
                  ))}
                </ul>
              </section>
            )}

            {/* Content Tabs & Viewport */}
            <section className="content-section" aria-label="邮件正文">
              <div className="content-toolbar">
                <div className="view-mode-tabs" role="tablist">
                  <button
                    type="button"
                    role="tab"
                    aria-selected={viewMode === 'html'}
                    className={`tab-btn ${viewMode === 'html' ? 'tab-active' : ''}`}
                    onClick={() => setViewMode('html')}
                    disabled={detail.htmlStatus !== 'available' || !detail.htmlBody}
                    title={
                      detail.htmlStatus === 'available'
                        ? '展示原邮件 HTML 排版'
                        : '本邮件无可用 HTML 正文'
                    }
                  >
                    HTML 排版 {detail.htmlStatus !== 'available' && '(不可用)'}
                  </button>
                  <button
                    type="button"
                    role="tab"
                    aria-selected={viewMode === 'text'}
                    className={`tab-btn ${viewMode === 'text' ? 'tab-active' : ''}`}
                    onClick={() => setViewMode('text')}
                  >
                    纯文本正文
                  </button>
                </div>

                <div className="security-notice">
                  <span>沙箱隔离保护 · 外部图片与脚本已拦截</span>
                </div>
              </div>

              <div className="content-container">
                {viewMode === 'html' && detail.htmlStatus === 'available' && detail.htmlBody ? (
                  <SandboxIframe htmlBody={detail.htmlBody} title={detail.subject || '邮件内容'} />
                ) : (
                  <div className="plain-text-viewport">
                    {detail.textTruncated && (
                      <div className="truncation-warning">
                        注意：纯文本正文已达到系统最大字符上限并被截断。
                      </div>
                    )}
                    <pre className="plain-text-body">
                      {detail.textBody || '(该邮件没有纯文本内容)'}
                    </pre>
                  </div>
                )}
              </div>
            </section>
          </div>
        )}
      </div>
    </div>
  );
};
