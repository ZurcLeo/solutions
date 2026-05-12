/**
 * serviceWeights.js
 * Define os pesos de impacto e thresholds de latência para o cálculo do Health Score.
 */
module.exports = {
  categories: {
    CRITICAL_INFRA: {
      label: 'Infraestrutura Crítica',
      weight: 1.0,
      order: 1
    },
    CORE_BUSINESS: {
      label: 'Core do Negócio',
      weight: 0.7,
      order: 2
    },
    THIRD_PARTY: {
      label: 'Soluções de Terceiros',
      weight: 0.4,
      order: 3
    },
    SOCIAL_ENGAGEMENT: {
      label: 'Engajamento e Social',
      weight: 0.2,
      order: 4
    }
  },
  services: {
    // Infra
    database: { category: 'CRITICAL_INFRA', impact: 1.0, latencyThreshold: 1000 },
    api_core: { category: 'CRITICAL_INFRA', impact: 1.0, latencyThreshold: 500 },
    authentication: { category: 'CRITICAL_INFRA', impact: 1.0, latencyThreshold: 800 },
    
    // Core
    caixinha: { category: 'CORE_BUSINESS', impact: 0.8, latencyThreshold: 600 },
    invites: { category: 'CORE_BUSINESS', impact: 0.6, latencyThreshold: 1000 },
    notifications: { category: 'CORE_BUSINESS', impact: 0.5, latencyThreshold: 500 },
    
    // Terceiros
    asaas: { category: 'THIRD_PARTY', impact: 0.9, latencyThreshold: 2000 },
    openai: { category: 'THIRD_PARTY', impact: 0.4, latencyThreshold: 5000 },
    
    // Social
    user: { category: 'SOCIAL_ENGAGEMENT', impact: 0.3, latencyThreshold: 800 },
    connections: { category: 'SOCIAL_ENGAGEMENT', impact: 0.2, latencyThreshold: 1000 },
    posts: { category: 'SOCIAL_ENGAGEMENT', impact: 0.2, latencyThreshold: 1000 },
    messages: { category: 'SOCIAL_ENGAGEMENT', impact: 0.2, latencyThreshold: 600 },
    interests: { category: 'SOCIAL_ENGAGEMENT', impact: 0.1, latencyThreshold: 1000 }
  }
};
