import fs from 'node:fs';
import path from 'node:path';
// @vitest-environment jsdom
import './setup';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import React from 'react';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { AddressBar } from '../src/components/AddressBar';
import { MAIL_DOMAIN } from '@easytmp/shared';

describe('AddressBar and SwitchMailboxModal tests', () => {
  const defaultProps = {
    name: 'p7x4m9q2v6k8n3r5',
    address: `p7x4m9q2v6k8n3r5@${MAIL_DOMAIN}`,
    mailDomain: MAIL_DOMAIN,
    messagesCount: 2,
    isLoading: false,
    onRefresh: vi.fn().mockResolvedValue(undefined),
    onRandom: vi.fn().mockResolvedValue(undefined),
    onClear: vi.fn().mockResolvedValue(true),
    onSwitch: vi.fn().mockResolvedValue(true),
  };

  beforeEach(() => {
    vi.clearAllMocks();
    Object.defineProperty(navigator, 'clipboard', {
      value: {
        writeText: vi.fn().mockResolvedValue(undefined),
      },
      configurable: true,
      writable: true,
    });
    window.isSecureContext = true;
  });

  it('renders the full address prominently when selected', () => {
    render(React.createElement(AddressBar, defaultProps));
    expect(screen.getByTestId('address-text')).toHaveTextContent(`p7x4m9q2v6k8n3r5@${MAIL_DOMAIN}`);
  });

  it('renders unselected prompt when no address is chosen', () => {
    render(
      React.createElement(AddressBar, {
        ...defaultProps,
        name: '',
        address: '',
      }),
    );
    expect(screen.getByTestId('address-text')).toHaveTextContent(/未选择邮箱/);
    expect(screen.getByRole('button', { name: /随机生成/i })).toBeInTheDocument();
  });

  it('allows manual input and clicking view button directly from AddressBar', async () => {
    const user = userEvent.setup();
    render(
      React.createElement(AddressBar, {
        ...defaultProps,
        name: '',
        address: '',
      }),
    );

    const input = screen.getByTestId('mailbox-input');
    const viewBtn = screen.getByTestId('view-mailbox-btn');

    await user.type(input, 'mycustombox');
    await user.click(viewBtn);

    expect(defaultProps.onSwitch).toHaveBeenCalledWith('mycustombox');
  });

  it('rejects invalid names in inline input without calling onSwitch', async () => {
    const user = userEvent.setup();
    render(
      React.createElement(AddressBar, {
        ...defaultProps,
        name: '',
        address: '',
      }),
    );

    const input = screen.getByTestId('mailbox-input');
    const viewBtn = screen.getByTestId('view-mailbox-btn');

    await user.type(input, 'bad..name');
    await user.click(viewBtn);

    expect(screen.getByRole('alert')).toBeInTheDocument();
    expect(defaultProps.onSwitch).not.toHaveBeenCalled();
  });

  it('copies address on clicking the prominent green copy button', async () => {
    render(React.createElement(AddressBar, defaultProps));

    const copyBtn = screen.getByRole('button', { name: /复制完整邮箱地址/i });
    expect(copyBtn).toHaveClass('btn-copy-prominent');

    fireEvent.click(copyBtn);

    await waitFor(() => {
      expect(navigator.clipboard.writeText).toHaveBeenCalledWith(`p7x4m9q2v6k8n3r5@${MAIL_DOMAIN}`);
      expect(screen.getByText('已复制！')).toBeInTheDocument();
    });
  });

  it('triggers manual refresh when clicking refresh button', () => {
    render(React.createElement(AddressBar, defaultProps));
    const refreshBtn = screen.getByRole('button', { name: /刷新/i });
    fireEvent.click(refreshBtn);
    expect(defaultProps.onRefresh).toHaveBeenCalledTimes(1);
  });

  it('triggers random generation when clicking random button', () => {
    render(React.createElement(AddressBar, defaultProps));
    const randomBtn = screen.getByTestId('random-mailbox-btn');
    fireEvent.click(randomBtn);
    expect(defaultProps.onRandom).toHaveBeenCalledTimes(1);
  });

  it('disables clear mailbox button when messages count is zero', () => {
    render(React.createElement(AddressBar, { ...defaultProps, messagesCount: 0 }));
    const clearBtn = screen.getByRole('button', { name: /清空邮件/i });
    expect(clearBtn).toBeDisabled();
  });

  it('enables clear button when messages count is greater than zero and triggers onClear', () => {
    render(React.createElement(AddressBar, { ...defaultProps, messagesCount: 3 }));
    const clearBtn = screen.getByRole('button', { name: /清空邮件/i });
    expect(clearBtn).not.toBeDisabled();
    fireEvent.click(clearBtn);
    expect(defaultProps.onClear).toHaveBeenCalledTimes(1);
  });

  it('validates manual mailbox switch modal: rejects invalid names without calling onSwitch', async () => {
    const user = userEvent.setup();
    render(React.createElement(AddressBar, defaultProps));

    const editBtn = screen.getByRole('button', { name: /修改 \/ 切换/i });
    await user.click(editBtn);

    expect(screen.getByRole('heading', { name: '修改 / 切换邮箱' })).toBeInTheDocument();

    const input = screen.getByPlaceholderText(/例如 mytest/i);
    const submitBtn = screen.getByRole('button', { name: '确认切换' });

    // 1. Enter invalid name with consecutive dots
    await user.type(input, 'invalid..name');
    await user.click(submitBtn);

    expect(screen.getByRole('alert')).toHaveTextContent(
      /contain no consecutive dots|需为 1–64 位/i,
    );
    expect(defaultProps.onSwitch).not.toHaveBeenCalled();

    // 2. Clear and enter invalid domain
    await user.clear(input);
    await user.type(input, 'user@bad-domain.com');
    await user.click(submitBtn);

    expect(
      screen.getByText(new RegExp(`暂仅支持本站域名 @${MAIL_DOMAIN}`, 'i')),
    ).toBeInTheDocument();
    expect(defaultProps.onSwitch).not.toHaveBeenCalled();
  });

  it('validates manual mailbox switch modal: accepts valid name and calls onSwitch', async () => {
    const user = userEvent.setup();
    render(React.createElement(AddressBar, defaultProps));

    const editBtn = screen.getByRole('button', { name: /修改 \/ 切换/i });
    await user.click(editBtn);

    const input = screen.getByPlaceholderText(/例如 mytest/i);
    const submitBtn = screen.getByRole('button', { name: '确认切换' });

    await user.type(input, 'custom-box-9');
    await user.click(submitBtn);

    expect(defaultProps.onSwitch).toHaveBeenCalledWith('custom-box-9');
    await waitFor(() => {
      expect(screen.queryByRole('heading', { name: '修改 / 切换邮箱' })).not.toBeInTheDocument();
    });
  });

  it('validates manual mailbox switch modal: accepts full email address and calls onSwitch', async () => {
    const user = userEvent.setup();
    render(React.createElement(AddressBar, defaultProps));

    const editBtn = screen.getByRole('button', { name: /修改 \/ 切换/i });
    await user.click(editBtn);

    const input = screen.getByPlaceholderText(/例如 mytest/i);
    const submitBtn = screen.getByRole('button', { name: '确认切换' });

    await user.type(input, `newbox@${MAIL_DOMAIN}`);
    await user.click(submitBtn);

    expect(defaultProps.onSwitch).toHaveBeenCalledWith(`newbox@${MAIL_DOMAIN}`);
  });
  it('maintains correct responsive component hierarchy for AddressBar (input row with suffix + actions container)', () => {
    const { container } = render(React.createElement(AddressBar, defaultProps));

    const inputRow = container.querySelector('.address-input-row');
    expect(inputRow).toBeInTheDocument();

    const inputWithSuffix = inputRow?.querySelector('.input-with-suffix');
    expect(inputWithSuffix).toBeInTheDocument();

    const input = inputWithSuffix?.querySelector('input[data-testid="mailbox-input"]');
    expect(input).toBeInTheDocument();
    expect(input).toHaveAttribute('aria-label', '邮箱名前缀');

    const suffix = inputWithSuffix?.querySelector('.address-input-suffix');
    expect(suffix).toBeInTheDocument();
    expect(suffix).toHaveTextContent(`@${MAIL_DOMAIN}`);

    const actionsContainer = inputRow?.querySelector('.address-input-actions');
    expect(actionsContainer).toBeInTheDocument();

    const viewBtn = actionsContainer?.querySelector('button[data-testid="view-mailbox-btn"]');
    expect(viewBtn).toBeInTheDocument();

    const randomBtn = actionsContainer?.querySelector('button[data-testid="random-mailbox-btn"]');
    expect(randomBtn).toBeInTheDocument();
    expect(randomBtn?.querySelector('svg')).toBeInTheDocument();
  });

  it('renders IconDice as a clean vector icon with stroke lines avoiding tofu glyph appearance', () => {
    render(React.createElement(AddressBar, defaultProps));
    const randomBtn = screen.getByTestId('random-mailbox-btn');
    const svg = randomBtn.querySelector('svg');
    expect(svg).toBeInTheDocument();
    expect(svg).toHaveAttribute('stroke', 'currentColor');
    expect(svg).toHaveAttribute('stroke-width', '2');
    expect(svg).toHaveAttribute('aria-hidden', 'true');
    const rect = svg?.querySelector('rect');
    expect(rect).toBeNull();
  });

  it('verifies App.css defines robust responsive rules for desktop and mobile (320, 375/390/430, 768+)', () => {
    const cssPath = path.resolve(__dirname, '../src/App.css');
    const cssContent = fs.readFileSync(cssPath, 'utf-8');

    // Desktop base rules (768px+)
    expect(cssContent).toMatch(/\.address-input-row\s*\{[^}]*display:\s*flex/);
    expect(cssContent).toMatch(/\.input-with-suffix\s*\{[^}]*flex:\s*1/);
    expect(cssContent).toMatch(/\.input-with-suffix\s*\{[^}]*min-width:\s*0/);
    expect(cssContent).toMatch(/\.address-text-input\s*\{[^}]*min-width:\s*0/);
    expect(cssContent).toMatch(/\.address-input-suffix\s*\{[^}]*flex-shrink:\s*0/);
    expect(cssContent).toMatch(/\.address-input-suffix\s*\{[^}]*white-space:\s*nowrap/);
    expect(cssContent).toMatch(/\.address-input-actions\s*\{[^}]*display:\s*flex/);
    expect(cssContent).toMatch(/\.address-input-actions\s*\{[^}]*flex-shrink:\s*0/);
    expect(cssContent).toMatch(/\.btn-view\s*\{[^}]*flex-shrink:\s*0/);
    expect(cssContent).toMatch(/\.btn-random\s*\{[^}]*flex-shrink:\s*0/);

    // Mobile media query (max-width: 640px) covering 375, 390, 430
    const mobileQuery = cssContent.slice(cssContent.indexOf('@media (max-width: 640px)'));
    expect(mobileQuery).toMatch(/\.address-input-row\s*\{[^}]*flex-direction:\s*column/);
    expect(mobileQuery).toMatch(/\.input-with-suffix\s*\{[^}]*width:\s*100%/);
    expect(mobileQuery).toMatch(/\.address-input-actions\s*\{[^}]*width:\s*100%/);
    expect(mobileQuery).toMatch(/\.btn-view,\s*\.btn-random\s*\{[^}]*flex:\s*1 1 0%/);
    expect(mobileQuery).toMatch(/\.btn-view,\s*\.btn-random\s*\{[^}]*min-height:\s*44px/);
    expect(mobileQuery).toMatch(/\.btn-copy-prominent\s*\{[^}]*min-height:\s*44px/);

    // Narrow mobile media query (max-width: 360px) covering 320px
    const smallMobileQuery = cssContent.slice(cssContent.indexOf('@media (max-width: 360px)'));
    expect(smallMobileQuery).toMatch(/\.address-card\s*\{[^}]*padding:\s*14px 10px/);
    expect(smallMobileQuery).toMatch(/\.address-input-suffix\s*\{[^}]*font-size:\s*12px/);
  });
});
