/**
 * Copyright 2021-present, Facebook, Inc. All rights reserved.
 */

"use strict";

const TenantStore = require("./tenant-store");

const SESSION_COOKIE = "sid";
const SESSION_MAX_AGE = 60 * 60 * 24 * 30;

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
        return [
          part.slice(0, idx),
          decodeURIComponent(part.slice(idx + 1))
        ];
      })
  );
}

function setSessionCookie(res, sessionId) {
  res.setHeader(
    "Set-Cookie",
    `${SESSION_COOKIE}=${encodeURIComponent(sessionId)}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${SESSION_MAX_AGE}`
  );
}

function clearSessionCookie(res) {
  res.setHeader(
    "Set-Cookie",
    `${SESSION_COOKIE}=; Path=/; HttpOnly; SameSite=Lax; Max-Age=0`
  );
}

async function attachTenant(req, res, next) {
  try {
    const cookies = parseCookies(req);
    const sessionId = cookies[SESSION_COOKIE];
    const tenantId = await TenantStore.getTenantIdFromSession(sessionId);
    const tenant = await TenantStore.getTenant(tenantId);
    req.sessionId = sessionId || null;
    req.tenant = tenant;
    req.tenantId = tenant?.tenantId || null;
    next();
  } catch (err) {
    next(err);
  }
}

function requireTenant(req, res, next) {
  if (!req.tenant) {
    res.status(401).json({ error: "No hay WhatsApp conectado. Andá a /connect primero." });
    return;
  }
  next();
}

async function loginTenant(res, tenant) {
  const sessionId = await TenantStore.createSession(tenant.tenantId);
  setSessionCookie(res, sessionId);
  return sessionId;
}

module.exports = {
  SESSION_COOKIE,
  parseCookies,
  setSessionCookie,
  clearSessionCookie,
  attachTenant,
  requireTenant,
  loginTenant
};
