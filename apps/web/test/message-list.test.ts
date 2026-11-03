// @vitest-environment jsdom
import './setup';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import React from 'react';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { MessageList } from '../src/components/MessageList';
import { createMockMessageSummary } from './helpers/test-utils';

describe('MessageList and MessageItem component tests', () => {
  const defaultProps = {
    mailboxName: 'testbox',
    messages: [],
    taskSince: 1793671200000,
    isLoading: false,
    isPolling: false,
    isDocumentHidden: false,
    error: null,
    hasMore: false,
    showAllMessages: false,
    onSelectMessage: vi.fn(),
    onLoadMore: vi.fn().mockResolvedValue(undefined),
    onClearError: vi.fn(),
    onResetTaskSince: vi.fn(),
    onToggleShowAll: vi.fn(),
  };

  beforeEach(() => {
    vi.clearAllMocks();
    Object.assign(navigator, {
      clipboard: {
        writeText: vi.fn().mockResolvedValue(undefined),
      },
    });
    window.isSecureContext = true;
  });

  it('renders idle guidance state when no mailbox is selected', () => {
    render(React.createElement(MessageList, { ...defaultProps, mailboxName: '' }));
    expect(screen.getByTestId('idle-inbox')).toBeInTheDocument();
    expect(screen.getByText('请输入邮箱名并点击“查看”')).toBeInTheDocument();
  });

  it('renders empty inbox state with helpful guidance when messages array is empty', () => {
    render(React.createElement(MessageList, defaultProps));

    expect(screen.getByTestId('empty-inbox')).toBeInTheDocument();
    expect(screen.getByText('收件箱为空，等待来信中...')).toBeInTheDocument();
    expect(screen.getByText(/请将上方邮箱地址提供给外部服务发送验证码/i)).toBeInTheDocument();
  });

  it('renders messages with sender, subject, and relative time', () => {
    const msg = createMockMessageSummary({
      id: 'msg-abc-123',
      from: { name: 'GitHub', address: 'noreply@github.com', domain: 'github.com' },
      subject: 'GitHub 验证码：889900',
      preview: '您的 GitHub 授权验证码是 889900',
      receivedAt: Date.now() - 30000, // 30s ago
      dmarcPass: true,
    });

    render(React.createElement(MessageList, { ...defaultProps, messages: [msg] }));

    expect(screen.getByText('GitHub <noreply@github.com>')).toBeInTheDocument();
    expect(screen.getByText('GitHub 验证码：889900')).toBeInTheDocument();
    expect(screen.getByText('DMARC 通过')).toBeInTheDocument();
    expect(screen.getByText(/30 秒前|刚刚/)).toBeInTheDocument();
  });

  it('copies verification code on shortcut button click and stops click propagation', async () => {
    const onSelect = vi.fn();
    const msg = createMockMessageSummary({
      id: 'msg-code-test',
      codeCandidates: [
        {
          value: '456789',
          source: 'subject',
          context: '验证码：456789',
        },
      ],
    });

    render(
      React.createElement(MessageList, {
        ...defaultProps,
        messages: [msg],
        onSelectMessage: onSelect,
      }),
    );

    const copyCodeBtn = screen.getByRole('button', { name: '复制验证码 456789' });
    expect(copyCodeBtn).toBeInTheDocument();

    fireEvent.click(copyCodeBtn);

    await waitFor(() => {
      expect(navigator.clipboard.writeText).toHaveBeenCalledWith('456789');
      expect(screen.getByText('已复制')).toBeInTheDocument();
    });

    // Clicking the copy button MUST NOT trigger opening the message details!
    expect(onSelect).not.toHaveBeenCalled();
  });

  it('opens message detail when clicking the message row', () => {
    const onSelect = vi.fn();
    const msg = createMockMessageSummary({ id: 'msg-open-target' });

    render(
      React.createElement(MessageList, {
        ...defaultProps,
        messages: [msg],
        onSelectMessage: onSelect,
      }),
    );

    const item = screen.getByRole('button', { name: /查看来自/i });
    fireEvent.click(item);

    expect(onSelect).toHaveBeenCalledWith('msg-open-target');
  });

  it('displays alert banner when error is present and allows dismissing', () => {
    const onClearError = vi.fn();
    render(
      React.createElement(MessageList, {
        ...defaultProps,
        error: '请求过于频繁，请等待 5 秒后再试',
        onClearError,
      }),
    );

    expect(screen.getByRole('alert')).toHaveTextContent('请求过于频繁，请等待 5 秒后再试');
    const closeBtn = screen.getByRole('button', { name: '关闭错误提示' });
    fireEvent.click(closeBtn);
    expect(onClearError).toHaveBeenCalledTimes(1);
  });
});
