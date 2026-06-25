/**
 * Copyright 2021-present, Facebook, Inc. All rights reserved.
 */

"use strict";

const { FacebookAdsApi } = require("facebook-nodejs-business-sdk");

const GRAPH_VERSION = "v21.0";

module.exports = class GraphApi {
  static async #graphRequest(accessToken, method, path, body) {
    const url = `https://graph.facebook.com/${GRAPH_VERSION}${path}`;
    const options = {
      method,
      headers: { Authorization: `Bearer ${accessToken}` }
    };
    if (body !== undefined) {
      options.headers["Content-Type"] = "application/json";
      options.body = JSON.stringify(body);
    }
    const res = await fetch(url, options);
    const data = await res.json();
    if (data.error) {
      throw new Error(data.error.message || JSON.stringify(data.error));
    }
    return data;
  }

  static async listMessageTemplates(accessToken, wabaId) {
    const fields = encodeURIComponent("id,name,status,language,category,components");
    return this.#graphRequest(
      accessToken,
      "GET",
      `/${wabaId}/message_templates?fields=${fields}&limit=100`
    );
  }

  static async createMessageTemplate(accessToken, wabaId, payload) {
    return this.#graphRequest(accessToken, "POST", `/${wabaId}/message_templates`, payload);
  }
  static #getApi(accessToken) {
    if (!accessToken) {
      throw new Error("accessToken is required");
    }
    return new FacebookAdsApi(accessToken);
  }

  static async #makeApiCall(accessToken, messageId, senderPhoneNumberId, requestBody) {
    const api = this.#getApi(accessToken);
    try {
      if (messageId) {
        const typingBody = {
          messaging_product: "whatsapp",
          status: "read",
          message_id: messageId,
          typing_indicator: { type: "text" }
        };
        await api.call("POST", [`${senderPhoneNumberId}`, "messages"], typingBody);
      }

      const response = await api.call(
        "POST",
        [`${senderPhoneNumberId}`, "messages"],
        requestBody
      );
      console.log("API call successful:", response);
      return response;
    } catch (error) {
      console.error("Error making API call:", error);
      throw error;
    }
  }

  static async sendTextMessage(accessToken, senderPhoneNumberId, recipientPhoneNumber, messageText) {
    const requestBody = {
      messaging_product: "whatsapp",
      to: recipientPhoneNumber,
      type: "text",
      text: { body: messageText }
    };
    return this.#makeApiCall(accessToken, undefined, senderPhoneNumberId, requestBody);
  }

  static async sendHelloWorldTemplate(accessToken, senderPhoneNumberId, recipientPhoneNumber) {
    const requestBody = {
      messaging_product: "whatsapp",
      to: recipientPhoneNumber,
      type: "template",
      template: {
        name: "hello_world",
        language: { code: "en_US" }
      }
    };
    return this.#makeApiCall(accessToken, undefined, senderPhoneNumberId, requestBody);
  }

  // Jasper demo methods (require accessToken as first arg)
  static async messageWithInteractiveReply(accessToken, messageId, senderPhoneNumberId, recipientPhoneNumber, messageText, replyCTAs) {
    const requestBody = {
      messaging_product: "whatsapp",
      to: recipientPhoneNumber,
      type: "interactive",
      interactive: {
        type: "button",
        body: { text: messageText },
        action: {
          buttons: replyCTAs.map((cta) => ({
            type: "reply",
            reply: { id: cta.id, title: cta.title }
          }))
        }
      }
    };
    return this.#makeApiCall(accessToken, messageId, senderPhoneNumberId, requestBody);
  }

  static async messageWithUtilityTemplate(accessToken, messageId, senderPhoneNumberId, recipientPhoneNumber, options) {
    const { templateName, locale, imageLink } = options;
    const requestBody = {
      messaging_product: "whatsapp",
      recipient_type: "individual",
      to: recipientPhoneNumber,
      type: "template",
      template: {
        name: templateName,
        language: { code: locale },
        components: [
          {
            type: "header",
            parameters: [{ type: "image", image: { link: imageLink } }]
          }
        ]
      }
    };
    return this.#makeApiCall(accessToken, messageId, senderPhoneNumberId, requestBody);
  }

  static async messageWithLimitedTimeOfferTemplate(accessToken, messageId, senderPhoneNumberId, recipientPhoneNumber, options) {
    const { templateName, locale, imageLink, offerCode } = options;
    const futureTime = new Date(Date.now() + 48 * 60 * 60 * 1000);
    const requestBody = {
      messaging_product: "whatsapp",
      recipient_type: "individual",
      to: recipientPhoneNumber,
      type: "template",
      template: {
        name: templateName,
        language: { code: locale },
        components: [
          {
            type: "header",
            parameters: [{ type: "image", image: { link: imageLink } }]
          },
          {
            type: "limited_time_offer",
            parameters: [{
              type: "limited_time_offer",
              limited_time_offer: { expiration_time_ms: futureTime.getTime() }
            }]
          },
          {
            type: "button",
            sub_type: "copy_code",
            index: 0,
            parameters: [{ type: "coupon_code", coupon_code: offerCode }]
          }
        ]
      }
    };
    return this.#makeApiCall(accessToken, messageId, senderPhoneNumberId, requestBody);
  }

  static async messageWithMediaCardCarousel(accessToken, messageId, senderPhoneNumberId, recipientPhoneNumber, options) {
    const { templateName, locale, imageLinks } = options;
    const requestBody = {
      messaging_product: "whatsapp",
      recipient_type: "individual",
      to: recipientPhoneNumber,
      type: "template",
      template: {
        name: templateName,
        language: { code: locale },
        components: [
          {
            type: "carousel",
            cards: imageLinks.map((imageLink, idx) => ({
              card_index: idx,
              components: [
                {
                  type: "header",
                  parameters: [{ type: "image", image: { link: imageLink } }]
                }
              ]
            }))
          }
        ]
      }
    };
    return this.#makeApiCall(accessToken, messageId, senderPhoneNumberId, requestBody);
  }
};
