import { MAIL_DOMAIN, validateMailboxName } from '@easytmp/shared';

export interface MailboxInputResult {
  valid: boolean;
  name?: string;
  address?: string;
  error?: string;
}

/**
 * Normalizes and validates mailbox input from the user.
 * Supports both local-part only ("alice") and full email address ("alice@cottage.dpdns.org").
 * Enforces correct domain if @ is present, and delegates to shared validateMailboxName.
 */
export function normalizeMailboxInput(rawInput: unknown): MailboxInputResult {
  if (typeof rawInput !== 'string') {
    return {
      valid: false,
      error: '请输入有效的邮箱名或邮箱地址',
    };
  }

  const trimmed = rawInput.trim();
  if (trimmed.length === 0) {
    return {
      valid: false,
      error: '邮箱名不能为空',
    };
  }

  let localPart = trimmed;
  if (trimmed.includes('@')) {
    const parts = trimmed.split('@');
    if (parts.length !== 2 || !parts[0] || !parts[1]) {
      return {
        valid: false,
        error: '邮箱地址格式不正确，示例：alice 或 alice@' + MAIL_DOMAIN,
      };
    }
    const [namePart, domainPart] = parts;
    if (domainPart.toLowerCase() !== MAIL_DOMAIN.toLowerCase()) {
      return {
        valid: false,
        error: `暂仅支持本站域名 @${MAIL_DOMAIN} 的邮箱`,
      };
    }
    localPart = namePart;
  }

  const validation = validateMailboxName(localPart);
  if (!validation.valid) {
    return {
      valid: false,
      error:
        validation.error ||
        '邮箱名格式不正确：需为 1–64 位字母或数字开头结尾，支持 . - _，不可连续点',
    };
  }

  return {
    valid: true,
    name: validation.name,
    address: validation.address,
  };
}
