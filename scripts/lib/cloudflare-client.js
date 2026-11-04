import { setTimeout as sleep } from 'node:timers/promises';
import {
  EXPECTED_MAIL_DOMAIN,
  validateApiToken,
  validateZoneId,
  validateAccountId,
} from './env.js';

export class CloudflareApiError extends Error {
  constructor(message, { status, errors = [], endpoint = '' } = {}) {
    super(message);
    this.name = 'CloudflareApiError';
    this.status = status;
    this.errors = errors;
    this.endpoint = endpoint;
  }
}

export class CloudflareClient {
  /**
   * @param {Object} options
   * @param {string} options.apiToken
   * @param {string} [options.zoneId]
   * @param {string} [options.accountId]
   * @param {string} [options.baseUrl]
   * @param {typeof fetch} [options.fetchFn]
   */
  constructor({
    apiToken,
    zoneId,
    accountId,
    baseUrl = 'https://api.cloudflare.com/client/v4',
    fetchFn = fetch,
  }) {
    this.apiToken = validateApiToken(apiToken, 'CloudflareClient initialization');
    this.zoneId = zoneId ? validateZoneId(zoneId, 'CloudflareClient initialization') : null;
    this.accountId = accountId
      ? validateAccountId(accountId, 'CloudflareClient initialization')
      : null;
    this.baseUrl = baseUrl.replace(/\/+$/, '');
    this.fetchFn = fetchFn;
  }

  async request(path, options = {}) {
    const url = `${this.baseUrl}${path.startsWith('/') ? path : `/${path}`}`;
    const headers = {
      Authorization: `Bearer ${this.apiToken}`,
      Accept: 'application/json',
      ...(options.headers || {}),
    };

    if (options.body && !headers['Content-Type']) {
      headers['Content-Type'] = 'application/json';
    }

    const response = await this.fetchFn(url, {
      ...options,
      headers,
    });

    let json;
    try {
      json = await response.json();
    } catch {
      throw new CloudflareApiError(
        `Cloudflare API returned non-JSON response (HTTP ${response.status}) at ${path}`,
        { status: response.status, endpoint: path },
      );
    }

    if (!response.ok || !json.success) {
      const errorSummary =
        json.errors?.map((e) => `[code ${e.code}] ${e.message}`).join(', ') ||
        `HTTP ${response.status}`;
      throw new CloudflareApiError(`Cloudflare API call failed on ${path}: ${errorSummary}`, {
        status: response.status,
        errors: json.errors || [],
        endpoint: path,
      });
    }

    return json.result;
  }

  // ==================== Zone Security Guard ====================

  async verifyConfiguredZone(expectedDomain = EXPECTED_MAIL_DOMAIN) {
    if (!this.zoneId) {
      throw new Error('[SECURITY_REFUSAL] Cannot verify zone: zoneId is missing.');
    }

    const zone = await this.getZone(this.zoneId);
    const zoneName = zone?.name?.toLowerCase();

    if (zoneName !== expectedDomain.toLowerCase()) {
      throw new Error(
        `[SECURITY_REFUSAL] Target zone "${zoneName}" (${this.zoneId}) does not match configured zone "${expectedDomain}". ` +
          'Refusing execution to avoid operating on unintended zones.',
      );
    }

    return {
      zoneId: this.zoneId,
      zoneName: zone.name,
      accountId: zone.account?.id || this.accountId,
      accountName: zone.account?.name,
      status: zone.status,
    };
  }

  async verifyCottageZone() {
    return this.verifyConfiguredZone(EXPECTED_MAIL_DOMAIN);
  }

  // ==================== Zone API ====================

  async getZone(zoneId = this.zoneId) {
    return this.request(`/zones/${zoneId}`);
  }

  async listZones(name) {
    const query = new URLSearchParams({ name, per_page: '50' });
    return this.request(`/zones?${query.toString()}`);
  }

  async findZoneByName(name) {
    const zones = await this.listZones(name);
    return (
      (Array.isArray(zones) ? zones : []).find(
        (zone) => zone.name?.toLowerCase() === name.toLowerCase(),
      ) || null
    );
  }

  // ==================== Email Routing Settings & Rules ====================

  /**
   * https://developers.cloudflare.com/api/resources/email_routing/methods/get/
   * GET /zones/{zone_id}/email/routing
   */
  async getEmailRoutingSettings(zoneId = this.zoneId) {
    return this.request(`/zones/${zoneId}/email/routing`);
  }

  async enableEmailRouting(zoneId = this.zoneId) {
    return this.request(`/zones/${zoneId}/email/routing/enable`, {
      method: 'POST',
      body: JSON.stringify({}),
    });
  }

  async ensureEmailRoutingReady(zoneId = this.zoneId, { maxAttempts = 12 } = {}) {
    let settings = await this.getEmailRoutingSettings(zoneId);
    if (settings?.enabled === true && settings?.status === 'ready') {
      return { settings, enabled: false };
    }

    try {
      await this.enableEmailRouting(zoneId);
    } catch (error) {
      // An enabled but asynchronously synchronising zone can reject the
      // create request. Re-read settings before deciding this is fatal.
      if (error.status !== 409) throw error;
    }
    for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
      settings = await this.getEmailRoutingSettings(zoneId);
      if (
        settings?.enabled === true &&
        (settings.status === undefined || settings.status === 'ready')
      ) {
        return { settings, enabled: true };
      }
      if (attempt < maxAttempts) {
        await sleep(5000);
      }
    }
    throw new Error(
      `[EMAIL_ROUTING_NOT_READY] Email Routing could not be enabled automatically ` +
        `(status: ${settings?.status || 'unknown'}).`,
    );
  }

  /**
   * https://developers.cloudflare.com/api/resources/email_routing/subresources/rules/subresources/catch_alls/methods/get/
   * GET /zones/{zone_id}/email/routing/rules/catch_all
   */
  async getEmailRoutingCatchAllRule(zoneId = this.zoneId) {
    return this.request(`/zones/${zoneId}/email/routing/rules/catch_all`);
  }

  /**
   * https://developers.cloudflare.com/api/resources/email_routing/subresources/rules/subresources/catch_alls/methods/update/
   * PUT /zones/{zone_id}/email/routing/rules/catch_all
   */
  async updateEmailRoutingCatchAllRule(rulePayload, zoneId = this.zoneId) {
    return this.request(`/zones/${zoneId}/email/routing/rules/catch_all`, {
      method: 'PUT',
      body: JSON.stringify(rulePayload),
    });
  }

  /**
   * https://developers.cloudflare.com/api/resources/email_routing/subresources/rules/methods/list/
   * GET /zones/{zone_id}/email/routing/rules
   */
  async listEmailRoutingRules(zoneId = this.zoneId) {
    return this.request(`/zones/${zoneId}/email/routing/rules`);
  }

  /**
   * DELETE /zones/{zone_id}/email/routing/rules/{rule_id}
   */
  async deleteEmailRoutingRule(ruleId, zoneId = this.zoneId) {
    return this.request(`/zones/${zoneId}/email/routing/rules/${ruleId}`, {
      method: 'DELETE',
    });
  }

  // ==================== Email Routing DNS (MX/SPF) ====================

  /**
   * https://developers.cloudflare.com/api/resources/email_routing/subresources/dns/methods/get/
   * GET /zones/{zone_id}/email/routing/dns
   */
  async getEmailRoutingDnsSettings(zoneId = this.zoneId) {
    return this.request(`/zones/${zoneId}/email/routing/dns`);
  }

  /**
   * https://developers.cloudflare.com/api/resources/email_routing/subresources/dns/methods/create/
   * POST /zones/{zone_id}/email/routing/dns (Enable Email Routing DNS & lock MX/SPF)
   */
  async enableEmailRoutingDns(zoneId = this.zoneId) {
    return this.request(`/zones/${zoneId}/email/routing/dns`, {
      method: 'POST',
    });
  }

  /**
   * https://developers.cloudflare.com/api/resources/email_routing/subresources/dns/methods/edit/
   * PATCH /zones/{zone_id}/email/routing/dns (Unlock Email Routing DNS records)
   */
  async unlockEmailRoutingDns(zoneId = this.zoneId) {
    return this.request(`/zones/${zoneId}/email/routing/dns`, {
      method: 'PATCH',
    });
  }

  /**
   * https://developers.cloudflare.com/api/resources/email_routing/subresources/dns/methods/delete/
   * DELETE /zones/{zone_id}/email/routing/dns (Disable Email Routing zone & remove managed MX)
   */
  async disableEmailRoutingDns(zoneId = this.zoneId) {
    return this.request(`/zones/${zoneId}/email/routing/dns`, {
      method: 'DELETE',
    });
  }

  // ==================== General DNS Records ====================

  /**
   * https://developers.cloudflare.com/api/resources/dns/subresources/records/methods/list/
   * GET /zones/{zone_id}/dns_records
   */
  async listDnsRecords({ type, name } = {}, zoneId = this.zoneId) {
    const params = new URLSearchParams({ per_page: '100' });
    if (type) params.set('type', type);
    if (name) params.set('name', name);
    const query = params.toString() ? `?${params.toString()}` : '';
    return this.request(`/zones/${zoneId}/dns_records${query}`);
  }

  async createDnsRecord(record, zoneId = this.zoneId) {
    return this.request(`/zones/${zoneId}/dns_records`, {
      method: 'POST',
      body: JSON.stringify(record),
    });
  }

  /**
   * DELETE /zones/{zone_id}/dns_records/{record_id}
   */
  async deleteDnsRecord(recordId, zoneId = this.zoneId) {
    return this.request(`/zones/${zoneId}/dns_records/${recordId}`, {
      method: 'DELETE',
    });
  }

  // ==================== Worker Scripts ====================

  /**
   * https://developers.cloudflare.com/api/resources/workers/subresources/scripts/methods/get/
   * GET /accounts/{account_id}/workers/scripts/{script_name}
   */
  async getWorkerScript(scriptName, accountId = this.accountId) {
    const scripts = await this.listWorkerScripts(accountId);
    return (
      (Array.isArray(scripts) ? scripts : []).find((script) => script.id === scriptName) || null
    );
  }

  /**
   * GET /accounts/{account_id}/workers/scripts
   */
  async listWorkerScripts(accountId = this.accountId) {
    return this.request(`/accounts/${accountId}/workers/scripts`);
  }

  async findWorkerScript(scriptName, accountId = this.accountId) {
    const scripts = await this.listWorkerScripts(accountId);
    return (
      (Array.isArray(scripts) ? scripts : []).find((script) => script.id === scriptName) || null
    );
  }

  async waitForWorkerScript(scriptName, { accountId = this.accountId, maxAttempts = 10 } = {}) {
    for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
      const script = await this.findWorkerScript(scriptName, accountId);
      if (script) return script;
      if (attempt < maxAttempts) {
        await sleep(500 * attempt);
      }
    }
    return null;
  }

  // ==================== D1 Databases ====================

  async listD1Databases(accountId = this.accountId) {
    const query = new URLSearchParams({ per_page: '100' });
    return this.request(`/accounts/${accountId}/d1/database?${query.toString()}`);
  }

  async findD1DatabaseByName(name, accountId = this.accountId) {
    const databases = await this.listD1Databases(accountId);
    return (
      (Array.isArray(databases) ? databases : []).find((database) => database.name === name) || null
    );
  }

  async createD1Database(name, location = 'apac', accountId = this.accountId) {
    return this.request(`/accounts/${accountId}/d1/database`, {
      method: 'POST',
      body: JSON.stringify({ name, primary_location_hint: location }),
    });
  }

  /**
   * https://developers.cloudflare.com/api/resources/workers/subresources/scripts/methods/delete/
   * DELETE /accounts/{account_id}/workers/scripts/{script_name}
   */
  async deleteWorkerScript(scriptName, accountId = this.accountId) {
    return this.request(`/accounts/${accountId}/workers/scripts/${scriptName}`, {
      method: 'DELETE',
    });
  }

  // ==================== Pages Custom Domains ====================

  /**
   * GET /accounts/{account_id}/pages/projects/{project_name}
   */
  async getPagesProject(projectName, accountId = this.accountId) {
    return this.request(`/accounts/${accountId}/pages/projects/${projectName}`);
  }

  async findPagesProject(projectName, accountId = this.accountId) {
    try {
      return await this.getPagesProject(projectName, accountId);
    } catch (error) {
      if (error.status === 404 || error.errors?.some((item) => item.code === 8000007)) {
        return null;
      }
      throw error;
    }
  }

  async createPagesProject(projectName, accountId = this.accountId) {
    return this.request(`/accounts/${accountId}/pages/projects`, {
      method: 'POST',
      body: JSON.stringify({
        name: projectName,
        production_branch: 'main',
        deployment_configs: {
          production: {
            compatibility_date: '2024-11-01',
            compatibility_flags: ['nodejs_compat'],
          },
          preview: {
            compatibility_date: '2024-11-01',
            compatibility_flags: ['nodejs_compat'],
          },
        },
      }),
    });
  }

  async updatePagesProjectConfig(
    projectName,
    { d1DatabaseId, mailDomain, webHostname, accountId = this.accountId } = {},
  ) {
    if (!d1DatabaseId || !mailDomain || !webHostname) {
      throw new Error(
        '[CONFIG_ERROR] Pages configuration requires d1DatabaseId, mailDomain, and webHostname.',
      );
    }
    return this.request(`/accounts/${accountId}/pages/projects/${projectName}`, {
      method: 'PATCH',
      body: JSON.stringify({
        deployment_configs: {
          production: {
            env_vars: {
              MAIL_DOMAIN: { type: 'plain_text', value: mailDomain },
              WEB_HOSTNAME: { type: 'plain_text', value: webHostname },
            },
            d1_databases: {
              DB: { id: d1DatabaseId },
            },
            compatibility_date: '2024-11-01',
            compatibility_flags: ['nodejs_compat'],
          },
        },
      }),
    });
  }

  // ==================== Resource Provisioning ====================

  async ensureD1Database(name, { location = 'apac', accountId = this.accountId } = {}) {
    const existing = await this.findD1DatabaseByName(name, accountId);
    if (existing) {
      return { database: existing, created: false };
    }
    try {
      return { database: await this.createD1Database(name, location, accountId), created: true };
    } catch (error) {
      // A concurrent retry may have created the same named database.
      const raced = await this.findD1DatabaseByName(name, accountId);
      if (raced) return { database: raced, created: false };
      throw error;
    }
  }

  async ensurePagesProject(projectName, accountId = this.accountId) {
    const existing = await this.findPagesProject(projectName, accountId);
    if (existing) {
      return { project: existing, created: false };
    }
    try {
      return { project: await this.createPagesProject(projectName, accountId), created: true };
    } catch (error) {
      const raced = await this.findPagesProject(projectName, accountId);
      if (raced) return { project: raced, created: false };
      throw error;
    }
  }

  /**
   * https://developers.cloudflare.com/api/resources/pages/subresources/projects/subresources/domains/methods/list/
   * GET /accounts/{account_id}/pages/projects/{project_name}/domains
   */
  async listPagesDomains(projectName, accountId = this.accountId) {
    return this.request(`/accounts/${accountId}/pages/projects/${projectName}/domains`);
  }

  /**
   * https://developers.cloudflare.com/api/resources/pages/subresources/projects/subresources/domains/methods/create/
   * POST /accounts/{account_id}/pages/projects/{project_name}/domains
   */
  async addPagesDomain(projectName, domainName, accountId = this.accountId) {
    return this.request(`/accounts/${accountId}/pages/projects/${projectName}/domains`, {
      method: 'POST',
      body: JSON.stringify({ name: domainName }),
    });
  }

  async waitForPagesDomain(
    projectName,
    domainName,
    { accountId = this.accountId, maxAttempts = 24 } = {},
  ) {
    for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
      const domains = await this.listPagesDomains(projectName, accountId);
      const domain = (Array.isArray(domains) ? domains : []).find(
        (item) => item.name?.toLowerCase() === domainName.toLowerCase(),
      );
      if (domain?.status === 'active') return domain;
      if (domain?.status === 'blocked' || domain?.status === 'error') {
        throw new Error(
          `[PAGES_DOMAIN_FAILED] ${domainName} has status "${domain.status}". ` +
            'Check Cloudflare Pages domain validation details.',
        );
      }
      if (attempt < maxAttempts) {
        await sleep(5000);
      }
    }
    return null;
  }

  async ensureProxiedCname(name, target, zoneId = this.zoneId) {
    if (!zoneId) throw new Error('[CONFIG_ERROR] zoneId is required to manage DNS.');
    const records = await this.listDnsRecords({ type: 'CNAME', name }, zoneId);
    const exact = (Array.isArray(records) ? records : []).find(
      (record) => record.type === 'CNAME' && record.name?.toLowerCase() === name.toLowerCase(),
    );
    if (exact) return { record: exact, created: false };
    return {
      record: await this.createDnsRecord(
        {
          type: 'CNAME',
          name,
          content: target,
          proxied: true,
          ttl: 1,
          comment: 'EasyTmp Pages custom hostname',
        },
        zoneId,
      ),
      created: true,
    };
  }
}
