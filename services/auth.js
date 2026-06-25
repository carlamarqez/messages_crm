/**
 * Copyright 2021-present, Facebook, Inc. All rights reserved.
 *
 * OAuth and WhatsApp asset discovery for Embedded Signup.
 */

"use strict";

const config = require("./config");

const GRAPH_VERSION = "v21.0";
const OAUTH_SCOPES = [
  "whatsapp_business_management",
  "whatsapp_business_messaging"
].join(",");

async function graphGet(path, accessToken) {
  const url = `https://graph.facebook.com/${GRAPH_VERSION}${path}`;
  const separator = path.includes("?") ? "&" : "?";
  const res = await fetch(`${url}${separator}access_token=${encodeURIComponent(accessToken)}`);
  const data = await res.json();
  if (data.error) {
    throw new Error(data.error.message || JSON.stringify(data.error));
  }
  return data;
}

async function graphPost(path, body, accessToken) {
  const url = `https://graph.facebook.com/${GRAPH_VERSION}${path}`;
  const res = await fetch(url, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${accessToken}`
    },
    body: JSON.stringify(body)
  });
  const data = await res.json();
  if (data.error) {
    throw new Error(data.error.message || JSON.stringify(data.error));
  }
  return data;
}

async function requestAccessToken(body) {
  const res = await fetch(`https://graph.facebook.com/${GRAPH_VERSION}/oauth/access_token`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body)
  });
  const data = await res.json();
  if (data.error) {
    throw new Error(data.error.message || JSON.stringify(data.error));
  }
  return data.access_token;
}

function normalizeDisplayPhone(displayPhone) {
  return String(displayPhone || "").replace(/\D/g, "");
}

module.exports = class Auth {
  static getOAuthUrl(state) {
    const params = new URLSearchParams({
      client_id: config.appId,
      redirect_uri: config.oauthRedirectUri,
      response_type: "code",
      scope: OAUTH_SCOPES,
      state: state || "default"
    });

    if (config.whatsappConfigurationId) {
      params.set("config_id", config.whatsappConfigurationId);
    }

    return `https://www.facebook.com/${GRAPH_VERSION}/dialog/oauth?${params.toString()}`;
  }

  static async exchangeCodeForToken(code, options = {}) {
    const { fromJsSdk = false, redirectUri = null } = options;
    const attempts = [];

    if (fromJsSdk) {
      attempts.push({
        client_id: config.appId,
        client_secret: config.appSecret,
        code,
        grant_type: "authorization_code"
      });
    }

    if (redirectUri) {
      attempts.push({
        client_id: config.appId,
        client_secret: config.appSecret,
        code,
        grant_type: "authorization_code",
        redirect_uri: redirectUri
      });
    }

    if (!fromJsSdk) {
      attempts.push({
        client_id: config.appId,
        client_secret: config.appSecret,
        code,
        grant_type: "authorization_code",
        redirect_uri: config.oauthRedirectUri
      });
    }

    let lastError = null;
    for (const body of attempts) {
      try {
        return await requestAccessToken(body);
      } catch (err) {
        lastError = err;
      }
    }

    throw lastError || new Error("No se pudo intercambiar el código OAuth");
  }

  static async exchangeForLongLivedToken(shortLivedToken) {
    try {
      const params = new URLSearchParams({
        grant_type: "fb_exchange_token",
        client_id: config.appId,
        client_secret: config.appSecret,
        fb_exchange_token: shortLivedToken
      });
      const res = await fetch(
        `https://graph.facebook.com/${GRAPH_VERSION}/oauth/access_token?${params.toString()}`
      );
      const data = await res.json();
      if (data.error) {
        console.warn("Long-lived token exchange failed:", data.error.message);
        return shortLivedToken;
      }
      return data.access_token || shortLivedToken;
    } catch (err) {
      console.warn("Long-lived token exchange error:", err.message);
      return shortLivedToken;
    }
  }

  static isMetaTestNumber(displayPhone) {
    const digits = normalizeDisplayPhone(displayPhone);
    return digits.startsWith("1555") || /^1\d{3}555/.test(digits);
  }

  static scorePhone(phone) {
    let score = 0;
    const display = phone.displayPhone || phone.display_phone_number || "";
    if (!this.isMetaTestNumber(display)) {
      score += 100;
    }
    const status = String(phone.status || "").toUpperCase();
    if (status === "CONNECTED" || status === "REGISTERED") {
      score += 50;
    }
    if (status === "PENDING") {
      score -= 10;
    }
    return score;
  }

  static pickBestPhone(phones, wabaId) {
    if (!phones?.length) return null;

    const ranked = phones
      .map((phone) => ({
        wabaId,
        phoneNumberId: String(phone.id),
        displayPhone: phone.display_phone_number || null,
        businessName: phone.verified_name || null,
        status: phone.status || null,
        score: this.scorePhone(phone)
      }))
      .sort((a, b) => b.score - a.score);

    const best = ranked[0];
    return {
      wabaId: best.wabaId,
      phoneNumberId: best.phoneNumberId,
      displayPhone: best.displayPhone,
      businessName: best.businessName
    };
  }

  static async listPhonesForWaba(accessToken, wabaId) {
    try {
      const phones = await graphGet(
        `/${wabaId}/phone_numbers?fields=display_phone_number,id,verified_name,status`,
        accessToken
      );
      return phones.data || [];
    } catch (err) {
      console.warn(`listPhonesForWaba(${wabaId}) failed:`, err.message);
      return [];
    }
  }

  static async discoverPhoneFromWaba(accessToken, wabaId) {
    const phones = await this.listPhonesForWaba(accessToken, wabaId);
    const best = this.pickBestPhone(phones, wabaId);
    if (!best) {
      throw new Error(`No hay números en el WABA ${wabaId}`);
    }
    return best;
  }

  static async fetchPhoneDetails(accessToken, phoneNumberId, wabaId) {
    try {
      const phone = await graphGet(
        `/${phoneNumberId}?fields=display_phone_number,verified_name`,
        accessToken
      );
      return {
        wabaId: wabaId ? String(wabaId) : null,
        phoneNumberId: String(phoneNumberId),
        displayPhone: phone.display_phone_number || null,
        businessName: phone.verified_name || null
      };
    } catch (err) {
      console.warn("fetchPhoneDetails failed:", err.message);
      return {
        wabaId: wabaId ? String(wabaId) : null,
        phoneNumberId: String(phoneNumberId),
        displayPhone: null,
        businessName: null
      };
    }
  }

  static async discoverWhatsAppAssets(accessToken) {
    const appToken = `${config.appId}|${config.appSecret}`;
    const debugRes = await fetch(
      `https://graph.facebook.com/${GRAPH_VERSION}/debug_token?input_token=${encodeURIComponent(accessToken)}&access_token=${encodeURIComponent(appToken)}`
    );
    const debug = await debugRes.json();

    if (debug.error) {
      throw new Error(debug.error.message || JSON.stringify(debug.error));
    }

    const wabaIds = new Set();
    for (const scope of debug.data?.granular_scopes || []) {
      if (
        scope.scope === "whatsapp_business_management" ||
        scope.scope === "whatsapp_business_messaging"
      ) {
        for (const id of scope.target_ids || []) {
          wabaIds.add(id);
        }
      }
    }

    const candidates = [];

    for (const wabaId of wabaIds) {
      const phones = await this.listPhonesForWaba(accessToken, wabaId);
      const best = this.pickBestPhone(phones, wabaId);
      if (best) {
        candidates.push(best);
      }
    }

    try {
      const businesses = await graphGet(
        "/me/businesses?fields=owned_whatsapp_business_accounts{id,name,phone_numbers{display_phone_number,id,verified_name,status}}",
        accessToken
      );
      for (const biz of businesses.data || []) {
        for (const waba of biz.owned_whatsapp_business_accounts?.data || []) {
          const best = this.pickBestPhone(waba.phone_numbers?.data || [], waba.id);
          if (best) {
            best.businessName = best.businessName || waba.name || null;
            candidates.push(best);
          }
        }
      }
    } catch (err) {
      console.warn("Business fallback failed:", err.message);
    }

    if (candidates.length) {
      candidates.sort((a, b) => this.scorePhone(b) - this.scorePhone(a));
      const chosen = candidates[0];
      console.log(
        "Selected WhatsApp line:",
        chosen.displayPhone || chosen.phoneNumberId,
        "(skipped Meta test numbers when possible)"
      );
      return chosen;
    }

    if (config.phoneNumberId && config.accessToken) {
      return {
        wabaId: null,
        phoneNumberId: String(config.phoneNumberId),
        displayPhone: null,
        businessName: null
      };
    }

    throw new Error(
      "No se encontró un número de WhatsApp. Completá Embedded Signup o usá conexión manual."
    );
  }

  static async subscribeAppToWaba(wabaId, accessToken) {
    if (!wabaId) return;
    try {
      await graphPost(`/${wabaId}/subscribed_apps`, {}, accessToken);
      console.log("Subscribed app to WABA webhooks:", wabaId);
    } catch (err) {
      console.warn("WABA webhook subscription failed:", err.message);
    }
  }

  static async getPhoneStatus(accessToken, phoneNumberId) {
    try {
      return await graphGet(
        `/${phoneNumberId}?fields=status,code_verification_status,display_phone_number,verified_name`,
        accessToken
      );
    } catch (err) {
      console.warn("getPhoneStatus failed:", err.message);
      return null;
    }
  }

  static isPhoneRegistered(status) {
    if (!status?.status) return false;
    const registered = new Set(["CONNECTED", "REGISTERED"]);
    return registered.has(String(status.status).toUpperCase());
  }

  static isAlreadyRegisteredError(message) {
    const text = String(message || "").toLowerCase();
    return (
      text.includes("already registered") ||
      text.includes("already been registered") ||
      text.includes("ya está registrado") ||
      text.includes("133015")
    );
  }

  static async registerPhoneNumber(accessToken, phoneNumberId) {
    if (!phoneNumberId || !accessToken) {
      throw new Error("phoneNumberId y accessToken son obligatorios para registrar");
    }

    const statusBefore = await this.getPhoneStatus(accessToken, phoneNumberId);
    if (this.isPhoneRegistered(statusBefore)) {
      console.log("Phone already registered for Cloud API:", phoneNumberId, statusBefore.status);
      return statusBefore;
    }

    try {
      await graphPost(
        `/${phoneNumberId}/register`,
        {
          messaging_product: "whatsapp",
          pin: config.whatsappRegisterPin
        },
        accessToken
      );
      console.log("Registered phone for Cloud API:", phoneNumberId);
    } catch (err) {
      if (this.isAlreadyRegisteredError(err.message)) {
        console.warn("Phone register skipped (already registered):", err.message);
        return statusBefore;
      }
      throw new Error(`No se pudo registrar el número en Cloud API: ${err.message}`);
    }

    return this.getPhoneStatus(accessToken, phoneNumberId);
  }

  static async connectFromCode(code, options = {}) {
    const { wabaId, phoneNumberId, fromJsSdk = false, redirectUri = null } = options;

    let accessToken = await this.exchangeCodeForToken(code, { fromJsSdk, redirectUri });
    accessToken = await this.exchangeForLongLivedToken(accessToken);

    let assets;
    if (wabaId && phoneNumberId) {
      assets = await this.fetchPhoneDetails(accessToken, phoneNumberId, wabaId);
    } else if (wabaId) {
      assets = await this.discoverPhoneFromWaba(accessToken, wabaId);
    } else {
      assets = await this.discoverWhatsAppAssets(accessToken);
    }

    await this.subscribeAppToWaba(assets.wabaId, accessToken);
    await this.registerPhoneNumber(accessToken, assets.phoneNumberId);

    return { accessToken, ...assets };
  }

  static async connectManual({ accessToken, phoneNumberId, wabaId, displayPhone, businessName }) {
    if (!accessToken || !phoneNumberId) {
      throw new Error("accessToken y phoneNumberId son obligatorios");
    }
    const connection = {
      accessToken,
      phoneNumberId: String(phoneNumberId),
      wabaId: wabaId ? String(wabaId) : null,
      displayPhone: displayPhone || null,
      businessName: businessName || null
    };
    await this.subscribeAppToWaba(connection.wabaId, accessToken);
    return connection;
  }
};
