import {
  DEFAULT_MAIL_DOMAIN,
  MAX_ALLOWED_EMAIL_BYTES,
  MAX_ALLOWED_HTML_BYTES,
  MAX_ALLOWED_TEXT_CHARS,
  MAX_EMAIL_BYTES as DEFAULT_MAX_EMAIL_BYTES,
  MAX_HTML_BYTES as DEFAULT_MAX_HTML_BYTES,
  MAX_TEXT_CHARS as DEFAULT_MAX_TEXT_CHARS,
  MESSAGE_RETENTION_MS,
  MESSAGE_RETENTION_SECONDS,
} from '@easytmp/shared';

export interface InboundWorkerEnv {
  DB: D1Database;
  MAIL_DOMAIN?: string;
  MAX_EMAIL_BYTES?: number | string;
  MAX_TEXT_CHARS?: number | string;
  MAX_HTML_BYTES?: number | string;
  REQUIRE_DMARC_PASS?: string | boolean;
}

export interface ResolvedConfig {
  mailDomain: string;
  maxEmailBytes: number;
  maxTextChars: number;
  maxHtmlBytes: number;
  requireDmarcPass: boolean;
  messageRetentionMs: number;
  cronBatchSize: number;
  cronMaxTotalDelete: number;
}

export const MIN_EMAIL_BYTES = 1024;
export const MIN_TEXT_CHARS = 1024;
export const MIN_HTML_BYTES = 1024;
export const DEFAULT_CRON_BATCH_SIZE = 100;
export const DEFAULT_CRON_MAX_TOTAL_DELETE = 1000;

/**
 * Clamps a numeric configuration value to [min, max], falling back to defaultValue if invalid.
 */
function clampNumber(value: unknown, defaultValue: number, min: number, max: number): number {
  if (value === undefined || value === null || value === '') {
    return defaultValue;
  }
  const num = typeof value === 'number' ? value : Number(value);
  if (!Number.isFinite(num) || Number.isNaN(num)) {
    return defaultValue;
  }
  const intVal = Math.floor(num);
  if (intVal < min) return min;
  if (intVal > max) return max;
  return intVal;
}

/**
 * Parses and resolves configuration from environment variables,
 * enforcing architecture bounds and safe defaults.
 */
export function resolveConfig(env?: Partial<InboundWorkerEnv>): ResolvedConfig {
  const rawDomain = env?.MAIL_DOMAIN;
  const mailDomain =
    typeof rawDomain === 'string' && rawDomain.trim().length > 0
      ? rawDomain.trim().toLowerCase()
      : DEFAULT_MAIL_DOMAIN.toLowerCase();

  const maxEmailBytes = clampNumber(
    env?.MAX_EMAIL_BYTES,
    DEFAULT_MAX_EMAIL_BYTES,
    MIN_EMAIL_BYTES,
    MAX_ALLOWED_EMAIL_BYTES,
  );

  const maxTextChars = clampNumber(
    env?.MAX_TEXT_CHARS,
    DEFAULT_MAX_TEXT_CHARS,
    MIN_TEXT_CHARS,
    MAX_ALLOWED_TEXT_CHARS,
  );

  const maxHtmlBytes = clampNumber(
    env?.MAX_HTML_BYTES,
    DEFAULT_MAX_HTML_BYTES,
    MIN_HTML_BYTES,
    MAX_ALLOWED_HTML_BYTES,
  );

  let requireDmarcPass = true;
  if (env?.REQUIRE_DMARC_PASS !== undefined && env?.REQUIRE_DMARC_PASS !== null) {
    if (env.REQUIRE_DMARC_PASS === false || env.REQUIRE_DMARC_PASS === 'false') {
      requireDmarcPass = false;
    } else if (env.REQUIRE_DMARC_PASS === true || env.REQUIRE_DMARC_PASS === 'true') {
      requireDmarcPass = true;
    } else {
      // Fail-safe to true in production
      requireDmarcPass = true;
    }
  }

  return {
    mailDomain,
    maxEmailBytes,
    maxTextChars,
    maxHtmlBytes,
    requireDmarcPass,
    messageRetentionMs: MESSAGE_RETENTION_MS,
    cronBatchSize: DEFAULT_CRON_BATCH_SIZE,
    cronMaxTotalDelete: DEFAULT_CRON_MAX_TOTAL_DELETE,
  };
}

export { MESSAGE_RETENTION_MS, MESSAGE_RETENTION_SECONDS };
