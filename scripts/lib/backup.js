import { mkdirSync, writeFileSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const rootDir = resolve(__dirname, '../..');
const backupsDir = resolve(rootDir, '.wrangler/backups');

const SENSITIVE_KEY_PATTERN =
  /(token|secret|password|credential|authorization|auth.*key|api.*key)/i;

export function sanitizeForBackup(data) {
  if (data === null || data === undefined) {
    return data;
  }
  if (typeof data !== 'object') {
    return data;
  }
  if (Array.isArray(data)) {
    return data.map(sanitizeForBackup);
  }

  const result = {};
  for (const [key, value] of Object.entries(data)) {
    if (SENSITIVE_KEY_PATTERN.test(key)) {
      result[key] = '[REDACTED]';
    } else {
      result[key] = sanitizeForBackup(value);
    }
  }
  return result;
}

export function saveSanitizedBackup(prefix, payload, metadata = {}) {
  mkdirSync(backupsDir, { recursive: true });

  const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
  const filename = `${prefix}-${timestamp}.json`;
  const filepath = resolve(backupsDir, filename);

  const backupObject = {
    version: '1.0.0',
    createdAt: new Date().toISOString(),
    prefix,
    metadata,
    data: sanitizeForBackup(payload),
  };

  writeFileSync(filepath, JSON.stringify(backupObject, null, 2), 'utf8');

  return {
    filepath,
    filename,
    createdAt: backupObject.createdAt,
    summary: {
      prefix,
      metadata,
    },
  };
}
