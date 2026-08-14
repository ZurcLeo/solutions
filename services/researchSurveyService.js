'use strict';

/**
 * @fileoverview researchSurveyService — ElosCloud SURVEY-001~010
 *
 * Form builder generico para pesquisas de mercado.
 * CRUD de surveys, submissao publica, analytics e CSV export.
 */

const { getSupabaseClient } = require('../config/supabase');
const { logger } = require('../logger');
const crypto = require('crypto');

const LOG_TAG = 'ResearchSurveyService';

function sb() {
  const client = getSupabaseClient();
  if (!client) throw new Error('Supabase indisponível');
  return client;
}

function log(fn, msg, extra = {}) {
  logger.info(msg, { service: LOG_TAG, function: fn, ...extra });
}

function logError(fn, err, extra = {}) {
  logger.error(`Erro em ${fn}: ${err.message}`, {
    service: LOG_TAG, function: fn, error: err.message, ...extra,
  });
}

// ── Helpers ─────────────────────────────────────────────────

/**
 * Extrai todas as questions do form_definition (flatten steps).
 */
function _allQuestions(formDef) {
  if (!formDef || !Array.isArray(formDef.steps)) return [];
  const qs = [];
  for (const step of formDef.steps) {
    if (Array.isArray(step.questions)) {
      qs.push(...step.questions);
    }
  }
  return qs;
}

/**
 * Valida answers contra form_definition.
 * Retorna { valid: true } ou { valid: false, errors: [...] }.
 */
function _validateAnswers(formDef, answers) {
  const questions = _allQuestions(formDef);
  const errors = [];

  for (const q of questions) {
    // Check show_when — skip validation if condition not met
    if (q.show_when) {
      const depValue = answers[q.show_when.question_id];
      if (depValue !== q.show_when.equals) continue;
    }

    const val = answers[q.id];

    // Required check
    if (q.required) {
      if (val === undefined || val === null || val === '') {
        errors.push(`Campo "${q.label || q.id}" é obrigatório`);
        continue;
      }
      if (q.type === 'checkbox' && Array.isArray(val) && val.length === 0) {
        errors.push(`Selecione ao menos uma opção em "${q.label || q.id}"`);
        continue;
      }
    }

    // Skip further validation if empty and not required
    if (val === undefined || val === null || val === '') continue;

    // Type-specific validation
    switch (q.type) {
      case 'number': {
        const n = Number(val);
        if (isNaN(n)) {
          errors.push(`"${q.label || q.id}" deve ser um número`);
        } else if (q.validation) {
          if (q.validation.min !== undefined && n < q.validation.min)
            errors.push(`"${q.label || q.id}" mínimo: ${q.validation.min}`);
          if (q.validation.max !== undefined && n > q.validation.max)
            errors.push(`"${q.label || q.id}" máximo: ${q.validation.max}`);
        }
        break;
      }
      case 'email': {
        const emailRe = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
        if (!emailRe.test(val)) {
          errors.push(`"${q.label || q.id}" deve ser um e-mail válido`);
        }
        break;
      }
      case 'tel': {
        const telRe = /^\d{10,11}$/;
        if (!telRe.test(String(val).replace(/\D/g, ''))) {
          errors.push(`"${q.label || q.id}" deve ser um telefone válido (10-11 dígitos)`);
        }
        break;
      }
      case 'radio': {
        if (Array.isArray(q.options) && !q.options.includes(val)) {
          errors.push(`Opção inválida em "${q.label || q.id}"`);
        }
        break;
      }
      case 'checkbox': {
        if (!Array.isArray(val)) {
          errors.push(`"${q.label || q.id}" deve ser uma lista`);
        } else if (Array.isArray(q.options)) {
          const invalid = val.filter(v => !q.options.includes(v));
          if (invalid.length > 0) {
            errors.push(`Opções inválidas em "${q.label || q.id}": ${invalid.join(', ')}`);
          }
        }
        break;
      }
      case 'consent': {
        // consent must be true/accepted
        if (val !== true && val !== 'true' && val !== 'sim') {
          errors.push(`"${q.label || q.id}" requer consentimento`);
        }
        break;
      }
      // text: no extra validation
    }
  }

  return errors.length === 0 ? { valid: true } : { valid: false, errors };
}

/**
 * Hash IP for dedup/spam detection.
 */
function _hashIP(ip) {
  if (!ip) return null;
  return crypto.createHash('sha256').update(ip).digest('hex').slice(0, 16);
}

// ── CRUD (Admin) ────────────────────────────────────────────

async function createSurvey(adminId, data) {
  const fn = 'createSurvey';
  const { title, slug, description, eyebrow, target_audience, form_definition } = data;

  if (!title || !slug) throw new Error('Título e slug são obrigatórios');

  const row = {
    title,
    slug: slug.toLowerCase().trim(),
    description: description || null,
    eyebrow: eyebrow || 'ElosCloud',
    target_audience: target_audience || null,
    form_definition: form_definition || { steps: [], finish_screen: {} },
    created_by: adminId,
    status: 'draft',
  };

  const { data: survey, error } = await sb()
    .from('research_surveys')
    .insert(row)
    .select()
    .single();

  if (error) {
    if (error.code === '23505') throw new Error(`Slug "${slug}" já está em uso`);
    logError(fn, error);
    throw new Error('Erro ao criar pesquisa');
  }

  log(fn, `Pesquisa criada: ${survey.id}`, { slug });
  return survey;
}

async function updateSurvey(surveyId, updates) {
  const fn = 'updateSurvey';

  const allowed = ['title', 'slug', 'description', 'eyebrow', 'target_audience', 'form_definition'];
  const patch = { updated_at: new Date().toISOString() };
  for (const key of allowed) {
    if (updates[key] !== undefined) {
      patch[key] = key === 'slug' ? updates[key].toLowerCase().trim() : updates[key];
    }
  }

  const { data: survey, error } = await sb()
    .from('research_surveys')
    .update(patch)
    .eq('id', surveyId)
    .select()
    .single();

  if (error) {
    if (error.code === '23505') throw new Error(`Slug "${updates.slug}" já está em uso`);
    logError(fn, error);
    throw new Error('Erro ao atualizar pesquisa');
  }

  if (!survey) throw new Error('Pesquisa não encontrada');
  log(fn, `Pesquisa atualizada: ${surveyId}`);
  return survey;
}

async function publishSurvey(surveyId) {
  const fn = 'publishSurvey';

  const { data: survey, error: fetchErr } = await sb()
    .from('research_surveys')
    .select('id, status, form_definition')
    .eq('id', surveyId)
    .single();

  if (fetchErr || !survey) throw new Error('Pesquisa não encontrada');
  if (survey.status !== 'draft' && survey.status !== 'paused') {
    throw new Error(`Pesquisa não pode ser publicada (status: ${survey.status})`);
  }

  // Validate form has at least one step with one question
  const questions = _allQuestions(survey.form_definition);
  if (questions.length === 0) {
    throw new Error('Pesquisa precisa de ao menos uma pergunta para ser publicada');
  }

  const { data: updated, error } = await sb()
    .from('research_surveys')
    .update({ status: 'active', updated_at: new Date().toISOString() })
    .eq('id', surveyId)
    .select()
    .single();

  if (error) { logError(fn, error); throw new Error('Erro ao publicar pesquisa'); }
  log(fn, `Pesquisa publicada: ${surveyId}`);
  return updated;
}

async function pauseSurvey(surveyId) {
  const fn = 'pauseSurvey';

  const { data: survey, error } = await sb()
    .from('research_surveys')
    .update({ status: 'paused', updated_at: new Date().toISOString() })
    .eq('id', surveyId)
    .eq('status', 'active')
    .select()
    .single();

  if (error || !survey) throw new Error('Pesquisa não encontrada ou não está ativa');
  log(fn, `Pesquisa pausada: ${surveyId}`);
  return survey;
}

async function closeSurvey(surveyId) {
  const fn = 'closeSurvey';

  const { data: survey, error } = await sb()
    .from('research_surveys')
    .update({ status: 'closed', closed_at: new Date().toISOString(), updated_at: new Date().toISOString() })
    .eq('id', surveyId)
    .select()
    .single();

  if (error || !survey) throw new Error('Pesquisa não encontrada');
  log(fn, `Pesquisa fechada: ${surveyId}`);
  return survey;
}

async function deleteSurvey(surveyId) {
  const fn = 'deleteSurvey';

  // Check status — hard delete only drafts, close otherwise
  const { data: survey, error: fetchErr } = await sb()
    .from('research_surveys')
    .select('id, status')
    .eq('id', surveyId)
    .single();

  if (fetchErr || !survey) throw new Error('Pesquisa não encontrada');

  if (survey.status === 'draft') {
    const { error } = await sb()
      .from('research_surveys')
      .delete()
      .eq('id', surveyId);
    if (error) { logError(fn, error); throw new Error('Erro ao deletar pesquisa'); }
    log(fn, `Pesquisa deletada (draft): ${surveyId}`);
    return { deleted: true };
  }

  // Not draft — close instead
  return closeSurvey(surveyId);
}

async function listSurveys({ status, page = 1, limit = 20 } = {}) {
  const offset = (page - 1) * limit;

  let query = sb()
    .from('research_surveys')
    .select('id, slug, title, description, eyebrow, status, target_audience, response_count, created_at, updated_at, closed_at', { count: 'exact' })
    .order('created_at', { ascending: false })
    .range(offset, offset + limit - 1);

  if (status) {
    query = query.eq('status', status);
  }

  const { data, error, count } = await query;
  if (error) throw new Error('Erro ao listar pesquisas');

  return { surveys: data || [], total: count || 0, page, limit };
}

async function getSurvey(surveyId) {
  const { data, error } = await sb()
    .from('research_surveys')
    .select('*')
    .eq('id', surveyId)
    .single();

  if (error || !data) throw new Error('Pesquisa não encontrada');
  return data;
}

// ── Public ──────────────────────────────────────────────────

async function getPublicSurvey(slug) {
  const { data, error } = await sb()
    .from('research_surveys')
    .select('id, slug, title, description, eyebrow, form_definition')
    .eq('slug', slug)
    .eq('status', 'active')
    .single();

  if (error || !data) throw new Error('Pesquisa não encontrada ou indisponível');
  return data;
}

async function submitResponse(slug, { answers, userId, metadata }) {
  const fn = 'submitResponse';

  // Fetch survey
  const { data: survey, error: fetchErr } = await sb()
    .from('research_surveys')
    .select('id, form_definition, status')
    .eq('slug', slug)
    .single();

  if (fetchErr || !survey) throw new Error('Pesquisa não encontrada');
  if (survey.status !== 'active') throw new Error('Esta pesquisa não está recebendo respostas');

  // Validate answers
  const validation = _validateAnswers(survey.form_definition, answers || {});
  if (!validation.valid) {
    const err = new Error(validation.errors.join('; '));
    err.code = 'VALIDATION_ERROR';
    err.details = validation.errors;
    throw err;
  }

  // Insert response
  const row = {
    survey_id: survey.id,
    user_id: userId || null,
    answers: answers || {},
    metadata: metadata || {},
  };

  const { data: response, error } = await sb()
    .from('research_responses')
    .insert(row)
    .select('id, created_at')
    .single();

  if (error) {
    logError(fn, error);
    throw new Error('Erro ao salvar resposta');
  }

  log(fn, `Resposta salva: ${response.id}`, { surveyId: survey.id, slug });
  return response;
}

// ── Responses (Admin) ───────────────────────────────────────

async function listResponses(surveyId, { page = 1, limit = 50 } = {}) {
  const offset = (page - 1) * limit;

  const { data, error, count } = await sb()
    .from('research_responses')
    .select('id, user_id, answers, metadata, created_at', { count: 'exact' })
    .eq('survey_id', surveyId)
    .order('created_at', { ascending: false })
    .range(offset, offset + limit - 1);

  if (error) throw new Error('Erro ao listar respostas');

  return { responses: data || [], total: count || 0, page, limit };
}

async function getResponseStats(surveyId) {
  const fn = 'getResponseStats';

  // Fetch survey definition + all responses
  const { data: survey, error: sErr } = await sb()
    .from('research_surveys')
    .select('form_definition, response_count')
    .eq('id', surveyId)
    .single();

  if (sErr || !survey) throw new Error('Pesquisa não encontrada');

  const { data: responses, error: rErr } = await sb()
    .from('research_responses')
    .select('answers')
    .eq('survey_id', surveyId);

  if (rErr) throw new Error('Erro ao buscar respostas');

  const questions = _allQuestions(survey.form_definition);
  const stats = {};

  for (const q of questions) {
    const stat = { id: q.id, label: q.label, type: q.type, total: 0 };

    const values = (responses || [])
      .map(r => r.answers[q.id])
      .filter(v => v !== undefined && v !== null && v !== '');

    stat.total = values.length;

    if (q.type === 'radio') {
      const counts = {};
      for (const v of values) { counts[v] = (counts[v] || 0) + 1; }
      stat.options = (q.options || []).map(opt => ({
        label: opt,
        count: counts[opt] || 0,
        percent: stat.total > 0 ? Math.round((counts[opt] || 0) / stat.total * 100) : 0,
      }));
    } else if (q.type === 'checkbox') {
      const counts = {};
      for (const arr of values) {
        if (Array.isArray(arr)) {
          for (const v of arr) { counts[v] = (counts[v] || 0) + 1; }
        }
      }
      stat.options = (q.options || []).map(opt => ({
        label: opt,
        count: counts[opt] || 0,
        percent: stat.total > 0 ? Math.round((counts[opt] || 0) / stat.total * 100) : 0,
      }));
    } else if (q.type === 'number') {
      const nums = values.map(Number).filter(n => !isNaN(n));
      if (nums.length > 0) {
        stat.mean = Math.round(nums.reduce((a, b) => a + b, 0) / nums.length * 10) / 10;
        stat.min = Math.min(...nums);
        stat.max = Math.max(...nums);
        const sorted = nums.slice().sort((a, b) => a - b);
        stat.median = sorted.length % 2 === 0
          ? (sorted[sorted.length / 2 - 1] + sorted[sorted.length / 2]) / 2
          : sorted[Math.floor(sorted.length / 2)];
      }
    } else if (q.type === 'consent') {
      const yes = values.filter(v => v === true || v === 'true' || v === 'sim').length;
      stat.accepted = yes;
      stat.declined = stat.total - yes;
    }
    // text, email, tel → no aggregation, just total count

    stats[q.id] = stat;
  }

  return {
    survey_id: surveyId,
    response_count: survey.response_count,
    stats,
  };
}

async function exportResponsesCsv(surveyId) {
  const fn = 'exportResponsesCsv';

  const { data: survey, error: sErr } = await sb()
    .from('research_surveys')
    .select('title, form_definition')
    .eq('id', surveyId)
    .single();

  if (sErr || !survey) throw new Error('Pesquisa não encontrada');

  const { data: responses, error: rErr } = await sb()
    .from('research_responses')
    .select('id, user_id, answers, metadata, created_at')
    .eq('survey_id', surveyId)
    .order('created_at', { ascending: true });

  if (rErr) throw new Error('Erro ao buscar respostas');

  const questions = _allQuestions(survey.form_definition);
  const headers = ['response_id', 'user_id', 'created_at', ...questions.map(q => q.id)];

  const escCsv = (val) => {
    if (val === null || val === undefined) return '';
    const s = Array.isArray(val) ? val.join('; ') : String(val);
    if (s.includes(',') || s.includes('"') || s.includes('\n')) {
      return `"${s.replace(/"/g, '""')}"`;
    }
    return s;
  };

  const rows = [headers.join(',')];
  for (const r of (responses || [])) {
    const cols = [
      r.id,
      r.user_id || '',
      r.created_at,
      ...questions.map(q => escCsv(r.answers[q.id])),
    ];
    rows.push(cols.join(','));
  }

  return rows.join('\n');
}

// ── Exports ─────────────────────────────────────────────────

module.exports = {
  createSurvey,
  updateSurvey,
  publishSurvey,
  pauseSurvey,
  closeSurvey,
  deleteSurvey,
  listSurveys,
  getSurvey,
  getPublicSurvey,
  submitResponse,
  listResponses,
  getResponseStats,
  exportResponsesCsv,
};
