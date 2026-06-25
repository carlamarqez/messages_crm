/**
 * Helpers for WhatsApp message template creation.
 */

"use strict";

const TEMPLATE_NAME_RE = /^[a-z][a-z0-9_]*$/;
const MAX_NAME_LEN = 512;
const MAX_BODY_LEN = 1024;
const MAX_FOOTER_LEN = 60;

function normalizeTemplateName(name) {
  return String(name || "")
    .trim()
    .toLowerCase()
    .replace(/\s+/g, "_")
    .replace(/[^a-z0-9_]/g, "");
}

function countBodyVariables(body) {
  const matches = body.match(/\{\{\d+\}\}/g) || [];
  return matches.length;
}

function buildCreateTemplateBody({ name, language, category, body, footer, examples }) {
  const normalizedName = normalizeTemplateName(name);
  if (!normalizedName || normalizedName.length > MAX_NAME_LEN) {
    throw new Error("El nombre debe usar solo minúsculas, números y guiones bajos.");
  }
  if (!TEMPLATE_NAME_RE.test(normalizedName)) {
    throw new Error("El nombre debe empezar con una letra y usar solo a-z, 0-9 y _.");
  }

  const bodyText = String(body || "").trim();
  if (!bodyText) {
    throw new Error("El texto del cuerpo es obligatorio.");
  }
  if (bodyText.length > MAX_BODY_LEN) {
    throw new Error(`El cuerpo no puede superar ${MAX_BODY_LEN} caracteres.`);
  }

  const lang = String(language || "").trim();
  if (!lang) {
    throw new Error("Seleccioná un idioma.");
  }

  const cat = String(category || "").trim().toUpperCase();
  if (!["UTILITY", "MARKETING", "AUTHENTICATION"].includes(cat)) {
    throw new Error("Categoría inválida. Usá UTILITY, MARKETING o AUTHENTICATION.");
  }

  const components = [{ type: "BODY", text: bodyText }];

  const varCount = countBodyVariables(bodyText);
  if (varCount > 0) {
    let row = Array.isArray(examples) ? examples.map((v) => String(v).trim()) : [];
    if (row.length !== varCount) {
      row = Array.from({ length: varCount }, (_, i) => `ejemplo_${i + 1}`);
    }
    components[0].example = { body_text: [row] };
  }

  const footerText = String(footer || "").trim();
  if (footerText) {
    if (footerText.length > MAX_FOOTER_LEN) {
      throw new Error(`El pie no puede superar ${MAX_FOOTER_LEN} caracteres.`);
    }
    components.push({ type: "FOOTER", text: footerText });
  }

  return {
    name: normalizedName,
    language: lang,
    category: cat,
    components
  };
}

function formatTemplateForList(item) {
  const bodyComponent = (item.components || []).find((c) => c.type === "BODY");
  const footerComponent = (item.components || []).find((c) => c.type === "FOOTER");
  return {
    id: item.id,
    name: item.name,
    status: item.status,
    language: item.language,
    category: item.category,
    body: bodyComponent?.text || null,
    footer: footerComponent?.text || null
  };
}

/** Plantillas del demo Jasper's Market en Meta — ocultas en el panel. */
const JASPER_DEMO_TEMPLATE_PREFIX = "jaspers_market_";

const JASPER_DEMO_TEMPLATE_NAMES = new Set([
  "grocery_delivery_utility",
  "recipe_media_carousel",
  "strawberries_limited_offer"
]);

function isHiddenDemoTemplate(name) {
  const normalized = String(name || "").toLowerCase();
  return (
    normalized.startsWith(JASPER_DEMO_TEMPLATE_PREFIX) ||
    JASPER_DEMO_TEMPLATE_NAMES.has(normalized)
  );
}

function filterTemplatesForList(templates) {
  return templates.filter((t) => !isHiddenDemoTemplate(t.name));
}

module.exports = {
  normalizeTemplateName,
  buildCreateTemplateBody,
  formatTemplateForList,
  filterTemplatesForList,
  countBodyVariables
};
