'use strict';

const { createClient } = require('@supabase/supabase-js');
const { logger } = require('../logger');
const anthropicClient = require('../config/anthropic/anthropicClient');

const SERVICE = 'receiptValidationService';

function log(fn, msg, extra = {}) {
  logger.info(msg, { service: SERVICE, function: fn, ...extra });
}

function logError(fn, err, extra = {}) {
  logger.error(`Erro em ${fn}: ${err.message}`, {
    service: SERVICE, function: fn, error: err.message, ...extra,
  });
}

function sbService() {
  const url = process.env.SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) throw new Error('SUPABASE_URL ou SUPABASE_SERVICE_ROLE_KEY não configurados.');
  return createClient(url, key, { auth: { persistSession: false } });
}

// System prompt estável para análise de comprovantes PIX via Vision
const RECEIPT_ANALYSIS_SYSTEM_PROMPT = `Você é um analista financeiro especializado em comprovantes de pagamento PIX brasileiros.
Sua tarefa é extrair dados estruturados de imagens de comprovantes de transferência PIX.
Retorne SOMENTE um JSON válido (sem markdown, sem texto extra).
Se não conseguir extrair algum campo, use null.`;

// MIME para media_type da Anthropic Vision API
const MIME_TO_MEDIA = {
  'image/jpeg': 'image/jpeg',
  'image/png': 'image/png',
  'image/webp': 'image/webp',
  'image/gif': 'image/gif',
};

/**
 * Analisa um comprovante de pagamento via Claude Vision.
 *
 * @param {string} receiptId  — ID do receipt na tabela contribution_receipts
 * @returns {{ status: string, confidence: number, extractedData: object }}
 */
async function analyzeReceipt(receiptId) {
  const fn = 'analyzeReceipt';
  const supabase = sbService();

  // 1. Buscar receipt
  const { data: receipt, error: fetchErr } = await supabase
    .from('contribution_receipts')
    .select('id, amount, receipt_path, receipt_url')
    .eq('id', receiptId)
    .maybeSingle();

  if (fetchErr || !receipt) {
    logError(fn, fetchErr || new Error('Receipt não encontrado'), { receiptId });
    return _failResult('Receipt não encontrado');
  }

  if (!receipt.receipt_path) {
    log(fn, 'Receipt sem arquivo, pulando validação IA', { receiptId });
    return _failResult('Sem arquivo para análise');
  }

  // 2. Verificar se é PDF (Vision não processa PDF nativamente)
  const ext = receipt.receipt_path.split('.').pop()?.toLowerCase();
  if (ext === 'pdf') {
    log(fn, 'Arquivo PDF — análise IA indisponível', { receiptId });
    return _uncertainResult('Comprovante em PDF — revisão manual necessária');
  }

  // 3. Verificar se Anthropic client está disponível
  if (!anthropicClient) {
    log(fn, 'Anthropic client indisponível, fallback para revisão manual', { receiptId });
    return _failResult('Serviço de IA indisponível');
  }

  // 4. Download do arquivo do Supabase Storage
  let fileBuffer;
  let mimeType;
  try {
    const { data: fileData, error: dlErr } = await supabase.storage
      .from('contribution-receipts')
      .download(receipt.receipt_path);

    if (dlErr || !fileData) {
      throw new Error(dlErr?.message || 'Download retornou vazio');
    }

    const arrayBuf = await fileData.arrayBuffer();
    fileBuffer = Buffer.from(arrayBuf);

    // Inferir MIME do path
    const mimeMap = { jpg: 'image/jpeg', jpeg: 'image/jpeg', png: 'image/png', webp: 'image/webp' };
    mimeType = mimeMap[ext] || 'image/jpeg';
  } catch (dlError) {
    logError(fn, dlError, { receiptId, detail: 'Falha ao baixar comprovante do Storage' });
    return _failResult('Falha ao acessar arquivo');
  }

  // 5. Chamar Claude Vision
  const mediaType = MIME_TO_MEDIA[mimeType];
  if (!mediaType) {
    log(fn, 'MIME não suportado para Vision', { receiptId, mimeType });
    return _uncertainResult('Formato de imagem não suportado pela IA');
  }

  try {
    const base64 = fileBuffer.toString('base64');

    const response = await anthropicClient.messages.create({
      model: 'claude-sonnet-4-20250514',
      max_tokens: 512,
      system: [
        {
          type: 'text',
          text: RECEIPT_ANALYSIS_SYSTEM_PROMPT,
          cache_control: { type: 'ephemeral' },
        },
      ],
      messages: [
        {
          role: 'user',
          content: [
            {
              type: 'image',
              source: { type: 'base64', media_type: mediaType, data: base64 },
            },
            {
              type: 'text',
              text: `Analise este comprovante de pagamento PIX brasileiro.
Extraia os seguintes campos no formato JSON:
{
  "amount": <valor numérico em reais, ex: 500.00>,
  "date": "<data da transação em ISO 8601, ex: 2026-06-17T14:30:00>",
  "payeeName": "<nome do destinatário/recebedor>",
  "transactionId": "<ID da transação: E2E, txid, ou NSU>",
  "isPixTransaction": <true se é um comprovante PIX válido, false caso contrário>
}`,
            },
          ],
        },
      ],
    });

    logger.info('[receiptValidationService] Claude cache metrics', {
      service: SERVICE,
      cache_read: response.usage?.cache_read_input_tokens || 0,
      cache_creation: response.usage?.cache_creation_input_tokens || 0,
      input_tokens: response.usage?.input_tokens || 0,
    });

    const rawText = response.content?.[0]?.text || '';
    log(fn, 'Resposta da IA recebida', { receiptId, rawLength: rawText.length });

    // 6. Parsear JSON da resposta
    let extracted;
    try {
      // Remove possíveis backticks markdown
      const cleaned = rawText.replace(/```json\s*/gi, '').replace(/```\s*/gi, '').trim();
      extracted = JSON.parse(cleaned);
    } catch (parseErr) {
      logError(fn, parseErr, { receiptId, rawText: rawText.substring(0, 200) });
      return _uncertainResult('IA retornou formato inválido', { rawText: rawText.substring(0, 500) });
    }

    // 7. Comparar valor extraído com esperado
    const expectedAmount = Number(receipt.amount);
    const extractedAmount = extracted.amount != null ? Number(extracted.amount) : null;
    const isPixValid = extracted.isPixTransaction === true;

    let status;
    let confidence;

    if (extractedAmount === null || !isPixValid) {
      status = 'uncertain';
      confidence = 0.3;
    } else if (Math.abs(extractedAmount - expectedAmount) < 0.01) {
      // Match exato (tolerância de centavo para arredondamento)
      status = 'match';
      confidence = 0.95;
    } else {
      status = 'mismatch';
      confidence = 0.85; // Alta confiança de que é mismatch
    }

    const result = {
      status,
      confidence,
      extractedData: {
        amount: extractedAmount,
        date: extracted.date || null,
        payeeName: extracted.payeeName || null,
        transactionId: extracted.transactionId || null,
        isPixTransaction: isPixValid,
      },
    };

    // 8. Salvar resultado no DB
    await _saveAiResult(supabase, receiptId, result);

    log(fn, 'Análise concluída', { receiptId, status, confidence, extractedAmount, expectedAmount });
    return result;

  } catch (aiErr) {
    logError(fn, aiErr, { receiptId, detail: 'Falha na chamada Claude Vision' });
    const failResult = _failResult('Falha na análise por IA');
    await _saveAiResult(supabase, receiptId, failResult);
    return failResult;
  }
}

// ── Helpers internos ──────────────────────────────────────────────────────────

async function _saveAiResult(supabase, receiptId, result) {
  try {
    await supabase
      .from('contribution_receipts')
      .update({
        ai_confidence: result.confidence,
        ai_extracted_data: result.extractedData || null,
        ai_validation_status: result.status,
      })
      .eq('id', receiptId);
  } catch (err) {
    logError('_saveAiResult', err, { receiptId });
  }
}

function _failResult(reason) {
  return {
    status: 'failed',
    confidence: 0,
    extractedData: { error: reason },
  };
}

function _uncertainResult(reason, extra = {}) {
  return {
    status: 'uncertain',
    confidence: 0.2,
    extractedData: { reason, ...extra },
  };
}

module.exports = { analyzeReceipt };
