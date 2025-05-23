// config/encryption.js

/**
 * Configurações para o serviço de criptografia
 */
module.exports = {
    /**
     * Algoritmo utilizado para criptografia
     */
    algorithm: 'aes-256-gcm',
    
    /**
     * Política de retenção de chaves
     */
    keyRetention: {
      // Número de dias para manter chaves antigas ativas (para descriptografia)
      daysToKeepOldKeys: 90,
      
      // Versões específicas a manter independentemente da idade
      keepVersions: process.env.ENCRYPTION_KEEP_VERSIONS 
        ? process.env.ENCRYPTION_KEEP_VERSIONS.split(',')
        : [],
        
      // Limitar quantidade total de versões em cache
      maxCachedVersions: 5
    },
    
    /**
     * Configurações para rotação de chaves
     */
    keyRotation: {
      // Se verdadeiro, avisar quando a chave está próxima da data de expiração
      enableExpirationWarning: true,
      
      // Número de dias antes da expiração para começar a avisar
      daysBeforeExpirationWarning: 15,
      
      // Período de rotação recomendado (em dias)
      recommendedRotationPeriodDays: 90
    },
    
    /**
     * Configurações para auditoria
     */
    audit: {
      // Se verdadeiro, registrar todas as operações de criptografia
      logAllOperations: process.env.NODE_ENV === 'production',
      
      // Se verdadeiro, registrar apenas falhas
      logOnlyFailures: process.env.NODE_ENV !== 'production',
      
      // Onde armazenar registros de auditoria
      logStorage: 'combined' // 'combined', 'separate', 'database'
    }
  };