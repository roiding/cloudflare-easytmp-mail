import { fileURLToPath } from 'node:url';
import { parseCliFlags } from './lib/env.js';

export async function runSmokeTests({
  baseUrl = process.env.BASE_URL || 'https://inbox.cottage.dpdns.org',
  fetchFn = fetch,
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

  // Test 3: Random address generation
  let randomName = null;
  try {
    const res = await fetchFn(`${normalizedBaseUrl}/api/v1/addresses/random`);
    const data = await res.json();

    const ok =
      res.status === 200 &&
      typeof data.address === 'string' &&
      typeof data.name === 'string' &&
      data.domain === 'cottage.dpdns.org';

    randomName = data.name;
    recordTest(
      'Random Address Generation (GET /api/v1/addresses/random)',
      ok,
      `HTTP ${res.status}, generated address: ${data.address || 'none'}`,
    );
  } catch (err) {
    recordTest('Random Address Generation (GET /api/v1/addresses/random)', false, err.message);
  }

  // Test 4: Mailbox message list
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
      `  1. Send an email from an external mailbox (e.g. Gmail) to: ${randomName || 'test'}@cottage.dpdns.org\n` +
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
