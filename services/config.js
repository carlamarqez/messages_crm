/**
 * Copyright 2021-present, Facebook, Inc. All rights reserved.
 */

"use strict";

require("dotenv").config();

const ENV_VARS = [
  "APP_SECRET",
  "VERIFY_TOKEN",
  "APP_ID",
  "REDIS_HOST",
  "REDIS_PORT"
];

const port = process.env.PORT || 8080;
const baseUrl = process.env.BASE_URL || `http://localhost:${port}`;

module.exports = Object.freeze({
  appId: process.env.APP_ID,
  appSecret: process.env.APP_SECRET,
  verifyToken: process.env.VERIFY_TOKEN,
  whatsappConfigurationId: process.env.WHATSAPP_CONFIGURATION_ID?.trim() || null,
  oauthRedirectUri: process.env.OAUTH_REDIRECT_URI || `${baseUrl}/auth/callback`,

  // Legacy fallbacks (optional if using /connect)
  accessToken: process.env.ACCESS_TOKEN,
  phoneNumberId: process.env.PHONE_NUMBER_ID,

  chatAutoReply: process.env.CHAT_AUTO_REPLY === "true",
  whatsappRegisterPin: process.env.WHATSAPP_REGISTER_PIN || "123456",

  port,
  baseUrl,
  redisHost: process.env.REDIS_HOST || "localhost",
  redisPort: process.env.REDIS_PORT || 6379,

  checkEnvVariables: function () {
    ENV_VARS.forEach(function (key) {
      if (!process.env[key]) {
        console.warn("WARNING: Missing the environment variable " + key);
      }
    });
    if (!process.env.WHATSAPP_CONFIGURATION_ID) {
      console.warn("WARNING: WHATSAPP_CONFIGURATION_ID not set — OAuth en pestaña (sin Embedded Signup). Ver docs/EMBEDDED_SIGNUP.md");
    } else {
      console.log("Embedded Signup: activo (Configuration ID configurado)");
    }
    if (baseUrl.startsWith("http://localhost")) {
      console.warn("WARNING: BASE_URL es localhost — para OAuth redirect usá ngrok y actualizá BASE_URL/OAUTH_REDIRECT_URI");
    }
    console.log("OAuth redirect URI:", process.env.OAUTH_REDIRECT_URI || `${baseUrl}/auth/callback`);
    console.log("Connect page (agregá en Meta → Valid OAuth Redirect URIs):", `${baseUrl.replace(/\/$/, "")}/connect`);
  }
});
