import { fileURLToPath } from 'node:url';
import {
  DEFAULT_PAGES_PROJECT,
  EXPECTED_PAGES_DOMAIN,
  parseCliFlags,
  validateAccountId,
  validateApiToken,
} from './lib/env.js';
import { CloudflareClient } from './lib/cloudflare-client.js';

/**
 * Configure and verify Cloudflare Pages custom domain binding for inbox.cottage.dpdns.org.
 *
 * Official Cloudflare REST API documentation references:
 * - Pages Domains List:   https://developers.cloudflare.com/api/resources/pages/subresources/projects/subresources/domains/methods/list/
 * - Pages Domains Create: https://developers.cloudflare.com/api/resources/pages/subresources/projects/subresources/domains/methods/create/
 */
export async function configurePagesDomain({
  client,
  apply = false,
  projectName = DEFAULT_PAGES_PROJECT,
  customDomain = EXPECTED_PAGES_DOMAIN,
  zoneId = process.env.CLOUDFLARE_ZONE_ID,
} = {}) {
  const targetDomain = customDomain.trim().toLowerCase();

  const cfClient =
    client ||
    new CloudflareClient({
      apiToken: validateApiToken(process.env.CLOUDFLARE_API_TOKEN, 'configurePagesDomain'),
      accountId: validateAccountId(process.env.CLOUDFLARE_ACCOUNT_ID, 'configurePagesDomain'),
      zoneId,
    });

  console.log(
    `[pages-domain] Inspecting custom domains on Pages project "${projectName}" for "${targetDomain}"...`,
  );
  const domains = await cfClient.listPagesDomains(projectName);
  const domainList = Array.isArray(domains)
    ? domains
    : Array.isArray(domains?.result)
      ? domains.result
      : [];
  const existing = domainList.find((d) => d.name?.toLowerCase() === targetDomain);

  if (existing) {
    console.log(`[pages-domain] Found existing custom domain "${targetDomain}".`);
    console.log(`[pages-domain] Domain Status: ${existing.status || 'unknown'}`);
    if (existing.validation_data) {
      console.log('Validation Details:', JSON.stringify(existing.validation_data, null, 2));
    }
    return {
      bound: true,
      dryRun: !apply,
      status: existing.status,
      domain: existing,
    };
  }

  console.log(`[pages-domain] Custom domain "${targetDomain}" is not currently bound.`);

  if (!apply) {
    console.log(
      `[pages-domain] [DRY-RUN] Would bind custom domain "${targetDomain}" to Pages project "${projectName}".`,
    );
    console.log(
      '[pages-domain] [DRY-RUN] No changes made to Cloudflare. Pass --apply to submit domain addition.',
    );
    return {
      bound: false,
      dryRun: true,
    };
  }

  console.log(
    `[pages-domain] [APPLY] Adding custom domain "${targetDomain}" to Pages project "${projectName}"...`,
  );
  const result = await cfClient.addPagesDomain(projectName, targetDomain);

  console.log(
    `[pages-domain] [APPLY] Domain addition response (status: ${result?.status || 'created'}):`,
  );
  console.log(JSON.stringify(result, null, 2));

  // A proxied Pages hostname is attached to the Pages project. DNS records
  // created by a prior generic proxy rule are replaced in a follow-up deploy.
  const dnsRecords = await cfClient.listDnsRecords({ type: 'CNAME', name: targetDomain });
  const dnsRecordList = Array.isArray(dnsRecords) ? dnsRecords : [];
  const exactDns = dnsRecordList.find(
    (record) => record.type === 'CNAME' && record.name?.toLowerCase() === targetDomain,
  );
  if (exactDns) {
    console.log(`[pages-domain] Existing CNAME ${exactDns.id} remains present.`);
  } else {
    console.log(
      `[pages-domain] Add a proxied CNAME ${targetDomain} -> ${projectName}.pages.dev if ` +
        'Cloudflare does not create it automatically.',
    );
  }

  if (result?.status === 'initializing' || result?.validation_data?.status === 'initializing') {
    console.log('\n--- DNS Configuration Notice ---');
    console.log(
      `If DNS is not managed automatically, ensure a CNAME record exists:\n` +
        `  Host: ${targetDomain}\n` +
        `  Target: ${projectName}.pages.dev\n` +
        `Cloudflare will automatically issue and renew the SSL/TLS certificate once DNS resolves.`,
    );
    console.log('--------------------------------\n');
  }

  return {
    bound: true,
    dryRun: false,
    domain: result,
  };
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const flags = parseCliFlags();
  configurePagesDomain({ apply: flags.apply }).catch((err) => {
    console.error(`\n[FATAL] ${err.message}`);
    process.exit(1);
  });
}
