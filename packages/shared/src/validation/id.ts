export const MESSAGE_ID_REGEX =
  /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;

export interface IdValidationResult {
  valid: boolean;
  id?: string;
  error?: string;
}

export function validateMessageId(rawId: unknown): IdValidationResult {
  if (typeof rawId !== 'string') {
    return {
      valid: false,
      error: 'Message ID must be a string',
    };
  }

  if (rawId.length !== 36 || !MESSAGE_ID_REGEX.test(rawId)) {
    return {
      valid: false,
      error: 'Message ID must be a lowercase standard UUID v4',
    };
  }

  return {
    valid: true,
    id: rawId,
  };
}

export function generateMessageId(): string {
  return crypto.randomUUID().toLowerCase();
}
