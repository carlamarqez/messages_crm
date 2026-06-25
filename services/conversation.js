/**
 * Copyright 2021-present, Facebook, Inc. All rights reserved.
 */

"use strict";

const constants = require("./constants");
const GraphApi = require("./graph-api");
const Message = require("./message");
const Status = require("./status");
const Cache = require("./redis");

function sendTryOutDemoMessage(accessToken, messageId, senderPhoneNumberId, recipientPhoneNumber, messageBody) {
  return GraphApi.messageWithInteractiveReply(
    accessToken,
    messageId,
    senderPhoneNumberId,
    recipientPhoneNumber,
    messageBody,
    [
      { id: constants.REPLY_INTERACTIVE_MEDIA_ID, title: constants.REPLY_INTERACTIVE_WITH_MEDIA_CTA },
      { id: constants.REPLY_MEDIA_CAROUSEL_ID, title: constants.REPLY_MEDIA_CARD_CAROUSEL_CTA },
      { id: constants.REPLY_OFFER_ID, title: constants.REPLY_OFFER_CTA }
    ]
  );
}

function sendInteractiveMediaMessage(accessToken, messageId, senderPhoneNumberId, recipientPhoneNumber) {
  return GraphApi.messageWithUtilityTemplate(accessToken, messageId, senderPhoneNumberId, recipientPhoneNumber, {
    templateName: "grocery_delivery_utility",
    locale: "en_US",
    imageLink: "https://scontent.xx.fbcdn.net/mci_ab/uap/asset_manager/id/?ab_b=e&ab_page=AssetManagerID&ab_entry=1530053877871776"
  });
}

function sendLimitedTimeOfferMessage(accessToken, messageId, senderPhoneNumberId, recipientPhoneNumber) {
  return GraphApi.messageWithLimitedTimeOfferTemplate(accessToken, messageId, senderPhoneNumberId, recipientPhoneNumber, {
    templateName: "strawberries_limited_offer",
    locale: "en_US",
    imageLink: "https://scontent.xx.fbcdn.net/mci_ab/uap/asset_manager/id/?ab_b=e&ab_page=AssetManagerID&ab_entry=1393969325614091",
    offerCode: "BERRIES20"
  });
}

function sendMediaCarouselMessage(accessToken, messageId, senderPhoneNumberId, recipientPhoneNumber) {
  return GraphApi.messageWithMediaCardCarousel(accessToken, messageId, senderPhoneNumberId, recipientPhoneNumber, {
    templateName: "recipe_media_carousel",
    locale: "en_US",
    imageLinks: [
      "https://scontent.xx.fbcdn.net/mci_ab/uap/asset_manager/id/?ab_b=e&ab_page=AssetManagerID&ab_entry=1389202275965231",
      "https://scontent.xx.fbcdn.net/mci_ab/uap/asset_manager/id/?ab_b=e&ab_page=AssetManagerID&ab_entry=3255815791260974"
    ]
  });
}

async function markMessageForFollowUp(messageId) {
  await Cache.insert(messageId);
}

module.exports = class Conversation {
  static async handleMessage(senderPhoneNumberId, rawMessage, accessToken) {
    if (!accessToken) return;

    const message = new Message(rawMessage);

    switch (message.type) {
      case constants.REPLY_INTERACTIVE_MEDIA_ID: {
        const interactiveMediaResponse = await sendInteractiveMediaMessage(
          accessToken, message.id, senderPhoneNumberId, message.senderPhoneNumber
        );
        await markMessageForFollowUp(interactiveMediaResponse.messages[0].id);
        break;
      }
      case constants.REPLY_MEDIA_CAROUSEL_ID: {
        const mediaCarouselResponse = await sendMediaCarouselMessage(
          accessToken, message.id, senderPhoneNumberId, message.senderPhoneNumber
        );
        await markMessageForFollowUp(mediaCarouselResponse.messages[0].id);
        break;
      }
      case constants.REPLY_OFFER_ID: {
        const ltoResponse = await sendLimitedTimeOfferMessage(
          accessToken, message.id, senderPhoneNumberId, message.senderPhoneNumber
        );
        await markMessageForFollowUp(ltoResponse.messages[0].id);
        break;
      }
      default:
        await sendTryOutDemoMessage(
          accessToken, message.id, senderPhoneNumberId, message.senderPhoneNumber,
          constants.APP_DEFAULT_MESSAGE
        );
        break;
    }
  }

  static async handleStatus(senderPhoneNumberId, rawStatus, accessToken) {
    if (!accessToken) return;

    const status = new Status(rawStatus);
    if (!(status.status === "delivered" || status.status === "read")) {
      return;
    }

    if (await Cache.remove(status.messageId)) {
      await sendTryOutDemoMessage(
        accessToken, undefined, senderPhoneNumberId, status.recipientPhoneNumber,
        constants.APP_TRY_ANOTHER_MESSAGE
      );
    }
  }
};
