/**
 * Formats a Unix millisecond timestamp to a standard local date-time string: YYYY-MM-DD HH:mm:ss.
 */
export function formatDateTime(timestamp: number): string {
  if (!Number.isFinite(timestamp) || timestamp <= 0) return '';
  const date = new Date(timestamp);
  const pad = (n: number) => n.toString().padStart(2, '0');
  const year = date.getFullYear();
  const month = pad(date.getMonth() + 1);
  const day = pad(date.getDate());
  const hours = pad(date.getHours());
  const minutes = pad(date.getMinutes());
  const seconds = pad(date.getSeconds());
  return `${year}-${month}-${day} ${hours}:${minutes}:${seconds}`;
}

/**
 * Returns a human-friendly relative time string in Chinese.
 */
export function formatRelativeTime(timestamp: number, referenceTime = Date.now()): string {
  if (!Number.isFinite(timestamp) || timestamp <= 0) return '';
  const diffMs = referenceTime - timestamp;
  if (diffMs < 0) return '刚刚';
  const diffSec = Math.floor(diffMs / 1000);
  if (diffSec < 15) return '刚刚';
  if (diffSec < 60) return `${diffSec} 秒前`;
  const diffMin = Math.floor(diffSec / 60);
  if (diffMin < 60) return `${diffMin} 分钟前`;
  const diffHours = Math.floor(diffMin / 60);
  if (diffHours < 24) return `${diffHours} 小时前`;
  const diffDays = Math.floor(diffHours / 24);
  return `${diffDays} 天前`;
}

/**
 * Formats expiration timestamp into informative Chinese text.
 */
export function formatExpiration(
  expiresAt: number,
  referenceTime = Date.now(),
): {
  formattedDate: string;
  remainingText: string;
  isExpired: boolean;
} {
  const isExpired = expiresAt <= referenceTime;
  const formattedDate = formatDateTime(expiresAt);

  if (isExpired) {
    return {
      formattedDate,
      remainingText: '已到期',
      isExpired: true,
    };
  }

  const diffMs = expiresAt - referenceTime;
  const hours = Math.ceil(diffMs / (1000 * 60 * 60));
  const days = Math.floor(hours / 24);
  const remainingHours = hours % 24;

  let remainingText = '';
  if (days > 0) {
    remainingText =
      remainingHours > 0 ? `约 ${days} 天 ${remainingHours} 小时后` : `约 ${days} 天后`;
  } else {
    remainingText = `约 ${hours} 小时后`;
  }

  return {
    formattedDate,
    remainingText,
    isExpired: false,
  };
}

/**
 * Formats byte size into human readable string.
 */
export function formatBytes(bytes: number): string {
  if (!Number.isFinite(bytes) || bytes < 0) return '0 B';
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(2)} MB`;
}
