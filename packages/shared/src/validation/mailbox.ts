import { DEFAULT_MAIL_DOMAIN } from '../types/index.js';

export const MAILBOX_NAME_INPUT_REGEX =
  /^(?!.*\.\.)[A-Za-z0-9](?:[A-Za-z0-9._-]{0,62}[A-Za-z0-9])?$/;
export const MAILBOX_NAME_NORMALIZED_REGEX = /^(?!.*\.\.)[a-z0-9](?:[a-z0-9._-]{0,62}[a-z0-9])?$/;
export const RANDOM_NAME_REGEX = /^[a-z0-9]{16}$/;

export interface MailboxValidationResult {
  valid: boolean;
  name?: string;
  address?: string;
  error?: string;
}

/**
 * Validates and normalizes a mailbox local-part name.
 * ASCII uppercase characters are lowercased.
 * Strict formatting: 1-64 chars, starts and ends with alphanumeric,
 * middle can contain [._-], no consecutive dots, no whitespace trimming.
 */
export function validateMailboxName(
  rawName: unknown,
  mailDomain?: string | null,
): MailboxValidationResult {
  if (typeof rawName !== 'string') {
    return {
      valid: false,
      error: 'Mailbox name must be a string',
    };
  }

  if (rawName.length < 1 || rawName.length > 64) {
    return {
      valid: false,
      error: 'Mailbox name must be between 1 and 64 ASCII characters',
    };
  }

  if (!MAILBOX_NAME_INPUT_REGEX.test(rawName)) {
    return {
      valid: false,
      error:
        'Mailbox name must start and end with an alphanumeric character, contain no consecutive dots, and only use letters, digits, dots, hyphens, and underscores',
    };
  }

  const normalizedName = rawName.toLowerCase();

  return {
    valid: true,
    name: normalizedName,
    ...(mailDomain ? { address: `${normalizedName}@${mailDomain.toLowerCase()}` } : {}),
  };
}

const RANDOM_CHARS = 'abcdefghijklmnopqrstuvwxyz0123456789';
// 36 characters. 256 % 36 = 4. 256 - 4 = 252 = 36 * 7.
// Discarding random bytes >= 252 guarantees perfect uniform distribution without modulo bias.
const MAX_UNBIASED_BYTE = 252;

/**
 * Generates a cryptographically secure 16-character random mailbox name and address
 * with rejection sampling to eliminate modulo bias.
 */
export function generateRandomMailbox(mailDomain = DEFAULT_MAIL_DOMAIN): {
  name: string;
  address: string;
} {
  let name = '';
  const buffer = new Uint8Array(32);
  let offset = buffer.length;

  while (name.length < 16) {
    if (offset >= buffer.length) {
      crypto.getRandomValues(buffer);
      offset = 0;
    }
    const byte = buffer[offset++];
    if (byte < MAX_UNBIASED_BYTE) {
      name += RANDOM_CHARS[byte % RANDOM_CHARS.length];
    }
  }

  return {
    name,
    address: `${name}@${mailDomain}`,
  };
}
