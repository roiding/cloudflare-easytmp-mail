import {
  EXPECTED_MAIL_DOMAIN,
  FORBIDDEN_DOMAIN,
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

  /**
   * Strictly verifies that the configured zone matches cottage.dpdns.org
   * and blocks any execution targeting roiding.dpdns.org or other zones.
   */
  async verifyCottageZone() {
    if (!this.zoneId) {
      throw new Error('[SECURITY_REFUSAL] Cannot verify zone: zoneId is missing.');
    }

    const zone = await this.getZone(this.zoneId);
    const zoneName = zone?.name?.toLowerCase();

    if (zoneName === FORBIDDEN_DOMAIN || zoneName?.includes('roiding')) {
      throw new Error(
        `[SECURITY_REFUSAL] Target zone "${zoneName}" (${this.zoneId}) matches forbidden domain "${FORBIDDEN_DOMAIN}". ` +
          'All operations targeting roiding.dpdns.org are strictly forbidden.',
      );
    }

    if (zoneName !== EXPECTED_MAIL_DOMAIN) {
      throw new Error(
        `[SECURITY_REFUSAL] Target zone "${zoneName}" (${this.zoneId}) does not match expected zone "${EXPECTED_MAIL_DOMAIN}". ` +
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

  // ==================== Zone API ====================

  async getZone(zoneId = this.zoneId) {
    return this.request(`/zones/${zoneId}`);
  }

  // ==================== Email Routing Settings & Rules ====================

  /**
   * https://developers.cloudflare.com/api/resources/email_routing/methods/get/
   * GET /zones/{zone_id}/email/routing
   */
  async getEmailRoutingSettings(zoneId = this.zoneId) {
    return this.request(`/zones/${zoneId}/email/routing`);
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
    const params = new URLSearchParams();
    if (type) params.set('type', type);
    if (name) params.set('name', name);
    const query = params.toString() ? `?${params.toString()}` : '';
    return this.request(`/zones/${zoneId}/dns_records${query}`);
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
    try {
      return await this.request(`/accounts/${accountId}/workers/scripts/${scriptName}`);
    } catch (err) {
      if (err instanceof CloudflareApiError && err.status === 404) {
        return null;
      }
      throw err;
    }
  }

  /**
   * GET /accounts/{account_id}/workers/scripts
   */
  async listWorkerScripts(accountId = this.accountId) {
    return this.request(`/accounts/${accountId}/workers/scripts`);
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
}
