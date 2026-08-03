/**
 * @fileoverview documentAiService — Análise de documentos via Claude AI
 * Segue padrão civicKnowledgeService.js: Claude Sonnet com prompt caching.
 * Requer ai_consent = true no documento. PDF via pdf-parse, imagens via vision.
 */

'use strict';

const { getSupabaseClient } = require('../config/supabase');
const anthropicClient       = require('../config/anthropic/anthropicClient');
const { logger }            = require('../logger');
const gamificationService   = require('./gamificationService');
const accessLogService      = require('./documentAccessLogService');

const SERVICE = 'documentAiService';
const AI_MODEL = 'claude-sonnet-4-20250514';
const BUCKET = 'document-vault';

function sb() {
  const client = getSupabaseClient();
  if (!client) throw new Error('Supabase client indisponivel');
  return client;
}

function log(fn, msg, extra = {}) {
  logger.info(msg, { service: SERVICE, function: fn, ...extra });
}

const ANALYSIS_SYSTEM_PROMPT = `Voce e um analista de documentos para a plataforma ElosCloud (Brasil).
Analise o documento fornecido e retorne SOMENTE um JSON valido (sem markdown):

{
  "summary": "Resumo conciso do documento em 2-3 frases",
  "key_points": ["Ponto-chave 1", "Ponto-chave 2", "Ponto-chave 3"],
  "risk_flags": ["Flag de risco se houver, ou array vazio"],
  "classification": {
    "type": "contrato|laudo|receita|exame|declaracao|nota_fiscal|procuracao|alvara|certidao|outro",
    "language": "pt-BR",
    "contains_personal_data": true,
    "contains_financial_data": false
  }
}

REGRAS:
- Resumo: maximo 200 caracteres, linguagem simples
- Key points: 3-5 pontos, objetivos
- Risk flags: alerte sobre clausulas abusivas, valores suspeitos, dados inconsistentes
- NUNCA invente dados que nao estejam no documento
- Se nao conseguir ler o documento, retorne summary: "Documento ilegivel"`;

// ── 1. analyzeDocument — pipeline de análise ─────────────────────────────────

async function analyzeDocument(documentId, userId, req) {
  const fn = 'analyzeDocument';

  if (!anthropicClient) {
    throw new Error('Servico de IA indisponivel (ANTHROPIC_API_KEY nao configurada)');
  }

  // Buscar documento
  const { data: doc, error: docErr } = await sb()
    .from('booking_documents')
    .select('*, booking_document_vaults!inner(client_uid, provider_uid, authorized_uids)')
    .eq('id', documentId)
    .eq('is_deleted', false)
    .single();

  if (docErr || !doc) throw new Error('Documento nao encontrado');

  // Verificar acesso
  const vault = doc.booking_document_vaults;
  if (vault.client_uid !== userId && vault.provider_uid !== userId
      && !(vault.authorized_uids || []).includes(userId)) {
    throw new Error('Sem permissao para analisar este documento');
  }

  // Verificar consentimento AI
  if (!doc.ai_consent) {
    throw new Error('Consentimento de analise IA nao concedido para este documento');
  }

  // Verificar se ja existe analise em andamento ou completa
  const { data: existing } = await sb()
    .from('document_ai_analyses')
    .select('id, status')
    .eq('document_id', documentId)
    .in('status', ['pending', 'processing', 'completed'])
    .order('created_at', { ascending: false })
    .limit(1)
    .maybeSingle();

  if (existing?.status === 'completed') {
    return existing;
  }
  if (existing?.status === 'processing' || existing?.status === 'pending') {
    return existing;
  }

  // Criar registro de analise
  const { data: analysis, error: insertErr } = await sb()
    .from('document_ai_analyses')
    .insert([{
      document_id: documentId,
      vault_id: doc.vault_id,
      requested_by: userId,
      status: 'processing',
      model_used: AI_MODEL,
    }])
    .select()
    .single();

  if (insertErr) throw new Error(`Erro ao criar analise: ${insertErr.message}`);

  // Processar em background (fire-and-forget)
  _processAnalysis(analysis.id, doc, userId, req).catch(err => {
    logger.error(`[${SERVICE}] Analysis failed`, {
      analysisId: analysis.id, documentId, error: err.message,
    });
  });

  log(fn, 'Analise solicitada', { analysisId: analysis.id, documentId });
  return analysis;
}

// ── Background processing ────────────────────────────────────────────────────

async function _processAnalysis(analysisId, doc, userId, req) {
  const fn = '_processAnalysis';

  try {
    // Baixar arquivo do Storage
    const { data: fileData, error: downloadErr } = await sb()
      .storage
      .from(BUCKET)
      .download(doc.storage_path);

    if (downloadErr) throw new Error(`Download falhou: ${downloadErr.message}`);

    const buffer = Buffer.from(await fileData.arrayBuffer());
    let content;

    if (doc.mime_type === 'application/pdf') {
      // PDF: extrair texto
      content = await _extractPdfText(buffer);
    } else if (doc.mime_type.startsWith('image/')) {
      // Imagem: usar Claude Vision
      content = await _analyzeImage(buffer, doc.mime_type);
    } else {
      // Outros: tentar como texto
      content = buffer.toString('utf-8').slice(0, 10000);
    }

    if (!content || content.length < 10) {
      await _updateAnalysis(analysisId, {
        status: 'failed',
        error_message: 'Conteudo insuficiente para analise',
      });
      return;
    }

    // Chamar Claude
    const response = await anthropicClient.messages.create({
      model: AI_MODEL,
      max_tokens: 1024,
      system: ANALYSIS_SYSTEM_PROMPT,
      messages: [{
        role: 'user',
        content: `Analise este documento (${doc.file_name}, tipo: ${doc.document_type}):\n\n${content}`,
      }],
    });

    const rawText = response.content?.[0]?.text || '';
    const tokensUsed = (response.usage?.input_tokens || 0) + (response.usage?.output_tokens || 0);

    // Parse JSON da resposta
    let parsed;
    try {
      // Remove markdown code blocks if present
      const cleaned = rawText.replace(/```json?\n?/g, '').replace(/```/g, '').trim();
      parsed = JSON.parse(cleaned);
    } catch {
      parsed = {
        summary: rawText.slice(0, 200),
        key_points: [],
        risk_flags: [],
        classification: {},
      };
    }

    await _updateAnalysis(analysisId, {
      status: 'completed',
      summary: parsed.summary || null,
      key_points: parsed.key_points || [],
      risk_flags: parsed.risk_flags || [],
      classification: parsed.classification || {},
      tokens_used: tokensUsed,
    });

    // Audit log
    await accessLogService.logAccess(doc.id, doc.vault_id, userId, 'ai_analyzed', req, {
      analysisId, model: AI_MODEL, tokensUsed,
    });

    // Gamification
    gamificationService.triggerEvent('vault_ai_analysis_completed', userId, {
      documentId: doc.id, analysisId,
    }).catch(() => {});

    log(fn, 'Analise concluida', { analysisId, tokensUsed });
  } catch (err) {
    logger.error(`[${SERVICE}] _processAnalysis falhou`, {
      analysisId, error: err.message,
    });
    await _updateAnalysis(analysisId, {
      status: 'failed',
      error_message: err.message,
    });
  }
}

async function _extractPdfText(buffer) {
  try {
    const pdfParse = require('pdf-parse');
    const data = await pdfParse(buffer);
    return data.text?.slice(0, 15000) || '';
  } catch (err) {
    logger.warn(`[${SERVICE}] PDF parse failed: ${err.message}`);
    return '';
  }
}

async function _analyzeImage(buffer, mimeType) {
  // Usar Claude Vision para extrair texto da imagem
  const base64 = buffer.toString('base64');
  const mediaType = mimeType === 'image/jpeg' ? 'image/jpeg' : 'image/png';

  const response = await anthropicClient.messages.create({
    model: AI_MODEL,
    max_tokens: 2048,
    messages: [{
      role: 'user',
      content: [
        {
          type: 'image',
          source: { type: 'base64', media_type: mediaType, data: base64 },
        },
        {
          type: 'text',
          text: 'Extraia todo o texto visivel nesta imagem de documento. Retorne apenas o texto, sem formatacao adicional.',
        },
      ],
    }],
  });

  return response.content?.[0]?.text || '';
}

async function _updateAnalysis(analysisId, updates) {
  await sb()
    .from('document_ai_analyses')
    .update(updates)
    .eq('id', analysisId);
}

// ── 2. getAnalysis — ver resultado ───────────────────────────────────────────

async function getAnalysis(documentId, userId) {
  const fn = 'getAnalysis';

  // Verificar acesso via vault
  const { data: doc, error: docErr } = await sb()
    .from('booking_documents')
    .select('vault_id, booking_document_vaults!inner(client_uid, provider_uid, authorized_uids)')
    .eq('id', documentId)
    .single();

  if (docErr || !doc) return null;

  const vault = doc.booking_document_vaults;
  if (vault.client_uid !== userId && vault.provider_uid !== userId
      && !(vault.authorized_uids || []).includes(userId)) {
    throw new Error('Sem permissao para ver analise');
  }

  const { data, error } = await sb()
    .from('document_ai_analyses')
    .select('*')
    .eq('document_id', documentId)
    .order('created_at', { ascending: false })
    .limit(1)
    .maybeSingle();

  if (error) throw error;

  log(fn, 'Analise consultada', { documentId, userId, status: data?.status });
  return data;
}

module.exports = {
  analyzeDocument,
  getAnalysis,
};
