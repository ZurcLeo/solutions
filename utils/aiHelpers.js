'use strict';

/**
 * Parse seguro de JSON retornado por modelos de IA.
 *
 * Modelos como Claude e DeepSeek às vezes envolvem o JSON em blocos
 * de markdown (```json ... ```) mesmo quando instruídos a não fazê-lo.
 * Esta função remove esses wrappers antes do parse.
 *
 * @param {string} raw — texto bruto retornado pelo modelo
 * @returns {object} — objeto parseado
 * @throws {SyntaxError} — se o conteúdo não for JSON válido mesmo após limpeza
 */
function safeParseAIJson(raw) {
  const cleaned = raw
    .replace(/^```(?:json)?\s*/i, '')
    .replace(/\s*```$/i, '')
    .trim();
  return JSON.parse(cleaned);
}

module.exports = { safeParseAIJson };
