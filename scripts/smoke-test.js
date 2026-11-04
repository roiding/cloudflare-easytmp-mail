import { fileURLToPath } from 'node:url';
import { parseCliFlags } from './lib/env.js';
import { setTimeout as sleep } from 'node:timers/promises';

async function waitForHttpsReady(baseUrl, { fetchFn = fetch, maxAttempts = 12 } = {}) {
  for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
    try {
      const res = await fetchFn(`${baseUrl}/api/health`);
      if (res.status === 200) return true;
    } catch {
      // A newly bound custom hostname may still be propagating its TLS route.
    }
    if (attempt < maxAttempts) await sleep(Math.min(attempt * 1000, 5000));
  }
  return false;
}

export async function runSmokeTests({
  baseUrl = process.env.BASE_URL || 'https://inbox.cottage.dpdns.org',
  expectedMailDomain = process.env.MAIL_DOMAIN,
  fetchFn = fetch,
  waitForHttps = false,
} = {}) {
  const normalizedBaseUrl = baseUrl.replace(/\/+$/, '');
  console.log(`\n================ Smoke Test Suite ================`);
  console.log(`Target Base URL: ${normalizedBaseUrl}\n`);

  const results = {
    target: normalizedBaseUrl,
    timestamp: new Date().toISOString(),
    tests: [],
    passed: true,
  };

  const recordTest = (name, ok, details = '') => {
    results.tests.push({ name, ok, details });
    if (!ok) results.passed = false;
    const mark = ok ? '✓ PASS' : '✗ FAIL';
    console.log(`[${mark}] ${name} ${details ? `(${details})` : ''}`);
  };

  if (waitForHttps && !(await waitForHttpsReady(normalizedBaseUrl, { fetchFn }))) {
    recordTest('HTTPS Endpoint Availability', false, 'No HTTP 200 health response after retries');
  } else if (waitForHttps) {
    recordTest('HTTPS Endpoint Availability', true, 'Health endpoint responded with HTTP 200');
  }

  // Test 1: Static assets & security headers
  try {
    const res = await fetchFn(`${normalizedBaseUrl}/`);
    const csp = res.headers.get('content-security-policy') || '';
    const nosniff = res.headers.get('x-content-type-options') || '';
    const text = await res.text();

    const hasHtml = text.includes('<html') || text.includes('<!DOCTYPE html');
    const hasCsp = csp.includes("frame-src 'self' about:") || csp.length > 0;
    const hasNosniff = nosniff === 'nosniff';

    recordTest(
      'Static Asset & Security Headers (GET /)',
      res.status === 200 && hasHtml && hasNosniff,
      `HTTP ${res.status}, CSP present: ${Boolean(hasCsp)}, nosniff: ${hasNosniff}`,
    );
  } catch (err) {
    recordTest('Static Asset & Security Headers (GET /)', false, err.message);
  }

  // Test 2: Health check endpoint
  let serverTime = null;
  try {
    const res = await fetchFn(`${normalizedBaseUrl}/api/health`);
    const cacheControl = res.headers.get('cache-control') || '';
    const data = await res.json();

    const ok =
      res.status === 200 &&
      data.status === 'ok' &&
      data.service === 'easytmp-mail' &&
      data.apiVersion === '1' &&
      typeof data.serverTime === 'number';

    serverTime = data.serverTime;
    recordTest(
      'API Health Endpoint (GET /api/health)',
      ok,
      `HTTP ${res.status}, status: ${data.status}, serverTime: ${serverTime}, cache-control: ${cacheControl}`,
    );
  } catch (err) {
    recordTest('API Health Endpoint (GET /api/health)', false, err.message);
  }

  // Test 3: Public deployment configuration
  try {
    const res = await fetchFn(`${normalizedBaseUrl}/api/config`);
    const data = await res.json();
    const domainMatches =
      typeof data.mailDomain === 'string' &&
      (!expectedMailDomain || data.mailDomain.toLowerCase() === expectedMailDomain.toLowerCase());
    const ok =
      res.status === 200 &&
      domainMatches &&
      typeof data.webHostname === 'string' &&
      data.retentionSeconds === 604800 &&
      data.addressPolicy?.minLength === 1 &&
      data.addressPolicy?.maxLength === 64;
    recordTest(
      'Service Configuration (GET /api/config)',
      ok,
      `HTTP ${res.status}, mailDomain: ${data.mailDomain || 'none'}, retentionSeconds: ${data.retentionSeconds ?? 'none'}`,
    );
  } catch (err) {
    recordTest('Service Configuration (GET /api/config)', false, err.message);
  }

  // Test 4: Random address generation
  let randomName = null;
  try {
    const res = await fetchFn(`${normalizedBaseUrl}/api/v1/addresses/random`);
    const data = await res.json();
    const actualMailDomain =
      String(data.address || '')
        .split('@')
        .pop() || '';

    const ok =
      res.status === 200 &&
      typeof data.address === 'string' &&
      typeof data.name === 'string' &&
      typeof data.serverTime === 'number' &&
      (!expectedMailDomain || actualMailDomain.toLowerCase() === expectedMailDomain.toLowerCase());

    randomName = data.name;
    recordTest(
      'Random Address Generation (GET /api/v1/addresses/random)',
      ok,
      `HTTP ${res.status}, generated address: ${data.address || 'none'}`,
    );
  } catch (err) {
    recordTest('Random Address Generation (GET /api/v1/addresses/random)', false, err.message);
  }

  // Test 5: Mailbox message list
  try {
    const mailbox = randomName || 'smoke-test-mailbox';
    const res = await fetchFn(`${normalizedBaseUrl}/api/v1/mailboxes/${mailbox}/messages`);
    const data = await res.json();

    const ok =
      res.status === 200 && Array.isArray(data.messages) && typeof data.pagination === 'object';

    recordTest(
      `Mailbox Messages Query (GET /api/v1/mailboxes/${mailbox}/messages)`,
      ok,
      `HTTP ${res.status}, messages count: ${data.messages?.length ?? 'none'}`,
    );
  } catch (err) {
    recordTest('Mailbox Messages Query', false, err.message);
  }

  console.log('\n--- Real Inbound Email Delivery Verification Guidance ---');
  console.log(
    'To perform an end-to-end inbound live test:\n' +
      `  1. Send an email from an external mailbox (e.g. Gmail) to: ${randomName || 'test'}@${expectedMailDomain || '<mailDomain>'}\n` +
      `  2. Query: ${normalizedBaseUrl}/api/v1/mailboxes/${randomName || 'test'}/messages\n` +
      '  3. Confirm the message appears within seconds with dmarcPass=true and extracted verification codes.\n' +
      '  4. Confirm message expires in exactly 7 days (receivedAt + 604800000).',
  );
  console.log('---------------------------------------------------------\n');

  if (!results.passed) {
    console.error('[smoke-test] One or more smoke tests failed.');
  } else {
    console.log('[smoke-test] All smoke tests passed successfully.');
  }

  return results;
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const flags = parseCliFlags();
  runSmokeTests({ baseUrl: flags.url || process.env.BASE_URL }).then((results) => {
    if (!results.passed) {
      process.exit(1);
    }
  });
}
