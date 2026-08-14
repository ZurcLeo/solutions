'use strict';

const Joi = require('joi');
const surveyService = require('../services/researchSurveyService');
const { logger } = require('../logger');

const LOG_TAG = 'ResearchSurveyController';

// ── Validation schemas ──────────────────────────────────────

const slugPattern = /^[a-z0-9][a-z0-9-]{1,58}[a-z0-9]$/;

const questionSchema = Joi.object({
  id: Joi.string().max(80).required(),
  type: Joi.string().valid('text', 'number', 'tel', 'email', 'radio', 'checkbox', 'consent').required(),
  label: Joi.string().max(500).required(),
  hint: Joi.string().max(300).allow('', null),
  placeholder: Joi.string().max(200).allow('', null),
  required: Joi.boolean().default(false),
  options: Joi.array().items(Joi.string().max(200)).when('type', {
    is: Joi.valid('radio', 'checkbox'),
    then: Joi.array().min(1).required(),
    otherwise: Joi.forbidden(),
  }),
  validation: Joi.object({
    min: Joi.number(),
    max: Joi.number(),
  }).allow(null),
  show_when: Joi.object({
    question_id: Joi.string().required(),
    equals: Joi.string().required(),
  }).allow(null),
});

const stepSchema = Joi.object({
  order: Joi.number().integer().min(1),
  title: Joi.string().max(200).required(),
  subtitle: Joi.string().max(300).allow('', null),
  questions: Joi.array().items(questionSchema).min(1).required(),
});

const finishVariantSchema = Joi.object({
  condition: Joi.object({
    question_id: Joi.string().required(),
    equals: Joi.string().required(),
  }).required(),
  title: Joi.string().max(200).required(),
  message: Joi.string().max(1000).required(),
});

const finishScreenSchema = Joi.object({
  title: Joi.string().max(200).allow('', null),
  message: Joi.string().max(1000).allow('', null),
  variants: Joi.array().items(finishVariantSchema).default([]),
});

const formDefinitionSchema = Joi.object({
  steps: Joi.array().items(stepSchema).default([]),
  finish_screen: finishScreenSchema.default({}),
});

const createSurveySchema = Joi.object({
  title: Joi.string().min(3).max(200).required(),
  slug: Joi.string().pattern(slugPattern).required().messages({
    'string.pattern.base': 'Slug deve conter apenas letras minúsculas, números e hifens (3-60 caracteres)',
  }),
  description: Joi.string().max(1000).allow('', null),
  eyebrow: Joi.string().max(100).allow('', null),
  target_audience: Joi.string().max(200).allow('', null),
  form_definition: formDefinitionSchema.default({ steps: [], finish_screen: {} }),
});

const updateSurveySchema = Joi.object({
  title: Joi.string().min(3).max(200),
  slug: Joi.string().pattern(slugPattern).messages({
    'string.pattern.base': 'Slug deve conter apenas letras minúsculas, números e hifens (3-60 caracteres)',
  }),
  description: Joi.string().max(1000).allow('', null),
  eyebrow: Joi.string().max(100).allow('', null),
  target_audience: Joi.string().max(200).allow('', null),
  form_definition: formDefinitionSchema,
}).min(1);

const submitResponseSchema = Joi.object({
  answers: Joi.object().required(),
});

const listQuerySchema = Joi.object({
  status: Joi.string().valid('draft', 'active', 'paused', 'closed'),
  page: Joi.number().integer().min(1).default(1),
  limit: Joi.number().integer().min(1).max(100).default(20),
});

// ── Admin handlers ──────────────────────────────────────────

exports.createSurvey = async (req, res) => {
  try {
    const { error, value } = createSurveySchema.validate(req.body, { abortEarly: false });
    if (error) {
      return res.status(400).json({
        success: false,
        message: 'Dados inválidos',
        details: error.details.map(d => d.message),
      });
    }

    const survey = await surveyService.createSurvey(req.user.uid, value);
    res.status(201).json({ success: true, data: survey });
  } catch (err) {
    const status = err.message.includes('já está em uso') ? 409 : 400;
    res.status(status).json({ success: false, message: err.message });
  }
};

exports.updateSurvey = async (req, res) => {
  try {
    const { error, value } = updateSurveySchema.validate(req.body, { abortEarly: false });
    if (error) {
      return res.status(400).json({
        success: false,
        message: 'Dados inválidos',
        details: error.details.map(d => d.message),
      });
    }

    const survey = await surveyService.updateSurvey(req.params.id, value);
    res.json({ success: true, data: survey });
  } catch (err) {
    const status = err.message.includes('não encontrada') ? 404
      : err.message.includes('já está em uso') ? 409 : 400;
    res.status(status).json({ success: false, message: err.message });
  }
};

exports.publishSurvey = async (req, res) => {
  try {
    const survey = await surveyService.publishSurvey(req.params.id);
    res.json({ success: true, data: survey });
  } catch (err) {
    const status = err.message.includes('não encontrada') ? 404 : 400;
    res.status(status).json({ success: false, message: err.message });
  }
};

exports.pauseSurvey = async (req, res) => {
  try {
    const survey = await surveyService.pauseSurvey(req.params.id);
    res.json({ success: true, data: survey });
  } catch (err) {
    const status = err.message.includes('não encontrada') ? 404 : 400;
    res.status(status).json({ success: false, message: err.message });
  }
};

exports.closeSurvey = async (req, res) => {
  try {
    const survey = await surveyService.closeSurvey(req.params.id);
    res.json({ success: true, data: survey });
  } catch (err) {
    const status = err.message.includes('não encontrada') ? 404 : 400;
    res.status(status).json({ success: false, message: err.message });
  }
};

exports.deleteSurvey = async (req, res) => {
  try {
    const result = await surveyService.deleteSurvey(req.params.id);
    res.json({ success: true, data: result });
  } catch (err) {
    const status = err.message.includes('não encontrada') ? 404 : 400;
    res.status(status).json({ success: false, message: err.message });
  }
};

exports.listSurveys = async (req, res) => {
  try {
    const { error, value } = listQuerySchema.validate(req.query);
    if (error) {
      return res.status(400).json({ success: false, message: error.details[0].message });
    }
    const result = await surveyService.listSurveys(value);
    res.json({ success: true, data: result });
  } catch (err) {
    res.status(400).json({ success: false, message: err.message });
  }
};

exports.getSurvey = async (req, res) => {
  try {
    const survey = await surveyService.getSurvey(req.params.id);
    res.json({ success: true, data: survey });
  } catch (err) {
    const status = err.message.includes('não encontrada') ? 404 : 400;
    res.status(status).json({ success: false, message: err.message });
  }
};

exports.listResponses = async (req, res) => {
  try {
    const page = Math.max(1, parseInt(req.query.page) || 1);
    const limit = Math.min(100, Math.max(1, parseInt(req.query.limit) || 50));
    const result = await surveyService.listResponses(req.params.id, { page, limit });
    res.json({ success: true, data: result });
  } catch (err) {
    res.status(400).json({ success: false, message: err.message });
  }
};

exports.getResponseStats = async (req, res) => {
  try {
    const stats = await surveyService.getResponseStats(req.params.id);
    res.json({ success: true, data: stats });
  } catch (err) {
    const status = err.message.includes('não encontrada') ? 404 : 400;
    res.status(status).json({ success: false, message: err.message });
  }
};

exports.exportResponsesCsv = async (req, res) => {
  try {
    const csv = await surveyService.exportResponsesCsv(req.params.id);
    res.setHeader('Content-Type', 'text/csv; charset=utf-8');
    res.setHeader('Content-Disposition', `attachment; filename="survey_${req.params.id}.csv"`);
    res.send(csv);
  } catch (err) {
    const status = err.message.includes('não encontrada') ? 404 : 400;
    res.status(status).json({ success: false, message: err.message });
  }
};

// ── Public handlers ─────────────────────────────────────────

exports.getPublicSurvey = async (req, res) => {
  try {
    const survey = await surveyService.getPublicSurvey(req.params.slug);
    res.json({ success: true, data: survey });
  } catch (err) {
    const status = err.message.includes('não encontrada') ? 404 : 400;
    res.status(status).json({ success: false, message: err.message });
  }
};

exports.submitResponse = async (req, res) => {
  try {
    const { error, value } = submitResponseSchema.validate(req.body, { abortEarly: false });
    if (error) {
      return res.status(400).json({
        success: false,
        message: 'Dados inválidos',
        details: error.details.map(d => d.message),
      });
    }

    // Optional user_id from auth (if logged in)
    const userId = req.user?.uid || null;

    // IP hash for spam detection
    const ip = req.headers['x-forwarded-for']?.split(',')[0]?.trim() || req.ip;
    const ipHash = ip ? require('crypto').createHash('sha256').update(ip).digest('hex').slice(0, 16) : null;

    const metadata = {
      ip_hash: ipHash,
      user_agent: (req.headers['user-agent'] || '').slice(0, 200),
    };

    const response = await surveyService.submitResponse(req.params.slug, {
      answers: value.answers,
      userId,
      metadata,
    });

    res.status(201).json({ success: true, data: response });
  } catch (err) {
    if (err.code === 'VALIDATION_ERROR') {
      return res.status(400).json({
        success: false,
        message: err.message,
        details: err.details,
        code: 'VALIDATION_ERROR',
      });
    }
    const status = err.message.includes('não encontrada') ? 404
      : err.message.includes('não está recebendo') ? 403 : 400;
    res.status(status).json({ success: false, message: err.message });
  }
};
