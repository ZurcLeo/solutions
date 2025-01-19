// src/validators/paymentValidator.js

const { logger } = require('../logger');

/**
 * Validates a payment request ensuring all required fields are present and valid
 * @param {number} amount - The payment amount
 * @param {string} description - Payment description
 * @param {Object} options - Optional additional validation parameters
 * @returns {string|null} Returns error message if validation fails, null if successful
 */
const validatePaymentRequest = (amount, description, options = {}) => {
  try {
    // Amount validation
    if (!amount && amount !== 0) {
      return 'Payment amount is required';
    }

    // Convert amount to number if it's a string
    const numericAmount = Number(amount);

    if (isNaN(numericAmount)) {
      return 'Payment amount must be a valid number';
    }

    if (numericAmount <= 0) {
      return 'Payment amount must be greater than zero';
    }

    // Check for reasonable maximum amount (e.g., R$50,000)
    const MAX_AMOUNT = 50000;
    if (numericAmount > MAX_AMOUNT) {
      return `Payment amount cannot exceed R$${MAX_AMOUNT}`;
    }

    // Ensure amount has at most 2 decimal places
    if (!Number.isInteger(numericAmount * 100)) {
      return 'Payment amount cannot have more than 2 decimal places';
    }

    // Description validation
    if (!description) {
      return 'Payment description is required';
    }

    if (typeof description !== 'string') {
      return 'Payment description must be a string';
    }

    // Trim description and check length
    const trimmedDescription = description.trim();
    if (trimmedDescription.length < 3) {
      return 'Payment description must be at least 3 characters long';
    }

    if (trimmedDescription.length > 255) {
      return 'Payment description cannot exceed 255 characters';
    }

    // Check for any dangerous or invalid characters in description
    const invalidCharsRegex = /[<>{}]/;
    if (invalidCharsRegex.test(trimmedDescription)) {
      return 'Payment description contains invalid characters';
    }

    // Additional custom validations based on options
    if (options.requireReference && !options.reference) {
      return 'Payment reference is required';
    }

    if (options.validateCurrency) {
      const validCurrencies = ['BRL']; // Add more as needed
      if (!validCurrencies.includes(options.currency)) {
        return 'Invalid currency specified';
      }
    }

    // Log successful validation
    logger.info('Payment request validation successful', {
      service: 'PaymentValidator',
      method: 'validatePaymentRequest',
      amount: numericAmount,
      descriptionLength: trimmedDescription.length
    });

    return null; // Validation successful

  } catch (error) {
    // Log unexpected errors
    logger.error('Error during payment validation', {
      service: 'PaymentValidator',
      method: 'validatePaymentRequest',
      error: error.message,
      stack: error.stack,
      amount,
      description
    });

    return 'An error occurred during payment validation';
  }
};

/**
 * Validates a PIX payment webhook payload
 * @param {Object} payload - The webhook payload
 * @returns {string|null} Returns error message if validation fails, null if successful
 */
const validateWebhookPayload = (payload) => {
  try {
    if (!payload || typeof payload !== 'object') {
      return 'Invalid webhook payload';
    }

    const requiredFields = ['action', 'data'];
    for (const field of requiredFields) {
      if (!(field in payload)) {
        return `Missing required field: ${field}`;
      }
    }

    const validActions = ['payment.created', 'payment.updated'];
    if (!validActions.includes(payload.action)) {
      return 'Invalid webhook action';
    }

    if (!payload.data.id) {
      return 'Missing payment ID in webhook data';
    }

    return null; // Validation successful

  } catch (error) {
    logger.error('Error validating webhook payload', {
      service: 'PaymentValidator',
      method: 'validateWebhookPayload',
      error: error.message,
      payload
    });

    return 'Error validating webhook payload';
  }
};

/**
 * Sanitizes payment data for safe storage and processing
 * @param {Object} data - The payment data to sanitize
 * @returns {Object} Sanitized payment data
 */
const sanitizePaymentData = (data) => {
  const sanitized = {};

  // Sanitize amount
  if ('amount' in data) {
    sanitized.amount = Number(Number(data.amount).toFixed(2));
  }

  // Sanitize description
  if ('description' in data) {
    sanitized.description = data.description
      .trim()
      .replace(/[<>{}]/g, '') // Remove invalid chars
      .substring(0, 255); // Enforce max length
  }

  // Sanitize reference (if present)
  if ('reference' in data) {
    sanitized.reference = data.reference
      .trim()
      .replace(/[^a-zA-Z0-9-_]/g, '') // Allow only alphanumeric, dash, and underscore
      .substring(0, 50); // Reasonable max length for reference
  }

  return sanitized;
};

module.exports = {
  validatePaymentRequest,
  validateWebhookPayload,
  sanitizePaymentData
};