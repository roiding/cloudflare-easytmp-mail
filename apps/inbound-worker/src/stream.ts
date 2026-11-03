export interface StreamReadResult {
  buffer: Uint8Array | null;
  sizeBytes: number;
  exceeded: boolean;
}

/**
 * Reads a ReadableStream with a strict byte limit.
 * If the cumulative byte count exceeds maxBytes at any point during streaming,
 * the stream reader is promptly cancelled to prevent unbounded memory allocation
 * or DoS via oversized payloads.
 */
export async function readStreamWithLimit(
  stream: ReadableStream<Uint8Array>,
  maxBytes: number,
): Promise<StreamReadResult> {
  const reader = stream.getReader();
  const chunks: Uint8Array[] = [];
  let totalBytes = 0;

  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;

      if (value) {
        totalBytes += value.byteLength;
        if (totalBytes > maxBytes) {
          try {
            await reader.cancel('MAX_EMAIL_BYTES exceeded');
          } catch {
            // Ignore cancel errors
          }
          return {
            buffer: null,
            sizeBytes: totalBytes,
            exceeded: true,
          };
        }
        chunks.push(value);
      }
    }
  } catch (err) {
    try {
      await reader.cancel('Stream read error');
    } catch {
      // Ignore cancel errors
    }
    throw err;
  }

  // Concatenate chunks into a single buffer
  const buffer = new Uint8Array(totalBytes);
  let offset = 0;
  for (const chunk of chunks) {
    buffer.set(chunk, offset);
    offset += chunk.byteLength;
  }

  return {
    buffer,
    sizeBytes: totalBytes,
    exceeded: false,
  };
}
