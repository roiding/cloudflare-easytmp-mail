import { MessageRepository } from '@easytmp/db';
import { generateMessageId, parseRawEmail, validateMailboxName } from '@easytmp/shared';
import { InboundWorkerEnv, resolveConfig } from './config.js';
import { parseRawHeaders, verifyCloudflareDmarc } from './dmarc.js';
import { readStreamWithLimit } from './stream.js';

export type { InboundWorkerEnv, ResolvedConfig } from './config.js';

export default {
  /**
   * Cloudflare Email Worker entry point.
   */
  async email(
    message: ForwardableEmailMessage,
    env: InboundWorkerEnv,
    _ctx: ExecutionContext,
  ): Promise<void> {
    const config = resolveConfig(env);

    // 1. Recipient address validation & normalization
    if (typeof message.to !== 'string' || message.to.trim() === '') {
      message.setReject('Invalid recipient address');
      return;
    }

    let recipient = message.to.trim();
    const angleMatch = recipient.match(/<([^>]+)>/);
    if (angleMatch) {
      recipient = angleMatch[1].trim();
    }

    const atIndex = recipient.lastIndexOf('@');
    if (atIndex === -1 || atIndex === 0 || atIndex === recipient.length - 1) {
      message.setReject('Invalid recipient address');
      return;
    }

    const localPart = recipient.slice(0, atIndex);
    const domain = recipient.slice(atIndex + 1).toLowerCase();

    // Disallow extra @ in local part
    if (localPart.includes('@')) {
      message.setReject('Invalid recipient address');
      return;
    }

    if (domain !== config.mailDomain) {
      message.setReject(`Recipient domain must be ${config.mailDomain}`);
      return;
    }

    // Validate mailbox local-part name format
    const nameValidation = validateMailboxName(localPart);
    if (!nameValidation.valid || !nameValidation.name) {
      message.setReject('Invalid mailbox local part');
      return;
    }

    // Any valid mailbox name can directly receive emails without pre-registration
    const normalizedAddress = `${nameValidation.name}@${config.mailDomain}`;

    // 2. Check declared size if available on message runtime
    const declaredSize =
      typeof (message as unknown as { size?: number }).size === 'number'
        ? (message as unknown as { size: number }).size
        : typeof message.rawSize === 'number'
          ? message.rawSize
          : undefined;

    if (declaredSize !== undefined && declaredSize > config.maxEmailBytes) {
      message.setReject(`Email exceeds size limit of ${config.maxEmailBytes} bytes`);
      return;
    }

    // 3. Read raw email stream with streaming size check
    const streamResult = await readStreamWithLimit(message.raw, config.maxEmailBytes);
    if (streamResult.exceeded || !streamResult.buffer) {
      message.setReject(`Email exceeds size limit of ${config.maxEmailBytes} bytes`);
      return;
    }

    const rawBuffer = streamResult.buffer;

    // 4. Verify DMARC from Cloudflare-injected header
    const rawHeaders = parseRawHeaders(rawBuffer);
    const dmarcPass = verifyCloudflareDmarc(rawHeaders, message.headers);

    if (config.requireDmarcPass && !dmarcPass) {
      message.setReject('Email rejected: DMARC authentication pass is required');
      return;
    }

    // 5. Parse MIME email using shared parser
    const parsed = await parseRawEmail(
      rawBuffer.buffer.slice(
        rawBuffer.byteOffset,
        rawBuffer.byteOffset + rawBuffer.byteLength,
      ) as ArrayBuffer,
      {
        envelopeFrom: message.from,
        maxTextChars: config.maxTextChars,
        maxHtmlBytes: config.maxHtmlBytes,
      },
    );

    // 6. Timestamps: receivedAt is server time after parsing completes; 7-day retention
    const receivedAt = Date.now();
    const expiresAt = receivedAt + config.messageRetentionMs;
    const messageId = generateMessageId();

    // 7. Persist to D1
    // Let any D1 insertion failure throw so Cloudflare can record the failure/retry
    const repo = new MessageRepository(env.DB);
    await repo.insertMessage({
      id: messageId,
      address: normalizedAddress,
      envelopeFrom: parsed.envelopeFrom,
      from: parsed.from,
      subject: parsed.subject,
      textBody: parsed.textBody,
      textTruncated: parsed.textTruncated,
      htmlBody: parsed.htmlBody,
      htmlStatus: parsed.htmlStatus,
      codeCandidates: parsed.codeCandidates,
      links: parsed.links,
      dmarcPass,
      sizeBytes: streamResult.sizeBytes,
      receivedAt,
      expiresAt,
    });
  },

  /**
   * Cron Trigger entry point for scheduled expiration cleanup.
   * Runs in batches and respects a total deletion limit to prevent execution timeout.
   */
  async scheduled(
    _event: ScheduledEvent,
    env: InboundWorkerEnv,
    _ctx: ExecutionContext,
  ): Promise<void> {
    const config = resolveConfig(env);
    const repo = new MessageRepository(env.DB);
    const now = Date.now();

    let totalDeleted = 0;
    let deletedInBatch = 0;

    do {
      const remainingQuota = config.cronMaxTotalDelete - totalDeleted;
      const currentBatchLimit = Math.min(config.cronBatchSize, remainingQuota);

      deletedInBatch = await repo.deleteExpiredMessages(now, currentBatchLimit);
      totalDeleted += deletedInBatch;
    } while (deletedInBatch === config.cronBatchSize && totalDeleted < config.cronMaxTotalDelete);

    if (totalDeleted > 0) {
      // Log only aggregated count, avoiding any PII
      console.log(`Cron scheduled cleanup deleted ${totalDeleted} expired messages`);
    }
  },
};
