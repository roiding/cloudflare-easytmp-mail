import React from 'react';
import type { MessageSummary } from '@easytmp/shared';
import { formatDateTime } from '../utils/formatters';
import { IconAlert, IconMail, IconRefresh } from './Icons';
import { MessageItem } from './MessageItem';

interface MessageListProps {
  mailboxName?: string;
  messages: MessageSummary[];
  taskSince: number | null;
  isLoading: boolean;
  isPolling: boolean;
  isDocumentHidden: boolean;
  error: string | null;
  hasMore: boolean;
  showAllMessages: boolean;
  onSelectMessage: (id: string) => void;
  onLoadMore: () => Promise<void>;
  onClearError: () => void;
  onResetTaskSince: () => void;
  onToggleShowAll: () => void;
}

export const MessageList: React.FC<MessageListProps> = ({
  mailboxName,
  messages,
  taskSince,
  isLoading,
  isPolling,
  isDocumentHidden,
  error,
  hasMore,
  showAllMessages,
  onSelectMessage,
  onLoadMore,
  onClearError,
  onResetTaskSince,
  onToggleShowAll,
}) => {
  return (
    <main className="inbox-section" aria-label="收件箱列表">
      <div className="inbox-card">
        <div className="inbox-card-header">
          <div className="inbox-title-group">
            <h2 className="inbox-title">收件箱</h2>
            <span className="inbox-count-badge">
              {!mailboxName ? '未选择' : messages.length > 0 ? `${messages.length} 封邮件` : '空'}
            </span>
          </div>

          <div className="inbox-status-group">
            <div className="polling-indicator" aria-live="polite">
              {!mailboxName ? (
                <span className="status-pill status-idle">
                  <span className="dot dot-idle" />
                  等待输入邮箱名
                </span>
              ) : isDocumentHidden ? (
                <span className="status-pill status-paused" title="切换回标签页时将自动刷新">
                  <span className="dot dot-paused" />
                  已暂停 (页面后台)
                </span>
              ) : isPolling ? (
                <span className="status-pill status-active">
                  <span className="dot dot-pulsing" />
                  正在刷新...
                </span>
              ) : (
                <span className="status-pill status-idle">
                  <span className="dot dot-idle" />每 3 秒自动轮询
                </span>
              )}
            </div>
          </div>
        </div>

        {/* Filter and task info bar (visible only when a mailbox is selected) */}
        {mailboxName && (
          <div className="inbox-filter-bar">
            <div className="filter-info">
              {showAllMessages ? (
                <span className="filter-badge filter-badge-all">
                  模式：查看该邮箱所有 7 天未过期邮件
                </span>
              ) : taskSince ? (
                <span className="filter-badge filter-badge-task">
                  本次任务自：{formatDateTime(taskSince)} 起
                </span>
              ) : null}
            </div>

            <div className="filter-actions">
              <button
                type="button"
                className="btn-filter-toggle"
                onClick={onToggleShowAll}
                title={
                  showAllMessages
                    ? '切换为只接收本次任务新邮件'
                    : '查看该邮箱中所有未过期的历史邮件'
                }
              >
                {showAllMessages ? '仅看本次任务邮件' : '查看全部未过期邮件'}
              </button>
              {!showAllMessages && (
                <button
                  type="button"
                  className="btn-filter-reset"
                  onClick={onResetTaskSince}
                  title="将任务起始时间重置为当前时间"
                >
                  重置任务时间
                </button>
              )}
            </div>
          </div>
        )}

        {/* Error notification */}
        {error && (
          <div className="alert-banner alert-error" role="alert">
            <IconAlert size={18} />
            <span className="alert-text">{error}</span>
            <button
              type="button"
              className="alert-close-btn"
              onClick={onClearError}
              aria-label="关闭错误提示"
            >
              ✕
            </button>
          </div>
        )}

        {/* Empty state or message list */}
        {!mailboxName ? (
          <div className="inbox-empty-state" data-testid="idle-inbox">
            <div className="empty-icon-pulse">
              <IconMail size={44} />
            </div>
            <p className="empty-title">请输入邮箱名并点击“查看”</p>
            <p className="empty-desc">
              在上方输入任意临时邮箱名前缀（如 <code>mytest</code>
              ），或点击“随机生成”，即可直接免密接收和读取邮件。
            </p>
          </div>
        ) : isLoading && messages.length === 0 ? (
          <div className="inbox-empty-state">
            <div className="empty-icon-pulse">
              <IconMail size={44} />
            </div>
            <p className="empty-title">正在连接邮箱服务器...</p>
          </div>
        ) : messages.length === 0 ? (
          <div className="inbox-empty-state" data-testid="empty-inbox">
            <div className="empty-icon-pulse">
              <IconMail size={44} />
            </div>
            <p className="empty-title">收件箱为空，等待来信中...</p>
            <p className="empty-desc">
              请将上方邮箱地址提供给外部服务发送验证码。
              <br />
              收到新邮件后页面将在 3 秒内自动展示，无需手动刷新。
            </p>
          </div>
        ) : (
          <div className="message-list-container" data-testid="message-list">
            {messages.map((msg) => (
              <MessageItem key={msg.id} message={msg} onClick={onSelectMessage} />
            ))}

            {hasMore && (
              <div className="load-more-row">
                <button
                  type="button"
                  className="btn btn-secondary btn-load-more"
                  onClick={onLoadMore}
                  disabled={isLoading}
                >
                  <IconRefresh size={16} />
                  <span>加载更早的历史邮件</span>
                </button>
              </div>
            )}
          </div>
        )}
      </div>
    </main>
  );
};
