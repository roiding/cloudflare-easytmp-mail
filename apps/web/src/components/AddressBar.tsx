import React, { useState, useEffect } from 'react';
import { useClipboard } from '../hooks/useClipboard';
import { normalizeMailboxInput } from '../utils/mailbox';
import { IconCheck, IconCopy, IconDice, IconEdit, IconRefresh, IconTrash } from './Icons';
import { SwitchMailboxModal } from './SwitchMailboxModal';

interface AddressBarProps {
  name: string;
  address: string;
  mailDomain: string;
  messagesCount: number;
  isLoading: boolean;
  onRefresh: () => Promise<void>;
  onRandom: () => Promise<void>;
  onClear: () => Promise<boolean>;
  onSwitch: (input: string) => Promise<boolean>;
}

export const AddressBar: React.FC<AddressBarProps> = ({
  name,
  address,
  mailDomain,
  messagesCount,
  isLoading,
  onRefresh,
  onRandom,
  onClear,
  onSwitch,
}) => {
  const { copy, copiedText } = useClipboard(2000);
  const [inputName, setInputName] = useState(name);
  const [inputError, setInputError] = useState<string | null>(null);
  const [isSwitchModalOpen, setIsSwitchModalOpen] = useState(false);
  const isAddressCopied = copiedText === address && Boolean(address);

  useEffect(() => {
    setInputName(name);
  }, [name]);

  const handleCopy = async () => {
    if (!address) return;
    await copy(address);
  };

  const handleView = async (e?: React.FormEvent) => {
    if (e) e.preventDefault();
    setInputError(null);

    const trimmed = inputName.trim();
    if (!trimmed) {
      setInputError('请输入邮箱名');
      return;
    }

    const validation = normalizeMailboxInput(trimmed, mailDomain);
    if (!validation.valid || !validation.name) {
      setInputError(validation.error || '邮箱名不合法');
      return;
    }

    const success = await onSwitch(trimmed);
    if (!success) {
      setInputError('切换邮箱失败，请检查邮箱名格式');
    }
  };

  return (
    <section className="address-section" aria-label="临时邮箱地址与操作">
      <div className="address-card">
        <div className="address-header">
          <span className="address-label">临时邮箱</span>
          <span className="address-subtext">公开免密 · 接收验证码专属</span>
        </div>

        {/* Input Form with always-visible name input and "查看" button */}
        <form className="address-input-form" onSubmit={handleView} aria-label="输入邮箱名查看邮件">
          <div className="address-input-row">
            <div className="input-with-suffix">
              <input
                type="text"
                className="address-text-input"
                placeholder="邮箱名前缀（如 test）"
                value={inputName}
                onChange={(e) => {
                  setInputName(e.target.value);
                  setInputError(null);
                }}
                disabled={isLoading}
                data-testid="mailbox-input"
                aria-label="邮箱名前缀"
              />
              <span className="address-input-suffix">@{mailDomain}</span>
            </div>

            <div className="address-input-actions">
              <button
                type="submit"
                className="btn btn-primary btn-view"
                disabled={isLoading || !inputName.trim()}
                data-testid="view-mailbox-btn"
              >
                查看
              </button>

              <button
                type="button"
                className="btn btn-secondary btn-random"
                onClick={onRandom}
                disabled={isLoading}
                data-testid="random-mailbox-btn"
                title="生成一个全新的随机邮箱名"
              >
                <IconDice size={16} />
                <span>{name ? '重新随机' : '随机生成'}</span>
              </button>
            </div>
          </div>

          {inputError && (
            <div className="input-error-msg" role="alert">
              {inputError}
            </div>
          )}
        </form>

        {/* Active Address Display Row */}
        <div className="address-display-row">
          <div
            className={`address-display-box ${!address ? 'address-display-empty' : ''}`}
            title={address ? '点击可快速复制完整地址' : undefined}
            onClick={address ? handleCopy : undefined}
          >
            <span className="address-text" data-testid="address-text">
              {address || '未选择邮箱 · 请在上方输入邮箱名并点击“查看”'}
            </span>
          </div>

          <button
            type="button"
            className={`btn btn-copy-prominent ${isAddressCopied ? 'btn-copied' : ''}`}
            onClick={handleCopy}
            disabled={!address || isLoading}
            aria-label={isAddressCopied ? '已复制完整邮箱地址' : '复制完整邮箱地址'}
          >
            {isAddressCopied ? (
              <>
                <IconCheck size={18} />
                <span>已复制！</span>
              </>
            ) : (
              <>
                <IconCopy size={18} />
                <span>复制地址</span>
              </>
            )}
          </button>
        </div>

        <div className="address-toolbar" role="toolbar" aria-label="邮箱操作工具栏">
          <button
            type="button"
            className="toolbar-btn"
            onClick={onRefresh}
            disabled={isLoading || !name}
            title="刷新当前邮箱邮件并重置任务基线"
          >
            <IconRefresh size={16} className={isLoading ? 'spin-icon' : ''} />
            <span>刷新</span>
          </button>

          <button
            type="button"
            className="toolbar-btn"
            onClick={() => setIsSwitchModalOpen(true)}
            disabled={isLoading}
            title="输入自定义邮箱名或切换地址"
          >
            <IconEdit size={16} />
            <span>修改 / 切换</span>
          </button>

          <button
            type="button"
            className="toolbar-btn toolbar-btn-danger"
            onClick={onClear}
            disabled={isLoading || messagesCount === 0 || !name}
            title={messagesCount === 0 ? '收件箱暂无邮件' : '清空当前邮箱已收到的邮件'}
          >
            <IconTrash size={16} />
            <span>清空邮件</span>
          </button>
        </div>
      </div>

      <SwitchMailboxModal
        currentAddress={address}
        mailDomain={mailDomain}
        isOpen={isSwitchModalOpen}
        onClose={() => setIsSwitchModalOpen(false)}
        onSwitch={onSwitch}
      />
    </section>
  );
};
