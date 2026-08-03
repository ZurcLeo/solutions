'use strict';

const Joi = require('joi');
const mlMessagingService = require('../services/mlMessagingService');
const { logger } = require('../logger');

const CTRL = 'mlReplyController';

// ---------------------------------------------------------------------------
// Joi Schemas
// ---------------------------------------------------------------------------

const SCHEMAS = {
    replyQuestion: Joi.object({
        questionId: Joi.number().integer().positive().required(),
        text: Joi.string().max(2000).required(),
    }),
    replyMessage: Joi.object({
        packId: Joi.string().required(),
        text: Joi.string().max(350).required(),
        buyerId: Joi.number().integer().positive().required(),
    }),
};

// ---------------------------------------------------------------------------
// F1: Reply to ML Question
// POST /api/icon/sellers/:sellerId/ml/reply-question
// ---------------------------------------------------------------------------

exports.replyQuestion = async (req, res) => {
    try {
        const sellerId = req.params.sellerId;
        const { error: joiErr, value } = SCHEMAS.replyQuestion.validate(req.body, { abortEarly: true });
        if (joiErr) {
            return res.status(400).json({ error: 'validation_error', message: joiErr.details[0]?.message });
        }

        const result = await mlMessagingService.answerQuestion(sellerId, value.questionId, value.text);

        logger.info(`[${CTRL}] question answered`, { sellerId, questionId: value.questionId });
        return res.json({ success: true, data: { answered: true, detail: result } });
    } catch (err) {
        logger.error(`[${CTRL}] replyQuestion error`, { error: err.message, sellerId: req.params.sellerId });
        return res.status(500).json({ error: 'reply_failed', message: err.message });
    }
};

// ---------------------------------------------------------------------------
// F2: Reply to ML Message
// POST /api/icon/sellers/:sellerId/ml/reply-message
// ---------------------------------------------------------------------------

exports.replyMessage = async (req, res) => {
    try {
        const sellerId = req.params.sellerId;
        const { error: joiErr, value } = SCHEMAS.replyMessage.validate(req.body, { abortEarly: true });
        if (joiErr) {
            return res.status(400).json({ error: 'validation_error', message: joiErr.details[0]?.message });
        }

        const result = await mlMessagingService.sendMessage(sellerId, value.packId, value.text, value.buyerId);

        logger.info(`[${CTRL}] message sent`, { sellerId, packId: value.packId });
        return res.json({ success: true, data: { sent: true, detail: result } });
    } catch (err) {
        logger.error(`[${CTRL}] replyMessage error`, { error: err.message, sellerId: req.params.sellerId });
        return res.status(500).json({ error: 'reply_failed', message: err.message });
    }
};
