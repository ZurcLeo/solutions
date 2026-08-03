const Joi = require('joi');

// Intervalo de horário: { open: "08:00", close: "18:00" }
const businessHoursInterval = Joi.object({
  open:  Joi.string().pattern(/^\d{2}:\d{2}$/).required(),
  close: Joi.string().pattern(/^\d{2}:\d{2}$/).required(),
});

// Valor por dia: null (fechado) ou array de intervalos
const businessHoursDay = Joi.alternatives().try(
  Joi.array().items(businessHoursInterval).min(1),
  Joi.valid(null),
);

// Objeto completo de business_hours
const businessHoursSchema = Joi.object({
  mon: businessHoursDay.default(null),
  tue: businessHoursDay.default(null),
  wed: businessHoursDay.default(null),
  thu: businessHoursDay.default(null),
  fri: businessHoursDay.default(null),
  sat: businessHoursDay.default(null),
  sun: businessHoursDay.default(null),
}).allow(null);

// [STORE-TYPE-001] Categorias válidas de loja
// 'obra' e 'evento' são subcategorias de 'servicos'/'produtos' — não categorias de loja
const VALID_CATEGORIES = ['alimentacao', 'servicos', 'produtos', 'imoveis', 'outros'];

const sellerSchema = {
  // Schema legado (Firestore) — mantido para compatibilidade com flows antigos
  registration: Joi.object({
    userId: Joi.string().required(),
    type: Joi.string().valid('PF', 'PJ').required(),
    document: Joi.string().required(),
    documentValidated: Joi.boolean().default(false),
    businessName: Joi.string().required(),
    tradingName: Joi.string().required(),
    phone: Joi.string().required(),
    category: Joi.string().valid(...VALID_CATEGORIES).default('outros'),
    businessHours: businessHoursSchema.optional(),
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
    category: Joi.string().valid(...VALID_CATEGORIES),
    businessHours: businessHoursSchema.optional(),
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

  // Schema Supabase — usado pelo marketplaceController/marketplaceService
  supabaseUpdate: Joi.object({
    business_name:        Joi.string(),
    trading_name:         Joi.string(),
    description:          Joi.string().allow('', null),
    category:             Joi.string().valid(...VALID_CATEGORIES),
    business_hours:       businessHoursSchema.optional(),
    address_cep:          Joi.string().allow('', null),
    address_logradouro:   Joi.string().allow('', null),
    address_numero:       Joi.string().allow('', null),
    address_complemento:  Joi.string().allow('', null),
    address_neighborhood: Joi.string().allow('', null),
    address_city:         Joi.string().allow('', null),
    service_radius_km:    Joi.number().integer().min(1).max(200),
    accepts_eloscoins:    Joi.boolean(),
    coins_discount_rate:  Joi.number().min(0).max(1),
    max_coins_per_order:  Joi.number().integer().min(0),
    fulfillment_types:    Joi.array().items(Joi.string()),
    freight_mode:         Joi.string().valid('seller_pays', 'buyer_pays', 'split'),
    freight_split_ratio:  Joi.number().min(0).max(1),
    creci:                Joi.string().allow('', null),
  }),

  commission: Joi.object({
    saleAmount: Joi.number().positive().required(),
    orderId: Joi.string().required(),
    description: Joi.string()
  }),

  // Exporta constantes para uso no service
  VALID_CATEGORIES,
};

module.exports = sellerSchema;
