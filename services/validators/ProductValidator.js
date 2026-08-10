'use strict';

/**
 * ProductValidator — Strategy Pattern
 *
 * A categoria do vendedor (seller_category / category) DETERMINA o product_type.
 * O cliente NUNCA escolhe o product_type diretamente.
 *
 * Uso:
 *   const { validated, productType } = ProductValidator.validate(payload, sellerCategory);
 */

// Mapeamento categoria → product_type (fonte de verdade)
const CATEGORY_TO_PRODUCT_TYPE = {
  alimentacao:  'food_item',
  servicos:     'service',
  produtos:     'physical_product',
  imoveis:      'property',
  outros:       'physical_product',
};

// Regras por product_type
const TYPE_RULES = {
  food_item: {
    required: ['name', 'price_brl'],
    forbidden: ['weight_kg', 'dimensions_cm', 'sku'],
    optional: [
      'description', 'images', 'menu_category_id',
      'prep_time_min', 'serves', 'allergens',
      'is_available_now', 'max_coins_discount', 'stock',
    ],
    defaults: {
      is_available_now: true,
    },
    validate(data) {
      if (data.prep_time_min != null && (data.prep_time_min < 1 || data.prep_time_min > 600)) {
        throw new Error('prep_time_min deve estar entre 1 e 600 minutos');
      }
      if (data.serves != null && data.serves < 1) {
        throw new Error('serves deve ser pelo menos 1');
      }
    },
  },

  service: {
    required: ['name', 'price_brl'],
    forbidden: ['weight_kg', 'dimensions_cm', 'sku', 'prep_time_min', 'serves', 'allergens', 'stock'],
    optional: [
      'description', 'images', 'duration_minutes',
      'service_mode', 'min_capacity', 'booking_deadline_hours',
      'cancellation_policy', 'max_coins_discount',
    ],
    defaults: {},
    validate(data) {
      if (data.duration_minutes != null) {
        const valid = [15, 30, 45, 60, 90, 120, 180, 240, 480];
        if (!valid.includes(data.duration_minutes)) {
          throw new Error(`duration_minutes deve ser um de: ${valid.join(', ')}`);
        }
      }
    },
  },

  physical_product: {
    required: ['name', 'price_brl', 'weight_kg'],
    forbidden: ['prep_time_min', 'serves', 'allergens', 'duration_minutes'],
    optional: [
      'description', 'images', 'stock', 'menu_category_id',
      'dimensions_cm', 'sku', 'unit_of_measure', 'max_coins_discount',
    ],
    defaults: {
      unit_of_measure: 'un',
    },
    validate(data) {
      if (data.weight_kg != null && data.weight_kg <= 0) {
        throw new Error('weight_kg deve ser maior que zero');
      }
      if (data.dimensions_cm != null) {
        const { length, width, height } = data.dimensions_cm;
        if (!length || !width || !height) {
          throw new Error('dimensions_cm deve ter {length, width, height}');
        }
      }
    },
  },

  property: {
    required: ['name', 'price_brl'],
    forbidden: ['weight_kg', 'sku', 'prep_time_min', 'serves', 'allergens', 'menu_category_id'],
    optional: [
      'description', 'images', 'property_details',
      'property_status', 'listing_type', 'duration_minutes', 'cancellation_policy', 'max_coins_discount',
    ],
    defaults: {
      property_status: 'disponivel',
    },
    validate() {},
  },
};

class ProductValidator {
  /**
   * Valida e sanitiza o payload de produto com base na categoria do vendedor.
   *
   * @param {object} payload - Dados brutos do produto (req.body)
   * @param {string} sellerCategory - Categoria do seller (alimentacao, servicos, produtos, imoveis, outros)
   * @returns {{ validated: object, productType: string }}
   * @throws {Error} Se campos obrigatórios faltam ou campos proibidos estão presentes
   */
  static validate(payload, sellerCategory) {
    const productType = CATEGORY_TO_PRODUCT_TYPE[sellerCategory];
    if (!productType) {
      throw new Error(`Categoria de vendedor inválida: "${sellerCategory}". Valores aceitos: ${Object.keys(CATEGORY_TO_PRODUCT_TYPE).join(', ')}`);
    }

    const rules = TYPE_RULES[productType];
    const validated = { ...payload };

    // Força product_type correto — cliente não define
    validated.product_type = productType;

    // 1. Verifica campos obrigatórios
    for (const field of rules.required) {
      if (validated[field] == null || validated[field] === '') {
        throw new Error(`Campo obrigatório para ${productType}: "${field}"`);
      }
    }

    // 2. Remove campos proibidos silenciosamente (defense in depth — trigger no DB é o último guardião)
    for (const field of rules.forbidden) {
      if (validated[field] != null) {
        delete validated[field];
      }
    }

    // 3. Aplica defaults
    for (const [field, defaultValue] of Object.entries(rules.defaults)) {
      if (validated[field] == null) {
        validated[field] = defaultValue;
      }
    }

    // 4. Validações de negócio específicas do tipo
    rules.validate(validated);

    // 5. Validações comuns a todos os tipos
    if (validated.price_brl != null && Number(validated.price_brl) < 0) {
      throw new Error('price_brl não pode ser negativo');
    }
    if (validated.max_coins_discount != null && Number(validated.max_coins_discount) < 0) {
      throw new Error('max_coins_discount não pode ser negativo');
    }
    if (validated.stock != null && Number(validated.stock) < 0) {
      throw new Error('stock não pode ser negativo');
    }

    return { validated, productType };
  }

  /**
   * Retorna o product_type para uma dada categoria de seller.
   * Útil para filtrar produtos por tipo sem validar o payload completo.
   */
  static productTypeFor(sellerCategory) {
    const pt = CATEGORY_TO_PRODUCT_TYPE[sellerCategory];
    if (!pt) throw new Error(`Categoria desconhecida: ${sellerCategory}`);
    return pt;
  }

  /**
   * Retorna os campos obrigatórios para um product_type.
   * Útil para gerar hints de formulário no frontend.
   */
  static requiredFieldsFor(sellerCategory) {
    const productType = CATEGORY_TO_PRODUCT_TYPE[sellerCategory];
    if (!productType) return [];
    return TYPE_RULES[productType]?.required ?? [];
  }

  /**
   * Retorna as capabilities de um seller_category.
   * Espelha o SELLER_TYPE_CONFIG do frontend para uso no backend.
   */
  static capabilitiesFor(sellerCategory) {
    const CAP = {
      alimentacao: {
        has_modifiers: true, has_prep_time: true, has_delivery_modes: true,
        has_scheduling: false, has_weight: false, has_stock: true,
        has_portfolio: false, has_menu_categories: true,
      },
      servicos: {
        has_modifiers: false, has_prep_time: false, has_delivery_modes: false,
        has_scheduling: true, has_weight: false, has_stock: false,
        has_portfolio: true, has_menu_categories: false,
      },
      produtos: {
        has_modifiers: false, has_prep_time: false, has_delivery_modes: true,
        has_scheduling: false, has_weight: true, has_stock: true,
        has_portfolio: false, has_menu_categories: true,
      },
      imoveis: {
        has_modifiers: false, has_prep_time: false, has_delivery_modes: false,
        has_scheduling: true, has_weight: false, has_stock: false,
        has_portfolio: false, has_menu_categories: false,
      },
      outros: {
        has_modifiers: false, has_prep_time: false, has_delivery_modes: true,
        has_scheduling: false, has_weight: true, has_stock: true,
        has_portfolio: false, has_menu_categories: true,
      },
    };
    return CAP[sellerCategory] ?? CAP['outros'];
  }

  /**
   * Retorna a UNIÃO de capabilities para múltiplas categorias.
   * Usado pelo middleware validateSellerCapability para vendedores multi-categoria.
   *
   * A união governa a superfície de autoria (formulários e abas do vendedor).
   * A renderização de cada listing deriva do product_type do próprio item (TYPE GUARD).
   *
   * @param {string[]} categories - Array de categorias do vendedor
   * @returns {object} Capabilities unificadas (boolean OR de cada cap)
   */
  static mergedCapabilitiesFor(categories) {
    if (!categories || categories.length === 0) {
      return ProductValidator.capabilitiesFor('outros');
    }
    if (categories.length === 1) {
      return ProductValidator.capabilitiesFor(categories[0]);
    }
    return categories.reduce((merged, cat) => {
      const caps = ProductValidator.capabilitiesFor(cat);
      for (const key of Object.keys(caps)) {
        merged[key] = merged[key] || caps[key];
      }
      return merged;
    }, {});
  }
}

module.exports = ProductValidator;
