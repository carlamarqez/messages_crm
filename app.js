/**
 * Copyright 2021-present, Facebook, Inc. All rights reserved.
 */

"use strict";

const crypto = require("crypto");
const path = require("path");

const { urlencoded, json } = require("body-parser");
require("dotenv").config();
const express = require("express");

const config = require("./services/config");
const Conversation = require("./services/conversation");
const ChatStore = require("./services/chat-store");
const GraphApi = require("./services/graph-api");
const TenantStore = require("./services/tenant-store");
const WebhookLog = require("./services/webhook-log");
const Auth = require("./services/auth");
const {
  buildCreateTemplateBody,
  formatTemplateForList,
  filterTemplatesForList
} = require("./services/templates");
const {
  attachTenant,
  requireTenant,
  loginTenant,
  clearSessionCookie
} = require("./services/session");
const { getClient } = require("./services/redis");

const app = express();

app.use(urlencoded({ extended: true }));
app.use(json({ verify: verifyRequestSignature }));
app.use(express.static(path.join(__dirname, "public")));
app.use(attachTenant);

// --- Webhook ---
app.get("/webhook", (req, res) => {
  if (
    req.query["hub.mode"] != "subscribe" ||
    req.query["hub.verify_token"] != config.verifyToken
  ) {
    res.sendStatus(403);
    return;
  }
  res.send(req.query["hub.challenge"]);
});

app.post("/webhook", async (req, res) => {
  try {
    if (req.body.object !== "whatsapp_business_account") {
      res.status(200).send("EVENT_RECEIVED");
      return;
    }

    for (const entry of req.body.entry || []) {
      for (const change of entry.changes || []) {
        const value = change.value;
        if (!value) continue;

        const phoneNumberId = value.metadata?.phone_number_id;
        const tenant = await TenantStore.getTenantByPhoneNumberId(phoneNumberId);
        const tenantId = tenant?.tenantId || "unknown";
        const accessToken = tenant?.accessToken;

        await WebhookLog.append(tenantId, req.body);

        if (value.statuses) {
          for (const status of value.statuses) {
            if (config.chatAutoReply && accessToken) {
              Conversation.handleStatus(phoneNumberId, status, accessToken).catch((err) => {
                console.error("handleStatus error:", err.message);
              });
            }
          }
        }

        if (value.messages) {
          for (const rawMessage of value.messages) {
            try {
              const stored = await ChatStore.addIncoming(rawMessage, tenantId);
              console.log("Incoming message:", tenantId, stored.phone, stored.text);
            } catch (err) {
              console.error("ChatStore.addIncoming error:", err);
            }

            if (config.chatAutoReply && accessToken) {
              Conversation.handleMessage(phoneNumberId, rawMessage, accessToken).catch((err) => {
                console.error("handleMessage error:", err.message);
              });
            }
          }
        }
      }
    }

    res.status(200).send("EVENT_RECEIVED");
  } catch (err) {
    console.error("POST /webhook error:", err);
    res.status(200).send("EVENT_RECEIVED");
  }
});

// --- Connect / Auth ---
app.get("/connect", (req, res) => {
  res.sendFile(path.join(__dirname, "public", "connect.html"));
});

const OAUTH_STATE_COOKIE = "oauth_state";

function parseCookies(req) {
  const header = req.headers.cookie || "";
  return Object.fromEntries(
    header
      .split(";")
      .map((part) => part.trim())
      .filter(Boolean)
      .map((part) => {
        const idx = part.indexOf("=");
        if (idx === -1) return [part, ""];
        return [part.slice(0, idx), decodeURIComponent(part.slice(idx + 1))];
      })
  );
}

function clearOAuthStateCookie(res) {
  res.setHeader(
    "Set-Cookie",
    `${OAUTH_STATE_COOKIE}=; Path=/; HttpOnly; SameSite=Lax; Max-Age=0`
  );
}

app.get("/auth/whatsapp", (req, res) => {
  const state = crypto.randomBytes(16).toString("hex");
  res.setHeader(
    "Set-Cookie",
    `${OAUTH_STATE_COOKIE}=${state}; Path=/; HttpOnly; SameSite=Lax; Max-Age=600`
  );
  res.redirect(Auth.getOAuthUrl(state));
});

app.get("/auth/callback", async (req, res) => {
  const { code, error, error_description: errorDescription, state } = req.query;
  const cookies = parseCookies(req);
  const expectedState = cookies[OAUTH_STATE_COOKIE];
  clearOAuthStateCookie(res);

  if (error) {
    res.redirect(`/connect?error=${encodeURIComponent(errorDescription || error)}`);
    return;
  }

  if (!code) {
    res.redirect("/connect?error=No+authorization+code");
    return;
  }

  if (expectedState && state && expectedState !== state) {
    res.redirect("/connect?error=Estado+OAuth+inv%C3%A1lido.+Intent%C3%A1+de+nuevo.");
    return;
  }

  try {
    const connection = await Auth.connectFromCode(code, { fromJsSdk: false });
    const tenant = await TenantStore.saveTenant(connection);
    await loginTenant(res, tenant);
    res.redirect("/chat?connected=1");
  } catch (err) {
    console.error("OAuth callback error:", err);
    res.redirect(`/connect?error=${encodeURIComponent(err.message)}`);
  }
});

app.post("/api/connect/manual", async (req, res) => {
  try {
    const connection = await Auth.connectManual(req.body);
    const tenant = await TenantStore.saveTenant(connection);
    await loginTenant(res, tenant);
    res.json({ success: true, tenant: TenantStore.toPublicTenant(tenant) });
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

app.post("/api/connect/code", async (req, res) => {
  try {
    const {
      code,
      wabaId,
      phoneNumberId,
      fromJsSdk = true,
      redirectUri = null
    } = req.body;

    if (!code) {
      res.status(400).json({ error: "Missing code" });
      return;
    }

    const connection = await Auth.connectFromCode(code, {
      wabaId: wabaId || null,
      phoneNumberId: phoneNumberId || null,
      fromJsSdk: !!fromJsSdk,
      redirectUri: redirectUri || null
    });
    const tenant = await TenantStore.saveTenant(connection);
    await loginTenant(res, tenant);
    res.json({ success: true, tenant: TenantStore.toPublicTenant(tenant) });
  } catch (err) {
    console.error("POST /api/connect/code error:", err);
    res.status(400).json({ error: err.message });
  }
});

app.post("/api/disconnect", async (req, res) => {
  clearSessionCookie(res);
  res.json({ success: true });
});

app.get("/api/config/public", (req, res) => {
  const connectUrl = `${config.baseUrl.replace(/\/$/, "")}/connect`;
  res.json({
    appId: config.appId,
    configurationId: config.whatsappConfigurationId
      ? String(config.whatsappConfigurationId).trim()
      : null,
    baseUrl: config.baseUrl,
    oauthRedirectUri: config.oauthRedirectUri,
    connectUrl,
    hasEmbeddedSignup: !!config.whatsappConfigurationId,
    graphVersion: "v21.0"
  });
});

app.get("/api/session", (req, res) => {
  res.json({
    connected: !!req.tenant,
    tenant: TenantStore.toPublicTenant(req.tenant)
  });
});

// --- Chat API (requires connection) ---
app.get("/chat", (req, res) => {
  if (!req.tenant) {
    res.redirect("/connect");
    return;
  }
  res.sendFile(path.join(__dirname, "public", "chat.html"));
});

app.get("/templates", (req, res) => {
  if (!req.tenant) {
    res.redirect("/connect");
    return;
  }
  res.sendFile(path.join(__dirname, "public", "templates.html"));
});

app.get("/api/status", requireTenant, async (req, res) => {
  try {
    let redisOk = false;
    try {
      await getClient().ping();
      redisOk = true;
    } catch (_) {
      redisOk = false;
    }

    const lastWebhookAt = await ChatStore.getLastWebhookAt(req.tenantId);

    res.json({
      redisOk,
      tenant: TenantStore.toPublicTenant(req.tenant),
      chatAutoReply: config.chatAutoReply,
      lastWebhookAt,
      webhookPath: "/webhook",
      port: config.port
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.get("/api/conversations", requireTenant, async (req, res) => {
  try {
    const conversations = await ChatStore.getConversations(req.tenantId);
    res.json(conversations);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.get("/api/messages/:phone", requireTenant, async (req, res) => {
  try {
    const messages = await ChatStore.getMessages(req.params.phone, req.tenantId);
    res.json(messages);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.get("/api/webhook-logs", requireTenant, async (req, res) => {
  try {
    const logs = await WebhookLog.getLogs(req.tenantId, 30);
    res.json(logs);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.get("/api/templates", requireTenant, async (req, res) => {
  const { accessToken, wabaId } = req.tenant;
  if (!wabaId) {
    res.status(400).json({ error: "WABA no configurado. Reconectá la cuenta de WhatsApp." });
    return;
  }

  try {
    const result = await GraphApi.listMessageTemplates(accessToken, wabaId);
    const templates = filterTemplatesForList(
      (result.data || []).map(formatTemplateForList)
    );
    res.json({ templates });
  } catch (err) {
    console.error("GET /api/templates error:", err);
    res.status(500).json({ error: err.message || String(err) });
  }
});

app.post("/api/templates", requireTenant, async (req, res) => {
  const { accessToken, wabaId } = req.tenant;
  if (!wabaId) {
    res.status(400).json({ error: "WABA no configurado. Reconectá la cuenta de WhatsApp." });
    return;
  }

  try {
    const payload = buildCreateTemplateBody(req.body);
    const result = await GraphApi.createMessageTemplate(accessToken, wabaId, payload);
    res.json({
      success: true,
      template: {
        id: result.id,
        name: payload.name,
        status: result.status || "PENDING",
        language: payload.language,
        category: payload.category
      },
      apiResponse: result
    });
  } catch (err) {
    console.error("POST /api/templates error:", err);
    res.status(500).json({ error: err.message || String(err) });
  }
});

app.post("/api/send", requireTenant, async (req, res) => {
  const { to, text, template } = req.body;

  if (!to) {
    res.status(400).json({ error: 'Missing "to" phone number' });
    return;
  }

  const { accessToken, phoneNumberId } = req.tenant;
  const apiTo = ChatStore.toApiPhone(to);

  try {
    let response;
    let storedText;

    if (template === "hello_world") {
      response = await GraphApi.sendHelloWorldTemplate(accessToken, phoneNumberId, apiTo);
      storedText = "Hello World (template)";
    } else if (text && text.trim()) {
      response = await GraphApi.sendTextMessage(accessToken, phoneNumberId, apiTo, text.trim());
      storedText = text.trim();
    } else {
      res.status(400).json({ error: 'Provide "text" or template "hello_world"' });
      return;
    }

    const messageId = response?.messages?.[0]?.id;
    let stored = null;
    try {
      stored = await ChatStore.addOutgoing(apiTo, storedText, messageId, req.tenantId);
    } catch (storeErr) {
      console.error("ChatStore.addOutgoing error:", storeErr);
    }

    res.json({ success: true, message: stored, apiResponse: response });
  } catch (err) {
    console.error("POST /api/send error:", err);
    let apiError = err?.message || String(err);
    if (err?.response?.body) {
      apiError = typeof err.response.body === "string"
        ? err.response.body
        : JSON.stringify(err.response.body);
    }
    res.status(500).json({ error: apiError });
  }
});

app.get("/", (req, res) => {
  if (req.tenant) {
    res.redirect("/chat");
    return;
  }
  res.redirect("/connect");
});

config.checkEnvVariables();

function verifyRequestSignature(req, res, buf) {
  if (req.path !== "/webhook") return;

  const signature = req.headers["x-hub-signature-256"];
  if (!signature) {
    console.warn("Webhook POST without x-hub-signature-256");
    return;
  }
  if (!config.appSecret) {
    console.warn("APP_SECRET missing — cannot verify webhook signature");
    return;
  }

  const signatureHash = signature.split("=")[1];
  const expectedHash = crypto
    .createHmac("sha256", config.appSecret)
    .update(buf)
    .digest("hex");

  if (signatureHash != expectedHash) {
    console.warn("Webhook signature mismatch — check APP_SECRET in .env");
  }
}

app.listen(config.port, () => {
  console.log(`Server running on port ${config.port}`);
  console.log(`Connect WhatsApp: ${config.baseUrl}/connect`);
  console.log(`Chat panel:         ${config.baseUrl}/chat`);
  console.log(`Templates:          ${config.baseUrl}/templates`);
});
