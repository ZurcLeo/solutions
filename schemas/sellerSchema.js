const Joi = require('joi');

const sellerSchema = {
  registration: Joi.object({
    userId: Joi.string().required(),
    type: Joi.string().valid('PF', 'PJ').required(),
    document: Joi.string().required(),
    documentValidated: Joi.boolean().default(false),
    businessName: Joi.string().required(),
    tradingName: Joi.string().required(),
    phone: Joi.string().required(),
    address: Joi.object({
      street: Joi.string().required(),
      number: Joi.string().required(),
      complement: Joi.string().allow(''),
      neighborhood: Joi.string().required(),
      city: Joi.string().required(),
      state: Joi.string().required(),
      zipCode: Joi.string().required()
    }).required(),
    bankInfo: Joi.object({
      bankName: Joi.string().required(),
      accountType: Joi.string().valid('checking', 'savings').required(),
      accountNumber: Joi.string().required(),
      agency: Joi.string().required(),
      holderName: Joi.string().required(),
      holderDocument: Joi.string().required()
    }).required(),
    status: Joi.string().valid('pending', 'active', 'suspended').default('pending'),
    commissionDue: Joi.number().min(0).default(0),
    lastCommissionPayment: Joi.date().optional(),
    createdAt: Joi.date().default(Date.now),
    updatedAt: Joi.date().default(Date.now)
  }),

  update: Joi.object({
    businessName: Joi.string(),
    tradingName: Joi.string(),
    phone: Joi.string(),
    address: Joi.object({
      street: Joi.string(),
      number: Joi.string(),
      complement: Joi.string().allow(''),
      neighborhood: Joi.string(),
      city: Joi.string(),
      state: Joi.string(),
      zipCode: Joi.string()
    }),
    bankInfo: Joi.object({
      bankName: Joi.string(),
      accountType: Joi.string().valid('checking', 'savings'),
      accountNumber: Joi.string(),
      agency: Joi.string(),
      holderName: Joi.string(),
      holderDocument: Joi.string()
    })
  }),

  commission: Joi.object({
    saleAmount: Joi.number().positive().required(),
    orderId: Joi.string().required(),
    description: Joi.string()
  })
};

module.exports = sellerSchema;