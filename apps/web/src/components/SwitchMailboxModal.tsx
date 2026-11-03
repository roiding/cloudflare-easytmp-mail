import React, { useState } from 'react';
import { MAIL_DOMAIN } from '@easytmp/shared';
import { normalizeMailboxInput } from '../utils/mailbox';
import { IconClose, IconEdit } from './Icons';

interface SwitchMailboxModalProps {
  currentAddress: string;
  isOpen: boolean;
  onClose: () => void;
  onSwitch: (input: string) => Promise<boolean>;
}

export const SwitchMailboxModal: React.FC<SwitchMailboxModalProps> = ({
  currentAddress,
  isOpen,
  onClose,
  onSwitch,
}) => {
  const [inputValue, setInputValue] = useState('');
  const [localError, setLocalError] = useState<string | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);

  if (!isOpen) return null;

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setLocalError(null);

    const validation = normalizeMailboxInput(inputValue);
    if (!validation.valid || !validation.name) {
      setLocalError(validation.error || '邮箱名不符合格式要求');
      return;
    }

    setIsSubmitting(true);
    try {
      const success = await onSwitch(inputValue);
      if (success) {
        setInputValue('');
        onClose();
      }
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <div className="modal-overlay" role="dialog" aria-modal="true" aria-labelledby="modal-title">
      <div className="modal-content">
        <div className="modal-header">
          <div className="modal-title-group">
            <IconEdit size={20} />
            <h2 id="modal-title" className="modal-title">
              修改 / 切换邮箱
            </h2>
          </div>
          <button
            type="button"
            className="btn-icon"
            onClick={onClose}
            aria-label="关闭弹窗"
            disabled={isSubmitting}
          >
            <IconClose size={18} />
          </button>
        </div>

        <form onSubmit={handleSubmit}>
          <div className="modal-body">
            <p className="modal-desc">
              输入自定义邮箱名称或完整地址直接进入收件箱。同名邮箱为公开共享，任何访客均可查看。
            </p>

            <div className="input-group">
              <label htmlFor="mailbox-input" className="input-label">
                邮箱名或完整地址
              </label>
              <input
                id="mailbox-input"
                type="text"
                className={`text-input ${localError ? 'input-error' : ''}`}
                placeholder={`例如 mytest 或 mytest@${MAIL_DOMAIN}`}
                value={inputValue}
                onChange={(e) => {
                  setInputValue(e.target.value);
                  if (localError) setLocalError(null);
                }}
                autoFocus
                autoComplete="off"
                disabled={isSubmitting}
              />
              {localError && (
                <p className="field-error-msg" role="alert">
                  {localError}
                </p>
              )}
            </div>

            <div className="current-mailbox-info">
              <span className="info-label">当前正在查看：</span>
              <span className="info-value">{currentAddress || '未加载'}</span>
            </div>

            <div className="tips-box">
              <p>
                • 规则：1–64 个字符，开头和结尾必须是字母或数字，可包含 <code>.</code>{' '}
                <code>_</code> <code>-</code>，不可连续两个点。
              </p>
              <p>• 切换邮箱不会删除原有邮箱的任何邮件，随时可再次输入切换回来。</p>
            </div>
          </div>

          <div className="modal-footer">
            <button
              type="button"
              className="btn btn-secondary"
              onClick={onClose}
              disabled={isSubmitting}
            >
              取消
            </button>
            <button
              type="submit"
              className="btn btn-primary"
              disabled={isSubmitting || !inputValue.trim()}
            >
              {isSubmitting ? '切换中...' : '确认切换'}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
};
