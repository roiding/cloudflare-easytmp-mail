import { fileURLToPath } from 'node:url';
import {
  DEFAULT_WORKER_NAME,
  EXPECTED_MAIL_DOMAIN,
  parseCliFlags,
  validateAccountId,
  validateApiToken,
  validateMailDomain,
  validateZoneId,
} from './lib/env.js';
import { CloudflareClient } from './lib/cloudflare-client.js';
import { saveSanitizedBackup } from './lib/backup.js';

/**
 * Configure Email Routing catch-all action to easytmp-mail-inbound Worker.
 *
 * Official Cloudflare REST API documentation references:
 * - Email Routing Settings: https://developers.cloudflare.com/api/resources/email_routing/methods/get/
 * - Catch-all Rule GET:     https://developers.cloudflare.com/api/resources/email_routing/subresources/rules/subresources/catch_alls/methods/get/
 * - Catch-all Rule PUT:     https://developers.cloudflare.com/api/resources/email_routing/subresources/rules/subresources/catch_alls/methods/update/
 * - Worker Scripts GET:     https://developers.cloudflare.com/api/resources/workers/subresources/scripts/methods/get/
 */
export async function configureEmailRouting({
  client,
  apply = false,
  targetWorker = DEFAULT_WORKER_NAME,
  mailDomain = EXPECTED_MAIL_DOMAIN,
  zoneId = process.env.CLOUDFLARE_ZONE_ID,
  ensureEnabled = false,
} = {}) {
  validateMailDomain(mailDomain, 'configureEmailRouting');

  const cfClient =
    client ||
    new CloudflareClient({
      apiToken: validateApiToken(process.env.CLOUDFLARE_API_TOKEN, 'configureEmailRouting'),
      zoneId: validateZoneId(zoneId, 'configureEmailRouting'),
      accountId: validateAccountId(process.env.CLOUDFLARE_ACCOUNT_ID, 'configureEmailRouting'),
    });

  console.log(`[email-routing] Verifying zone "${mailDomain}"...`);
  const zoneInfo = await cfClient.verifyConfiguredZone(mailDomain);
  console.log(`[email-routing] Verified zone: ${zoneInfo.zoneName} (${zoneInfo.zoneId})`);

  console.log('[email-routing] Fetching Email Routing settings...');
  let settings;
  if (ensureEnabled && apply) {
    const routing = await cfClient.ensureEmailRoutingReady();
    settings = routing.settings;
    if (routing.enabled) {
      console.log('[email-routing] [APPLY] Email Routing was enabled and is ready.');
    }
  } else {
    settings = await cfClient.getEmailRoutingSettings();
  }
  console.log(
    `[email-routing] Email Routing status: ${settings?.status || 'unknown'}, enabled: ${Boolean(
      settings?.enabled,
    )}`,
  );

  if (
    settings?.enabled !== true ||
    (settings?.status !== undefined &&
      settings.status !== 'ready' &&
      settings.status !== 'configured')
  ) {
    // Enablement is exposed by the Dashboard/API zone lifecycle; failing here
    // is safer than silently leaving an unreachable catch-all rule.
    throw new Error(
      `[EMAIL_ROUTING_NOT_READY] ${mailDomain} must have Email Routing enabled and ready ` +
        `before deployment (current status: ${settings?.status || 'unknown'}).`,
    );
  }

  console.log(`[email-routing] Verifying target Worker script "${targetWorker}" in account...`);
  const workerMeta = await cfClient.getWorkerScript(targetWorker);
  if (!workerMeta) {
    console.warn(
      `[email-routing] WARNING: Worker script "${targetWorker}" not found in account yet. ` +
        'Please ensure the worker is deployed before traffic arrives.',
    );
  } else {
    console.log(`[email-routing] Target Worker "${targetWorker}" exists in account.`);
  }

  console.log('[email-routing] Fetching current catch-all rule...');
  const currentRule = await cfClient.getEmailRoutingCatchAllRule();

  const currentAction = currentRule?.actions?.[0];
  const isAlreadyConfigured =
    currentRule?.enabled === true &&
    currentAction?.type === 'worker' &&
    Array.isArray(currentAction?.value) &&
    currentAction.value.includes(targetWorker);

  const desiredRule = {
    actions: [
      {
        type: 'worker',
        value: [targetWorker],
      },
    ],
    matchers: [
      {
        type: 'all',
      },
    ],
    enabled: true,
    name: `Catch-all to ${targetWorker}`,
    source: 'api',
  };

  if (isAlreadyConfigured) {
    console.log(
      `[email-routing] Catch-all rule is already active and routing to Worker "${targetWorker}".`,
    );
    return {
      modified: false,
      dryRun: !apply,
      currentRule,
      desiredRule,
    };
  }

  console.log('\n--- Proposed Catch-all Rule Changes ---');
  console.log('Current catch-all state:', JSON.stringify(currentRule || {}, null, 2));
  console.log('Desired catch-all state:', JSON.stringify(desiredRule, null, 2));
  console.log('----------------------------------------\n');

  if (!apply) {
    console.log(
      '[email-routing] [DRY-RUN] Dry run complete. No modifications made. Pass --apply to update Cloudflare Email Routing.',
    );
    return {
      modified: false,
      dryRun: true,
      currentRule,
      desiredRule,
    };
  }

  // Backup current state before apply
  console.log('[email-routing] [APPLY] Backing up current Email Routing configuration...');
  const backup = saveSanitizedBackup(
    'email-routing-backup',
    {
      settings,
      catchAllRule: currentRule,
      proposedRule: desiredRule,
    },
    {
      zoneId: zoneInfo.zoneId,
      zoneName: zoneInfo.zoneName,
      targetWorker,
    },
  );
  console.log(`[email-routing] [APPLY] Sanitized backup saved to: ${backup.filepath}`);

  console.log('[email-routing] [APPLY] Updating catch-all rule via Cloudflare API...');
  const updatedRule = await cfClient.updateEmailRoutingCatchAllRule(desiredRule);
  console.log('[email-routing] [APPLY] Catch-all rule successfully updated:');
  console.log(JSON.stringify(updatedRule, null, 2));

  return {
    modified: true,
    dryRun: false,
    backup,
    updatedRule,
  };
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const flags = parseCliFlags();
  configureEmailRouting({ apply: flags.apply }).catch((err) => {
    console.error(`\n[FATAL] ${err.message}`);
    process.exit(1);
  });
}
