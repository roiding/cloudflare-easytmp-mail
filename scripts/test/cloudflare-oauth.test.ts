import { describe, expect, it, vi } from 'vitest';
import {
  readWranglerAccounts,
  resolveAccountId,
  resolveCloudflareCredentials,
} from '../lib/cloudflare-oauth.js';

const ACCOUNT_ID = '0123456789abcdef0123456789abcdef';
const TOKEN = 'mock-oauth-token-value-1234567890ab';

describe('Wrangler OAuth session resolution', () => {
  it('extracts the token from Wrangler JSON even when CLI noise precedes it', () => {
    const executor = vi
      .fn()
      .mockReturnValue(
        `\n ⛅️ wrangler 4.156.2\n────────────────\n${JSON.stringify({ type: 'oauth', token: TOKEN })}\n`,
      );

    expect(resolveCloudflareCredentials({ env: {}, executor })).toBe(TOKEN);
    expect(executor).toHaveBeenCalledWith(
      'npx',
      ['wrangler', 'auth', 'token', '--json'],
      expect.objectContaining({ encoding: 'utf8' }),
    );
  });

  it('prefers an explicitly supplied API token without invoking Wrangler', () => {
    const executor = vi.fn();
    expect(resolveCloudflareCredentials({ env: { CLOUDFLARE_API_TOKEN: TOKEN }, executor })).toBe(
      TOKEN,
    );
    expect(executor).not.toHaveBeenCalled();
  });

  it('resolves one Wrangler account and requires an explicit choice for multiple accounts', () => {
    const single = vi.fn().mockReturnValue(
      JSON.stringify({
        loggedIn: true,
        accounts: [{ id: ACCOUNT_ID, name: 'Example' }],
      }),
    );
    expect(readWranglerAccounts({ executor: single }).accounts[0].id).toBe(ACCOUNT_ID);
    expect(resolveAccountId({ env: {}, config: {}, executor: single })).toBe(ACCOUNT_ID);

    const multiple = vi.fn().mockReturnValue(
      JSON.stringify({
        loggedIn: true,
        accounts: [
          { id: ACCOUNT_ID, name: 'A' },
          { id: 'fedcba9876543210fedcba9876543210', name: 'B' },
        ],
      }),
    );
    expect(() => resolveAccountId({ env: {}, config: {}, executor: multiple })).toThrowError(
      /Found 2 Cloudflare accounts/,
    );
  });

  it('does not include the token in invalid-output errors', () => {
    const executor = vi.fn().mockReturnValue(`garbage ${TOKEN}`);
    try {
      resolveCloudflareCredentials({ env: {}, executor });
      expect.fail('Expected credentials parsing to fail');
    } catch (error) {
      expect(error).toBeInstanceOf(Error);
      expect((error as Error).message).toContain('[AUTH_REQUIRED]');
      expect((error as Error).message).not.toContain(TOKEN);
    }
  });
});
