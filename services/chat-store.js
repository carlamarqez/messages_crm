/**
 * Copyright 2021-present, Facebook, Inc. All rights reserved.
 */

"use strict";

const { getClient } = require("./redis");

const MAX_MESSAGES = 200;

function digitsOnly(phone) {
  return String(phone).replace(/\D/g, "");
}

function canonicalPhone(phone) {
  const d = digitsOnly(phone);
  if (d.startsWith("549") && d.length === 13) {
    return "54" + d.slice(3);
  }
  return d;
}

function alternatePhone(phone) {
  const d = canonicalPhone(phone);
  if (d.startsWith("54") && d.length === 12 && d[2] !== "9") {
    return "549" + d.slice(2);
  }
  return null;
}

function toApiPhone(phone) {
  return canonicalPhone(phone);
}

function tenantKeys(tenantId) {
  const tid = tenantId || "default";
  return {
    indexKey: `chat:index:${tid}`,
    msgPrefix: `chat:msg:${tid}:`,
    lastWebhookKey: `chat:last_webhook:${tid}`
  };
}

function extractText(rawMessage) {
  switch (rawMessage.type) {
    case "text":
      return rawMessage.text?.body || "";
    case "interactive":
      if (rawMessage.interactive?.button_reply) {
        return rawMessage.interactive.button_reply.title
          || rawMessage.interactive.button_reply.id;
      }
      if (rawMessage.interactive?.list_reply) {
        return rawMessage.interactive.list_reply.title
          || rawMessage.interactive.list_reply.id;
      }
      return "[interactive]";
    case "image":
      return rawMessage.image?.caption || "[image]";
    case "audio":
      return "[audio]";
    case "video":
      return rawMessage.video?.caption || "[video]";
    case "document":
      return rawMessage.document?.filename || "[document]";
    case "location":
      return "[location]";
    case "sticker":
      return "[sticker]";
    default:
      return `[${rawMessage.type || "message"}]`;
  }
}

async function fetchMessagesForKey(client, key, limit) {
  const items = await client.lRange(key, 0, limit - 1);
  return items.map((item) => JSON.parse(item));
}

module.exports = class ChatStore {
  static canonicalPhone = canonicalPhone;
  static toApiPhone = toApiPhone;
  static normalizePhone = canonicalPhone;

  static async markWebhookReceived(tenantId) {
    const client = getClient();
    const { lastWebhookKey } = tenantKeys(tenantId);
    await client.set(lastWebhookKey, String(Date.now()));
  }

  static async getLastWebhookAt(tenantId) {
    const client = getClient();
    const { lastWebhookKey } = tenantKeys(tenantId);
    const val = await client.get(lastWebhookKey);
    return val ? parseInt(val, 10) : null;
  }

  static async addIncoming(rawMessage, tenantId) {
    const phone = canonicalPhone(rawMessage.from);
    const text = extractText(rawMessage);
    await this.markWebhookReceived(tenantId);
    return this.addMessage({
      tenantId,
      phone,
      text,
      direction: "in",
      messageId: rawMessage.id,
      type: rawMessage.type
    });
  }

  static async addOutgoing(phone, text, messageId, tenantId) {
    return this.addMessage({
      tenantId,
      phone: canonicalPhone(phone),
      text,
      direction: "out",
      messageId: messageId || null,
      type: "text"
    });
  }

  static async addMessage({ tenantId, phone, text, direction, messageId, type }) {
    const client = getClient();
    const canonical = canonicalPhone(phone);
    const { indexKey, msgPrefix } = tenantKeys(tenantId);
    const entry = JSON.stringify({
      phone: canonical,
      text,
      direction,
      messageId,
      type,
      timestamp: Date.now()
    });

    const key = msgPrefix + canonical;
    await client.lPush(key, entry);
    await client.lTrim(key, 0, MAX_MESSAGES - 1);
    await client.zAdd(indexKey, { score: Date.now(), value: canonical });

    return JSON.parse(entry);
  }

  static async getMessages(phone, tenantId, limit = 50) {
    const client = getClient();
    const { msgPrefix } = tenantKeys(tenantId);
    const canonical = canonicalPhone(phone);
    const alt = alternatePhone(canonical);

    const keys = [msgPrefix + canonical];
    if (alt) keys.push(msgPrefix + alt);

    const batches = await Promise.all(
      keys.map((key) => fetchMessagesForKey(client, key, limit))
    );

    const seen = new Set();
    const merged = [];
    for (const batch of batches) {
      for (const msg of batch) {
        const id = msg.messageId || `${msg.timestamp}:${msg.text}:${msg.direction}`;
        if (seen.has(id)) continue;
        seen.add(id);
        merged.push(msg);
      }
    }

    merged.sort((a, b) => a.timestamp - b.timestamp);
    return merged.slice(-limit);
  }

  static async getConversations(tenantId, limit = 50) {
    const client = getClient();
    const { indexKey, msgPrefix } = tenantKeys(tenantId);
    const phones = await client.zRange(indexKey, 0, limit - 1, { REV: true });

    const byCanonical = new Map();

    for (const phone of phones) {
      const canonical = canonicalPhone(phone);
      const latest = await client.lIndex(msgPrefix + phone, 0);
      const parsed = latest ? JSON.parse(latest) : null;

      const existing = byCanonical.get(canonical);
      if (!existing || (parsed?.timestamp || 0) > existing.lastTimestamp) {
        byCanonical.set(canonical, {
          phone: canonical,
          lastMessage: parsed?.text || "",
          lastTimestamp: parsed?.timestamp || 0,
          direction: parsed?.direction || "in"
        });
      }
    }

    return Array.from(byCanonical.values())
      .sort((a, b) => b.lastTimestamp - a.lastTimestamp);
  }
};

module.exports.canonicalPhone = canonicalPhone;
module.exports.toApiPhone = toApiPhone;
