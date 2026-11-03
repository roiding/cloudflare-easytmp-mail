// @vitest-environment jsdom
import './setup';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import React from 'react';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { MessageDetail } from '../src/components/MessageDetail';
import { apiClient } from '../src/api/client';
import { createMockMessageDetail } from './helpers/test-utils';

describe('MessageDetail modal and HTML sandbox tests', () => {
  const defaultDetail = createMockMessageDetail({
    id: 'msg-detail-123',
    subject: '欢迎注册：安全验证码 987654',
    from: { name: 'Acme Cloud', address: 'security@acme.com', domain: 'acme.com' },
    address: 'testbox@cottage.dpdns.org',
    receivedAt: 1793671200000,
    expiresAt: 1794276000000,
    dmarcPass: true,
    htmlStatus: 'available',
    htmlBody:
      '<p>欢迎注册，您的代码是 <strong>987654</strong></p><a href="https://acme.com/confirm?id=1" target="_blank" rel="noopener noreferrer">立即验证</a>',
    codeCandidates: [
      {
        value: '987654',
        source: 'subject',
        context: '欢迎注册：安全验证码 987654',
      },
    ],
    links: [
      {
        url: 'https://acme.com/confirm?id=1',
        text: '立即验证',
        host: 'acme.com',
      },
    ],
  });

  beforeEach(() => {
    vi.restoreAllMocks();
    Object.assign(navigator, {
      clipboard: {
        writeText: vi.fn().mockResolvedValue(undefined),
      },
    });
    window.isSecureContext = true;
  });

  it('loads and renders message details with pure React text nodes for metadata', async () => {
    vi.spyOn(apiClient, 'getMessage').mockResolvedValue({
      message: defaultDetail,
      serverTime: 1793671200000,
    });

    render(
      React.createElement(MessageDetail, {
        id: 'msg-detail-123',
        onClose: vi.fn(),
        onDelete: vi.fn().mockResolvedValue(true),
      }),
    );

    await waitFor(() => {
      expect(
        screen.getByRole('heading', { name: '欢迎注册：安全验证码 987654' }),
      ).toBeInTheDocument();
      expect(screen.getByText(/Acme Cloud/)).toBeInTheDocument();
      expect(screen.getByText(/security@acme.com/)).toBeInTheDocument();
      expect(screen.getByText('testbox@cottage.dpdns.org')).toBeInTheDocument();
      expect(screen.getByText(/保留 7 天/i)).toBeInTheDocument();
    });
  });

  it('renders HTML body in a strictly sandboxed iframe with CSP and without unsafe permissions', async () => {
    vi.spyOn(apiClient, 'getMessage').mockResolvedValue({
      message: defaultDetail,
      serverTime: 1793671200000,
    });

    render(
      React.createElement(MessageDetail, {
        id: 'msg-detail-123',
        onClose: vi.fn(),
        onDelete: vi.fn().mockResolvedValue(true),
      }),
    );

    await waitFor(() => {
      const iframe = screen.getByTitle('欢迎注册：安全验证码 987654') as HTMLIFrameElement;
      expect(iframe).toBeInTheDocument();

      // Check strictly allowed sandbox permissions
      const sandbox = iframe.getAttribute('sandbox') || '';
      expect(sandbox).toContain('allow-popups');
      expect(sandbox).toContain('allow-popups-to-escape-sandbox');

      // Check strictly FORBIDDEN dangerous permissions
      expect(sandbox).not.toContain('allow-scripts');
      expect(sandbox).not.toContain('allow-same-origin');
      expect(sandbox).not.toContain('allow-forms');
      expect(sandbox).not.toContain('allow-top-navigation');

      // Check CSP inside srcDoc blocks external resources and remote images
      const srcDoc = iframe.getAttribute('srcdoc') || '';
      expect(srcDoc).toContain('Content-Security-Policy');
      expect(srcDoc).toContain("default-src 'none'");
      expect(srcDoc).toContain('img-src data:');
      expect(srcDoc).toContain("style-src 'unsafe-inline'");
    });
  });

  it('falls back cleanly to plain text view when HTML is not available', async () => {
    const textOnlyDetail = createMockMessageDetail({
      ...defaultDetail,
      hasHtml: false,
      htmlStatus: 'not_present',
      htmlBody: null,
      textBody: '纯文本格式邮件：您的验证码是 987654。',
    });

    vi.spyOn(apiClient, 'getMessage').mockResolvedValue({
      message: textOnlyDetail,
      serverTime: 1793671200000,
    });

    render(
      React.createElement(MessageDetail, {
        id: 'msg-detail-123',
        onClose: vi.fn(),
        onDelete: vi.fn().mockResolvedValue(true),
      }),
    );

    await waitFor(() => {
      expect(screen.queryByTitle(/欢迎注册/i)).not.toBeInTheDocument();
      expect(screen.getByText('纯文本格式邮件：您的验证码是 987654。')).toBeInTheDocument();
    });
  });

  it('renders extracted links with target="_blank" and rel="noopener noreferrer"', async () => {
    vi.spyOn(apiClient, 'getMessage').mockResolvedValue({
      message: defaultDetail,
      serverTime: 1793671200000,
    });

    render(
      React.createElement(MessageDetail, {
        id: 'msg-detail-123',
        onClose: vi.fn(),
        onDelete: vi.fn().mockResolvedValue(true),
      }),
    );

    await waitFor(() => {
      const link = screen.getByRole('link', { name: /立即验证/i });
      expect(link).toHaveAttribute('href', 'https://acme.com/confirm?id=1');
      expect(link).toHaveAttribute('target', '_blank');
      expect(link).toHaveAttribute('rel', 'noopener noreferrer');
    });
  });

  it('deletes message with browser confirm dialog', async () => {
    const onDelete = vi.fn().mockResolvedValue(true);
    const onClose = vi.fn();

    vi.spyOn(apiClient, 'getMessage').mockResolvedValue({
      message: defaultDetail,
      serverTime: 1793671200000,
    });

    // 1. User cancels confirm
    const confirmSpy = vi.spyOn(window, 'confirm').mockReturnValue(false);

    render(
      React.createElement(MessageDetail, {
        id: 'msg-detail-123',
        onClose,
        onDelete,
      }),
    );

    await waitFor(() => {
      expect(screen.getByRole('button', { name: '删除邮件' })).toBeInTheDocument();
    });

    fireEvent.click(screen.getByRole('button', { name: '删除邮件' }));
    expect(confirmSpy).toHaveBeenCalled();
    expect(onDelete).not.toHaveBeenCalled();

    // 2. User accepts confirm
    confirmSpy.mockReturnValue(true);
    fireEvent.click(screen.getByRole('button', { name: '删除邮件' }));

    await waitFor(() => {
      expect(onDelete).toHaveBeenCalledWith('msg-detail-123');
      expect(onClose).toHaveBeenCalled();
    });
  });
});
