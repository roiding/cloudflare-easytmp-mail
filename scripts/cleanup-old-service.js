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
 * Historical cleanup utility for the original cottage.dpdns.org migration.
 * It is intentionally not part of `pnpm onboard`.
 *
 * Official Cloudflare REST API documentation references:
 * - DNS Records List:              https://developers.cloudflare.com/api/resources/dns/subresources/records/methods/list/
 * - DNS Records Delete:            https://developers.cloudflare.com/api/resources/dns/subresources/records/methods/delete/
 * - Worker Scripts GET:            https://developers.cloudflare.com/api/resources/workers/subresources/scripts/methods/get/
 * - Worker Scripts DELETE:         https://developers.cloudflare.com/api/resources/workers/subresources/scripts/methods/delete/
 */
export async function cleanupOldService({
  client,
  apply = false,
  oldWorkerName = null,
  newWorkerName = DEFAULT_WORKER_NAME,
  mailDomain = EXPECTED_MAIL_DOMAIN,
  stage = 'cleanup',
} = {}) {
  validateMailDomain(mailDomain, 'cleanupOldService');

  const cfClient =
    client ||
    new CloudflareClient({
      apiToken: validateApiToken(process.env.CLOUDFLARE_API_TOKEN, 'cleanupOldService'),
      zoneId: validateZoneId(process.env.CLOUDFLARE_ZONE_ID, 'cleanupOldService'),
      accountId: validateAccountId(process.env.CLOUDFLARE_ACCOUNT_ID, 'cleanupOldService'),
    });

  // Guard 1: Historical resource cleanup remains limited to the original
  // cottage.dpdns.org migration and cannot target an arbitrary new deployment.
  if (mailDomain !== 'cottage.dpdns.org') {
    throw new Error(
      `[HISTORICAL_ONLY] Cleanup is only available for cottage.dpdns.org; received "${mailDomain}". ` +
        'New deployments use `pnpm onboard` and never require legacy cleanup.',
    );
  }
  console.log(`[cleanup] Verifying zone "${mailDomain}"...`);
  const zoneInfo = await cfClient.verifyCottageZone();
  console.log(`[cleanup] Verified zone: ${zoneInfo.zoneName} (${zoneInfo.zoneId})`);

  // Phase 1: Collect inventory of old resources
  console.log('[cleanup] Gathering resource inventory from Cloudflare...');
  const [dnsRecords, emailRoutingSettings, catchAllRule, customRules, routingDns] =
    await Promise.all([
      cfClient.listDnsRecords({}, zoneInfo.zoneId),
      cfClient.getEmailRoutingSettings(),
      cfClient.getEmailRoutingCatchAllRule(),
      cfClient.listEmailRoutingRules(),
      cfClient.getEmailRoutingDnsSettings(),
    ]);

  const dnsRecordList = Array.isArray(dnsRecords) ? dnsRecords : dnsRecords?.result || [];
  const mxRecords = dnsRecordList.filter((r) => r.type === 'MX');
  const spfRecords = dnsRecordList.filter((r) => r.type === 'TXT' && r.content?.includes('v=spf1'));

  // Identify old worker candidate
  let resolvedOldWorker = oldWorkerName?.trim() || process.env.OLD_WORKER_NAME?.trim();

  if (!resolvedOldWorker) {
    const currentCatchAllAction = catchAllRule?.actions?.[0];
    if (
      currentCatchAllAction?.type === 'worker' &&
      Array.isArray(currentCatchAllAction.value) &&
      currentCatchAllAction.value[0]
    ) {
      const referencedWorker = currentCatchAllAction.value[0];
      if (referencedWorker !== newWorkerName) {
        resolvedOldWorker = referencedWorker;
        console.log(
          `[cleanup] Inferred old worker "${resolvedOldWorker}" from current catch-all rule destination.`,
        );
      }
    }
  }

  // Guard 2: Safety check on old worker
  if (!resolvedOldWorker) {
    throw new Error(
      '[SAFETY_BLOCK] Cannot safely identify old Worker script to remove.\n' +
        'Neither --old-worker flag nor OLD_WORKER_NAME env was provided, ' +
        'and the current catch-all rule does not reference a distinct old worker.\n' +
        'Refusing to guess or perform ambiguous deletion. Please provide --old-worker <name> if old worker deletion is needed.',
    );
  }

  if (resolvedOldWorker === newWorkerName) {
    throw new Error(
      `[SECURITY_REFUSAL] Identified old worker "${resolvedOldWorker}" matches the new service Worker name ("${newWorkerName}"). ` +
        'Aborting cleanup immediately to prevent deleting the active new service!',
    );
  }

  console.log(`[cleanup] Checking if old Worker "${resolvedOldWorker}" exists in account...`);
  const oldWorkerMeta = await cfClient.getWorkerScript(resolvedOldWorker);
  if (!oldWorkerMeta) {
    console.warn(
      `[cleanup] Old Worker "${resolvedOldWorker}" was not found in account (may have already been deleted).`,
    );
  } else {
    console.log(`[cleanup] Old Worker "${resolvedOldWorker}" located in account.`);
  }

  // Build complete inventory
  const inventory = {
    zone: zoneInfo,
    stage,
    newWorkerName,
    oldWorkerName: resolvedOldWorker,
    oldWorkerExists: Boolean(oldWorkerMeta),
    mxRecords: mxRecords.map((r) => ({
      id: r.id,
      name: r.name,
      content: r.content,
      priority: r.priority,
      locked: Boolean(r.locked),
    })),
    spfRecords: spfRecords.map((r) => ({
      id: r.id,
      name: r.name,
      content: r.content,
      locked: Boolean(r.locked),
    })),
    emailRouting: {
      settings: emailRoutingSettings,
      dnsSettings: routingDns,
      catchAllRule,
      customRulesCount: (customRules || []).length,
    },
    preservedResources: {
      d1Databases: 'PRESERVED (Worker deletion does not delete D1 databases)',
      kvNamespaces: 'PRESERVED (Worker deletion does not delete KV namespaces)',
      r2Buckets: 'PRESERVED (Worker deletion does not delete R2 buckets)',
      otherZones: 'PRESERVED (roiding.dpdns.org and all other zones untouched)',
    },
  };

  console.log('\n================ Old Service Inventory ================');
  console.log(JSON.stringify(inventory, null, 2));
  console.log('=======================================================\n');

  // Stage preflight: only inspect and backup
  if (stage === 'preflight' || !apply) {
    console.log('[cleanup] [DRY-RUN] Saving resource inventory backup...');
    const backup = saveSanitizedBackup('cleanup-inventory-dryrun', inventory, {
      zoneId: zoneInfo.zoneId,
      zoneName: zoneInfo.zoneName,
      oldWorker: resolvedOldWorker,
      stage,
    });
    console.log(`[cleanup] [DRY-RUN] Inventory backup written to: ${backup.filepath}`);
    console.log(
      '[cleanup] [DRY-RUN] Completed reviewable inventory and safety preflight. ' +
        'No remote resources were deleted or modified. Pass --apply --stage=cleanup to execute deletion.',
    );
    return {
      applied: false,
      dryRun: true,
      stage,
      inventory,
      backup,
    };
  }

  // Stage cleanup with --apply:
  console.log('[cleanup] [APPLY] Creating pre-cleanup backup before modifying resources...');
  const backup = saveSanitizedBackup('cleanup-pre-execution-backup', inventory, {
    zoneId: zoneInfo.zoneId,
    zoneName: zoneInfo.zoneName,
    oldWorker: resolvedOldWorker,
  });
  console.log(`[cleanup] [APPLY] Pre-execution backup saved to: ${backup.filepath}`);

  const auditLog = [];

  // The new service intentionally continues to use Cloudflare Email Routing on
  // the same domain. MX/SPF records are shared routing infrastructure and must
  // be preserved. Disabling them would make the newly deployed Worker unreachable.
  const currentCatchAllAction = catchAllRule?.actions?.[0];
  const currentCatchAllWorker =
    currentCatchAllAction?.type === 'worker' &&
    Array.isArray(currentCatchAllAction.value) &&
    currentCatchAllAction.value[0];
  if (currentCatchAllWorker !== newWorkerName) {
    throw new Error(
      `[SAFETY_BLOCK] Cleanup would remove Worker "${resolvedOldWorker}", but the catch-all rule ` +
        `does not target the new Worker "${newWorkerName}". ` +
        'Complete the switch stage and verify live mail delivery before deleting any old Worker.',
    );
  }

  console.log(
    '[cleanup] [APPLY] Preserving Email Routing MX/SPF records; they are active infrastructure for the new service.',
  );
  auditLog.push(`Preserved ${mxRecords.length} MX and ${spfRecords.length} SPF record(s)`);

  // Remove the old Worker only after the catch-all rule points to the new one.
  if (oldWorkerMeta) {
    console.log(`[cleanup] [APPLY] Deleting old Worker script "${resolvedOldWorker}"...`);
    await cfClient.deleteWorkerScript(resolvedOldWorker);
    auditLog.push(
      `Deleted Worker script "${resolvedOldWorker}" (D1, KV, and R2 databases remain intact)`,
    );
    console.log(
      `[cleanup] [APPLY] Worker script "${resolvedOldWorker}" deleted. Shared D1/KV/R2 were NOT touched.`,
    );
  } else {
    auditLog.push(`Worker script "${resolvedOldWorker}" not found; skipped`);
  }

  console.log('\n[cleanup] [APPLY] Cleanup execution finished successfully.');
  console.log('Actions performed:');
  auditLog.forEach((item) => console.log(` - ${item}`));

  return {
    applied: true,
    dryRun: false,
    stage,
    inventory,
    backup,
    auditLog,
  };
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const flags = parseCliFlags();
  cleanupOldService({
    apply: flags.apply,
    oldWorkerName: flags.oldWorker,
    stage: flags.stage || (flags.apply ? 'cleanup' : 'preflight'),
  }).catch((err) => {
    console.error(`\n[FATAL] ${err.message}`);
    process.exit(1);
  });
}
