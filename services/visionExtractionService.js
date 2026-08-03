/**
 * @fileoverview VisionExtractionService — Extrai dados estruturados de imagens via Claude Vision API.
 *
 * Funcionalidades:
 *   - extractFromImage(buffer, templateType, options) — envia imagem para Claude Vision
 *   - extractFromUrl(imageUrl, templateType, options) — baixa e extrai
 *   - getAvailableTemplates() — retorna templates disponíveis
 *   - validateExtractionResult(result, templateType) — valida completude e confianca
 *
 * Rate limit: 10 extractions per user per hour.
 * Modelo: claude-sonnet-4-20250514
 */

const { logger } = require('../logger');
const anthropicClient = require('../config/anthropic/anthropicClient');
const { getSupabaseClient } = require('../config/supabase');
const sharp = require('sharp');

const SERVICE = 'visionExtractionService';
const VISION_MODEL = process.env.CLAUDE_VISION_MODEL || 'claude-sonnet-4-20250514';
const MAX_IMAGE_SIZE = 10 * 1024 * 1024; // 10 MB
const MAX_EXTRACTIONS_PER_HOUR = 10;
const LOW_CONFIDENCE_THRESHOLD = 0.5;
const RETRY_DELAY_MS = 2000;

// ── Template definitions ─────────────────────────────────────────────────────

const TEMPLATES = {
  receipt: {
    name: 'Recibo / Cupom Fiscal',
    description: 'Extrai dados de recibos e cupons fiscais: comerciante, data, total, itens, forma de pagamento, impostos.',
    schema: {
      merchant: 'string — nome do estabelecimento',
      date: 'string — data da compra (ISO 8601 ou formato original)',
      total: 'number — valor total',
      items: 'array of { name, quantity, unit_price, total }',
      payment_method: 'string — forma de pagamento (dinheiro, cartao, pix, etc)',
      tax: 'number | null — valor de impostos',
    },
    prompt: `Analise esta imagem de recibo/cupom fiscal e extraia os seguintes dados em JSON:
- merchant: nome do estabelecimento
- date: data da compra (formato ISO 8601 se possivel, senao o formato original)
- total: valor total (numero)
- items: array de objetos com { name, quantity, unit_price, total }
- payment_method: forma de pagamento (dinheiro, cartao, pix, etc)
- tax: valor de impostos (numero ou null se nao constar)

Responda APENAS com o JSON, sem explicacoes. Se algum campo nao estiver legivel, use null.`,
  },

  document_id: {
    name: 'Documento de Identidade',
    description: 'Extrai dados de RG, CNH ou CPF: nome completo, numero, data de nascimento, validade, orgao emissor.',
    schema: {
      full_name: 'string — nome completo',
      document_number: 'string — numero do documento',
      document_type: 'string — tipo (RG, CNH, CPF)',
      birth_date: 'string — data de nascimento',
      expiry_date: 'string | null — data de validade',
      issuing_authority: 'string | null — orgao emissor',
    },
    prompt: `Analise esta imagem de documento de identidade brasileiro (RG, CNH ou CPF) e extraia os seguintes dados em JSON:
- full_name: nome completo
- document_number: numero do documento
- document_type: tipo do documento (RG, CNH, CPF)
- birth_date: data de nascimento (formato ISO 8601 se possivel)
- expiry_date: data de validade (ou null se nao constar)
- issuing_authority: orgao emissor (ou null se nao constar)

IMPORTANTE: Nao invente dados. Se algum campo nao estiver legivel, use null.
Responda APENAS com o JSON, sem explicacoes.`,
  },

  product_label: {
    name: 'Rotulo de Produto',
    description: 'Extrai dados de rotulos de produtos: nome, marca, peso, ingredientes, preco, codigo de barras.',
    schema: {
      product_name: 'string — nome do produto',
      brand: 'string | null — marca',
      weight: 'string | null — peso/volume',
      ingredients: 'array of string | null — lista de ingredientes',
      price: 'number | null — preco',
      barcode: 'string | null — codigo de barras (EAN/UPC)',
    },
    prompt: `Analise esta imagem de rotulo de produto e extraia os seguintes dados em JSON:
- product_name: nome do produto
- brand: marca (ou null)
- weight: peso ou volume com unidade (ex: "500g", "1L")
- ingredients: array de ingredientes (ou null se nao visivel)
- price: preco numerico (ou null se nao visivel)
- barcode: codigo de barras EAN/UPC (ou null se nao visivel)

Responda APENAS com o JSON, sem explicacoes. Se algum campo nao estiver legivel, use null.`,
  },

  business_card: {
    name: 'Cartao de Visita',
    description: 'Extrai dados de cartoes de visita: nome, empresa, cargo, telefone, email, endereco.',
    schema: {
      name: 'string — nome da pessoa',
      company: 'string | null — nome da empresa',
      title: 'string | null — cargo',
      phone: 'string | null — telefone',
      email: 'string | null — email',
      address: 'string | null — endereco',
    },
    prompt: `Analise esta imagem de cartao de visita e extraia os seguintes dados em JSON:
- name: nome da pessoa
- company: nome da empresa (ou null)
- title: cargo/titulo (ou null)
- phone: telefone com DDD (ou null)
- email: endereco de email (ou null)
- address: endereco completo (ou null)

Responda APENAS com o JSON, sem explicacoes. Se algum campo nao estiver legivel, use null.`,
  },

  invoice: {
    name: 'Nota Fiscal / Fatura',
    description: 'Extrai dados de notas fiscais: emissor, destinatario, numero, data, itens, total, impostos.',
    schema: {
      issuer: 'string — nome/razao social do emissor',
      recipient: 'string | null — nome/razao social do destinatario',
      invoice_number: 'string — numero da nota',
      date: 'string — data de emissao',
      items: 'array of { description, quantity, unit_price, total }',
      total: 'number — valor total',
      tax: 'number | null — valor de impostos',
    },
    prompt: `Analise esta imagem de nota fiscal ou fatura e extraia os seguintes dados em JSON:
- issuer: nome ou razao social do emissor
- recipient: nome ou razao social do destinatario (ou null)
- invoice_number: numero da nota/fatura
- date: data de emissao (formato ISO 8601 se possivel)
- items: array de objetos com { description, quantity, unit_price, total }
- total: valor total (numero)
- tax: valor de impostos (numero ou null)

Responda APENAS com o JSON, sem explicacoes. Se algum campo nao estiver legivel, use null.`,
  },

  custom: {
    name: 'Personalizado',
    description: 'Template personalizado: o usuario fornece o schema de extracao em options.schema.',
    schema: null,
    prompt: null, // built dynamically
  },
};

// ── Cost estimation per model (approximate USD per input/output token) ───────

const COST_PER_INPUT_TOKEN = 0.003 / 1000;   // Claude Sonnet ~$3/M input
const COST_PER_OUTPUT_TOKEN = 0.015 / 1000;   // Claude Sonnet ~$15/M output

// ── Helpers ──────────────────────────────────────────────────────────────────

function estimateCost(usage) {
  if (!usage) return 0;
  const inputCost = (usage.input_tokens || 0) * COST_PER_INPUT_TOKEN;
  const outputCost = (usage.output_tokens || 0) * COST_PER_OUTPUT_TOKEN;
  return Math.round((inputCost + outputCost) * 1_000_000) / 1_000_000; // 6 decimal places
}

function getMediaType(buffer) {
  // Check magic bytes
  if (buffer[0] === 0xFF && buffer[1] === 0xD8) return 'image/jpeg';
  if (buffer[0] === 0x89 && buffer[1] === 0x50) return 'image/png';
  if (buffer[0] === 0x47 && buffer[1] === 0x49) return 'image/gif';
  if (buffer[0] === 0x52 && buffer[1] === 0x49) return 'image/webp';
  return 'image/jpeg'; // fallback
}

async function resizeIfNeeded(buffer) {
  if (buffer.length <= MAX_IMAGE_SIZE) return buffer;

  logger.info('Image exceeds 10MB, resizing', { service: SERVICE, originalSize: buffer.length });

  return sharp(buffer)
    .resize({ width: 2048, height: 2048, fit: 'inside', withoutEnlargement: true })
    .jpeg({ quality: 85 })
    .toBuffer();
}

function buildCustomPrompt(schema) {
  const fields = Object.entries(schema)
    .map(([key, desc]) => `- ${key}: ${desc}`)
    .join('\n');

  return `Analise esta imagem e extraia os seguintes dados em JSON:
${fields}

Responda APENAS com o JSON, sem explicacoes. Se algum campo nao estiver legivel, use null.
Inclua tambem um campo "confidence" de 0 a 1 indicando sua confianca geral na extracao.`;
}

// ── Rate limiting (in-memory, reset hourly) ─────────────────────────────────

const rateLimitMap = new Map(); // userId -> { count, resetAt }

function checkRateLimit(userId) {
  const now = Date.now();
  const entry = rateLimitMap.get(userId);

  if (!entry || now > entry.resetAt) {
    rateLimitMap.set(userId, { count: 1, resetAt: now + 3600_000 });
    return true;
  }

  if (entry.count >= MAX_EXTRACTIONS_PER_HOUR) {
    return false;
  }

  entry.count++;
  return true;
}

// Periodic cleanup of rate limit map (every 10 minutes)
setInterval(() => {
  const now = Date.now();
  for (const [key, val] of rateLimitMap) {
    if (now > val.resetAt) rateLimitMap.delete(key);
  }
}, 600_000);

// ── Core extraction ─────────────────────────────────────────────────────────

/**
 * Sends an image buffer to Claude Vision API and extracts structured data.
 * @param {Buffer} imageBuffer - The image buffer
 * @param {string} templateType - One of the TEMPLATES keys or 'custom'
 * @param {Object} [options={}] - Additional options
 * @param {string} [options.userId] - User ID for rate limiting & logging
 * @param {Object} [options.schema] - Required when templateType is 'custom'
 * @param {string} [options.language='pt-BR'] - Preferred response language
 * @returns {Promise<Object>} Extraction result
 */
async function extractFromImage(imageBuffer, templateType, options = {}) {
  const startTime = Date.now();
  const userId = options.userId || 'anonymous';

  // Validate template
  if (!TEMPLATES[templateType]) {
    return {
      success: false,
      error: `Template "${templateType}" desconhecido. Use getAvailableTemplates() para ver opcoes.`,
      processing_time_ms: Date.now() - startTime,
      template_used: templateType,
    };
  }

  // Rate limit
  if (!checkRateLimit(userId)) {
    return {
      success: false,
      error: 'Limite de extracoes atingido (10 por hora). Tente novamente mais tarde.',
      processing_time_ms: Date.now() - startTime,
      template_used: templateType,
    };
  }

  // Validate Anthropic client
  if (!anthropicClient) {
    return {
      success: false,
      error: 'Servico de IA indisponivel. ANTHROPIC_API_KEY nao configurada.',
      processing_time_ms: Date.now() - startTime,
      template_used: templateType,
    };
  }

  // Validate buffer
  if (!imageBuffer || !Buffer.isBuffer(imageBuffer) || imageBuffer.length === 0) {
    return {
      success: false,
      error: 'Buffer de imagem invalido ou vazio.',
      processing_time_ms: Date.now() - startTime,
      template_used: templateType,
    };
  }

  // Validate format
  const mediaType = getMediaType(imageBuffer);
  const supportedFormats = ['image/jpeg', 'image/png', 'image/gif', 'image/webp'];
  if (!supportedFormats.includes(mediaType)) {
    return {
      success: false,
      error: `Formato de imagem nao suportado: ${mediaType}. Use JPEG, PNG, GIF ou WebP.`,
      processing_time_ms: Date.now() - startTime,
      template_used: templateType,
    };
  }

  try {
    // Resize if needed
    const processedBuffer = await resizeIfNeeded(imageBuffer);
    const base64Image = processedBuffer.toString('base64');

    // Build prompt
    let prompt;
    if (templateType === 'custom') {
      if (!options.schema || typeof options.schema !== 'object') {
        return {
          success: false,
          error: 'Template "custom" requer options.schema (objeto descrevendo campos a extrair).',
          processing_time_ms: Date.now() - startTime,
          template_used: templateType,
        };
      }
      prompt = buildCustomPrompt(options.schema);
    } else {
      prompt = TEMPLATES[templateType].prompt;
    }

    // Add confidence request to all prompts
    const fullPrompt = prompt + '\n\nAlem dos campos solicitados, inclua um campo "confidence" de 0.0 a 1.0 indicando sua confianca geral na extracao.';

    // Call Claude Vision API with retry
    let response;
    try {
      response = await _callClaudeVision(base64Image, mediaType, fullPrompt);
    } catch (firstError) {
      logger.warn('First Claude Vision call failed, retrying', {
        service: SERVICE,
        error: firstError.message,
        userId,
      });

      // Retry with exponential backoff
      await new Promise(resolve => setTimeout(resolve, RETRY_DELAY_MS));

      try {
        response = await _callClaudeVision(base64Image, mediaType, fullPrompt);
      } catch (retryError) {
        const processingTime = Date.now() - startTime;

        await _logExtraction(userId, templateType, 'upload', 0, false, processingTime, 0, retryError.message);

        return {
          success: false,
          error: `Falha na API de visao apos retentativa: ${retryError.message}`,
          processing_time_ms: processingTime,
          template_used: templateType,
        };
      }
    }

    // Parse response
    const rawText = response.content?.[0]?.text?.trim() || '';
    let parsedData;

    try {
      // Extract JSON from response (handle markdown code blocks)
      const jsonMatch = rawText.match(/```(?:json)?\s*([\s\S]*?)```/) || [null, rawText];
      parsedData = JSON.parse(jsonMatch[1].trim());
    } catch (parseError) {
      const processingTime = Date.now() - startTime;

      await _logExtraction(userId, templateType, 'upload', 0, false, processingTime, estimateCost(response.usage), 'Falha ao parsear JSON da resposta');

      return {
        success: false,
        error: 'Falha ao parsear resposta da IA. Tente novamente com uma imagem mais nitida.',
        raw_text: rawText,
        processing_time_ms: processingTime,
        template_used: templateType,
      };
    }

    // Extract confidence
    const confidence = typeof parsedData.confidence === 'number'
      ? Math.min(1, Math.max(0, parsedData.confidence))
      : 0.7; // default if not provided

    // Remove confidence from extracted data (it's metadata)
    const { confidence: _, ...extractedData } = parsedData;

    const processingTime = Date.now() - startTime;
    const costEstimate = estimateCost(response.usage);

    // Log extraction
    await _logExtraction(userId, templateType, 'upload', confidence, true, processingTime, costEstimate, null);

    // Validate result
    const validation = validateExtractionResult({ data: extractedData, confidence }, templateType);

    const result = {
      success: true,
      data: extractedData,
      confidence,
      raw_text: rawText,
      processing_time_ms: processingTime,
      template_used: templateType,
      cost_estimate_usd: costEstimate,
      validation,
    };

    // Flag low confidence
    if (confidence < LOW_CONFIDENCE_THRESHOLD) {
      result.warning = 'Confianca baixa na extracao. Recomenda-se revisao manual.';
    }

    logger.info('Vision extraction completed', {
      service: SERVICE,
      templateType,
      confidence,
      processingTime,
      userId,
    });

    return result;
  } catch (error) {
    const processingTime = Date.now() - startTime;

    logger.error('Vision extraction error', {
      service: SERVICE,
      error: error.message,
      stack: error.stack,
      templateType,
      userId,
    });

    await _logExtraction(userId, templateType, 'upload', 0, false, processingTime, 0, error.message);

    return {
      success: false,
      error: `Erro na extracao: ${error.message}`,
      processing_time_ms: processingTime,
      template_used: templateType,
    };
  }
}

/**
 * Downloads an image from a URL and extracts structured data.
 * @param {string} imageUrl - Public URL of the image
 * @param {string} templateType - Template type
 * @param {Object} [options={}] - Additional options
 * @returns {Promise<Object>} Extraction result
 */
async function extractFromUrl(imageUrl, templateType, options = {}) {
  const startTime = Date.now();

  try {
    // Validate URL
    new URL(imageUrl);
  } catch {
    return {
      success: false,
      error: 'URL invalida.',
      processing_time_ms: Date.now() - startTime,
      template_used: templateType,
    };
  }

  try {
    const response = await fetch(imageUrl, {
      signal: AbortSignal.timeout(15000), // 15s timeout
      headers: { 'User-Agent': 'ElosCloud-VisionService/1.0' },
    });

    if (!response.ok) {
      return {
        success: false,
        error: `Falha ao baixar imagem: HTTP ${response.status}`,
        processing_time_ms: Date.now() - startTime,
        template_used: templateType,
      };
    }

    const contentType = response.headers.get('content-type') || '';
    if (!contentType.startsWith('image/')) {
      return {
        success: false,
        error: `URL nao aponta para uma imagem. Content-Type: ${contentType}`,
        processing_time_ms: Date.now() - startTime,
        template_used: templateType,
      };
    }

    const arrayBuffer = await response.arrayBuffer();
    const buffer = Buffer.from(arrayBuffer);

    // Override source_type for logging
    const result = await extractFromImage(buffer, templateType, { ...options, _sourceType: 'url' });

    // If the inner log already ran with 'upload', update it to 'url'
    // (the inner call uses 'upload' as default, we override on the log step)
    return result;
  } catch (error) {
    logger.error('Failed to download image from URL', {
      service: SERVICE,
      error: error.message,
      imageUrl,
    });

    return {
      success: false,
      error: `Falha ao baixar imagem: ${error.message}`,
      processing_time_ms: Date.now() - startTime,
      template_used: templateType,
    };
  }
}

/**
 * Returns list of available extraction templates.
 * @returns {Array<Object>}
 */
function getAvailableTemplates() {
  return Object.entries(TEMPLATES).map(([key, t]) => ({
    type: key,
    name: t.name,
    description: t.description,
    schema: t.schema,
  }));
}

/**
 * Validates extraction completeness and confidence.
 * @param {Object} result - { data, confidence }
 * @param {string} templateType - Template type
 * @returns {Object} { complete, missing_fields, confidence_level }
 */
function validateExtractionResult(result, templateType) {
  if (!result || !result.data) {
    return { complete: false, missing_fields: ['all'], confidence_level: 'none' };
  }

  const template = TEMPLATES[templateType];
  const missingFields = [];

  if (template && template.schema) {
    for (const key of Object.keys(template.schema)) {
      if (result.data[key] === undefined || result.data[key] === null) {
        missingFields.push(key);
      }
    }
  }

  const confidenceLevel = result.confidence >= 0.8
    ? 'high'
    : result.confidence >= LOW_CONFIDENCE_THRESHOLD
      ? 'medium'
      : 'low';

  return {
    complete: missingFields.length === 0,
    missing_fields: missingFields,
    confidence_level: confidenceLevel,
  };
}

// ── Private helpers ─────────────────────────────────────────────────────────

/**
 * Calls Claude Vision API.
 */
async function _callClaudeVision(base64Image, mediaType, prompt) {
  const response = await anthropicClient.messages.create({
    model: VISION_MODEL,
    max_tokens: 2048,
    messages: [
      {
        role: 'user',
        content: [
          {
            type: 'image',
            source: {
              type: 'base64',
              media_type: mediaType,
              data: base64Image,
            },
          },
          {
            type: 'text',
            text: prompt,
          },
        ],
      },
    ],
    temperature: 0.1, // Low temperature for structured extraction
  });

  logger.info('Claude Vision API call completed', {
    service: SERVICE,
    model: VISION_MODEL,
    input_tokens: response.usage?.input_tokens || 0,
    output_tokens: response.usage?.output_tokens || 0,
  });

  return response;
}

/**
 * Logs an extraction attempt to the database.
 */
async function _logExtraction(userId, templateType, sourceType, confidence, success, processingTimeMs, estimatedCostUsd, errorMessage) {
  try {
    const sb = getSupabaseClient();
    if (!sb) return;

    await sb.from('vision_extraction_log').insert({
      user_id: userId,
      template_type: templateType,
      source_type: sourceType,
      confidence: confidence || 0,
      success,
      processing_time_ms: processingTimeMs,
      estimated_cost_usd: estimatedCostUsd || 0,
      error_message: errorMessage || null,
    });
  } catch (err) {
    logger.warn('Failed to log vision extraction', {
      service: SERVICE,
      error: err.message,
    });
  }
}

module.exports = {
  extractFromImage,
  extractFromUrl,
  getAvailableTemplates,
  validateExtractionResult,
};
