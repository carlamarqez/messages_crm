/**
 * Copyright 2021-present, Facebook, Inc. All rights reserved.
 *
 * Stores raw webhook payloads in Redis for debugging / inspection.
 */

"use strict";

const { getClient } = require("./redis");

const LOG_PREFIX = "webhook:log:";
const MAX_LOGS = 50;

module.exports = class WebhookLog {
  static async append(tenantId, payload) {
    const client = getClient();
    const key = LOG_PREFIX + (tenantId || "unknown");
    const entry = JSON.stringify({
      timestamp: Date.now(),
      payload
    });
    await client.lPush(key, entry);
    await client.lTrim(key, 0, MAX_LOGS - 1);
  }

  static async getLogs(tenantId, limit = 20) {
    const client = getClient();
    const key = LOG_PREFIX + (tenantId || "unknown");
    const items = await client.lRange(key, 0, limit - 1);
    return items.map((item) => JSON.parse(item));
  }
};
