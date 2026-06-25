/**
 * Copyright 2021-present, Facebook, Inc. All rights reserved.
 *
 * Temporary tenant storage in Redis (Memurai) until a real DB is added.
 */

"use strict";

const crypto = require("crypto");
const { getClient } = require("./redis");

const TENANT_PREFIX = "tenant:";
const PHONE_INDEX_PREFIX = "phone_index:";
const SESSION_PREFIX = "session:";
const TENANT_TTL_SECONDS = 60 * 60 * 24 * 30; // 30 days

function generateId() {
  return crypto.randomUUID();
}

module.exports = class TenantStore {
  static async saveTenant(data) {
    const client = getClient();
    const tenantId = data.tenantId || generateId();
    const tenant = {
      tenantId,
      wabaId: data.wabaId,
      phoneNumberId: String(data.phoneNumberId),
      accessToken: data.accessToken,
      displayPhone: data.displayPhone || null,
      businessName: data.businessName || null,
      connectedAt: data.connectedAt || Date.now()
    };

    await client.set(TENANT_PREFIX + tenantId, JSON.stringify(tenant), {
      EX: TENANT_TTL_SECONDS
    });
    await client.set(PHONE_INDEX_PREFIX + tenant.phoneNumberId, tenantId, {
      EX: TENANT_TTL_SECONDS
    });

    return tenant;
  }

  static async getTenant(tenantId) {
    if (!tenantId) return null;
    const client = getClient();
    const raw = await client.get(TENANT_PREFIX + tenantId);
    return raw ? JSON.parse(raw) : null;
  }

  static async getTenantByPhoneNumberId(phoneNumberId) {
    if (!phoneNumberId) return null;
    const client = getClient();
    const tenantId = await client.get(PHONE_INDEX_PREFIX + String(phoneNumberId));
    if (!tenantId) return null;
    return this.getTenant(tenantId);
  }

  static async createSession(tenantId) {
    const client = getClient();
    const sessionId = generateId();
    await client.set(SESSION_PREFIX + sessionId, tenantId, {
      EX: TENANT_TTL_SECONDS
    });
    return sessionId;
  }

  static async getTenantIdFromSession(sessionId) {
    if (!sessionId) return null;
    const client = getClient();
    return client.get(SESSION_PREFIX + sessionId);
  }

  static async deleteSession(sessionId) {
    if (!sessionId) return;
    const client = getClient();
    await client.del(SESSION_PREFIX + sessionId);
  }

  static toPublicTenant(tenant) {
    if (!tenant) return null;
    return {
      tenantId: tenant.tenantId,
      wabaId: tenant.wabaId,
      phoneNumberId: tenant.phoneNumberId,
      displayPhone: tenant.displayPhone,
      businessName: tenant.businessName,
      connectedAt: tenant.connectedAt
    };
  }
};
