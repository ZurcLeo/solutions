// services/encryptionService.js (atualizado)

const crypto = require('crypto');
const { logger } = require('../logger');
const secretsManager = require('./secretsManager'); // Serviço para gerenciamento de segredos

class EncryptionService {
  constructor() {
    this.algorithm = 'aes-256-gcm';
    this.keyCache = new Map(); // Cache para chaves recuperadas do gerenciador de segredos
    this.keyVersion = process.env.ENCRYPTION_KEY_VERSION || '1';
    
    // Inicialização assíncrona
    this.initialized = this._initialize();
    
    logger.info('Serviço de criptografia inicializando', {
      service: 'encryptionService',
      function: 'constructor',
      algorithm: this.algorithm,
      keyVersion: this.keyVersion
    });
  }

  /**
   * Inicializa o serviço de forma assíncrona
   * @private
   */
  async _initialize() {
    try {
      // Carregar chave principal
      const currentKey = await this._loadKey(this.keyVersion);
      this.keyCache.set(this.keyVersion, currentKey);
      
      // Pré-carregar versões anteriores comumente usadas
      const preloadVersions = ['1', '2', '3'];
      for (const version of preloadVersions) {
        if (version !== this.keyVersion) {
          try {
            const key = await this._loadKey(version);
            this.keyCache.set(version, key);
          } catch (err) {
            // Ignorar se a chave não existir
          }
        }
      }
      
      logger.info('Serviço de criptografia inicializado com sucesso', {
        service: 'encryptionService',
        function: '_initialize',
        keyVersion: this.keyVersion,
        keyCacheSize: this.keyCache.size
      });
      
      return true;
    } catch (error) {
      logger.error('Falha ao inicializar serviço de criptografia', {
        service: 'encryptionService',
        function: '_initialize',
        error: error.message
      });
      
      throw error;
    }
  }

  /**
   * Carrega uma chave específica do gerenciador de segredos
   * @private
   * @param {string} version - Versão da chave
   * @returns {Buffer} Chave em formato Buffer
   */
  async _loadKey(version) {
    // Verificar primeiro no cache
    if (this.keyCache.has(version)) {
      return this.keyCache.get(version);
    }
    
    try {
      // Em produção, usar gerenciador de segredos
      if (process.env.NODE_ENV === 'production') {
        const keyName = `ENCRYPTION_KEY_V${version}`;
        const keyHex = await secretsManager.getSecret(keyName);
        
        if (!keyHex) {
          throw new Error(`Chave '${keyName}' não encontrada no gerenciador de segredos`);
        }
        
        return Buffer.from(keyHex, 'hex');
      } 
      // Em desenvolvimento, usar variáveis de ambiente
      else {
        const keyName = version === '1' ? 'ENCRYPTION_KEY' : `ENCRYPTION_KEY_V${version}`;
        const keyHex = process.env[keyName];
        
        if (!keyHex) {
          throw new Error(`Chave '${keyName}' não encontrada nas variáveis de ambiente`);
        }
        
        return Buffer.from(keyHex, 'hex');
      }
    } catch (error) {
      logger.error('Erro ao carregar chave de criptografia', {
        service: 'encryptionService',
        function: '_loadKey',
        version,
        error: error.message
      });
      
      throw error;
    }
  }

  /**
   * Garante que o serviço esteja inicializado antes de usar
   * @private
   */
  async _ensureInitialized() {
    if (!this.initialized) {
      throw new Error('Serviço de criptografia não inicializado');
    }
    
    await this.initialized;
  }

  /**
   * Criptografa dados sensíveis
   * @param {Object|string} data - Dados a serem criptografados
   * @param {Object} options - Opções adicionais
   * @returns {Object} Dados criptografados com metadados
   */
  async encrypt(data, options = {}) {
    await this._ensureInitialized();
    
    const operationId = crypto.randomUUID();
    const startTime = Date.now();
    
    try {
      // Converter dados para string JSON se for objeto
      const dataString = typeof data === 'object' ? JSON.stringify(data) : String(data);
      
      // Gerar IV aleatório
      const iv = crypto.randomBytes(16);
      
      // Obter chave atual
      const key = this.keyCache.get(this.keyVersion);
      if (!key) {
        throw new Error(`Versão de chave não encontrada: ${this.keyVersion}`);
      }

      // Criar cipher
      const cipher = crypto.createCipheriv(this.algorithm, key, iv);
      
      // AAD para proteção adicional
      if (options.aad) {
        cipher.setAAD(Buffer.from(options.aad));
      }
      
      // Criptografar dados
      let encrypted = cipher.update(dataString, 'utf8', 'hex');
      encrypted += cipher.final('hex');
      
      // Obter tag de autenticação
      const authTag = cipher.getAuthTag().toString('hex');
      
      // Montar resultado final
      const result = {
        version: this.keyVersion,
        iv: iv.toString('hex'),
        encrypted,
        authTag,
        algorithm: this.algorithm,
        createdAt: new Date().toISOString()
      };
      
      // Registrar operação para auditoria
      this._logAuditEvent('encrypt', {
        operationId,
        version: this.keyVersion,
        dataSize: dataString.length,
        duration: Date.now() - startTime,
        dataType: options.dataType || 'unknown'
      });
      
      return result;
    } catch (error) {
      // Registrar falha na auditoria
      this._logAuditEvent('encrypt_failed', {
        operationId,
        error: error.message,
        duration: Date.now() - startTime,
        dataType: options.dataType || 'unknown'
      });
      
      throw new Error('Falha ao criptografar dados sensíveis');
    }
  }

  /**
   * Descriptografa dados
   * @param {Object} encryptedData - Dados criptografados com metadados
   * @param {Object} options - Opções adicionais
   * @returns {Object|string} Dados descriptografados
   */
  async decrypt(encryptedData, options = {}) {
    await this._ensureInitialized();
    
    const operationId = crypto.randomUUID();
    const startTime = Date.now();
    
    try {
      // Verificar se os dados são válidos
      if (!encryptedData || !encryptedData.version || !encryptedData.iv || 
          !encryptedData.encrypted || !encryptedData.authTag) {
        throw new Error('Dados criptografados inválidos ou incompletos');
      }
      
      // Obter chave para a versão
      let key = this.keyCache.get(encryptedData.version);
      
      // Se a chave não estiver no cache, tentar carregá-la
      if (!key) {
        try {
          key = await this._loadKey(encryptedData.version);
          this.keyCache.set(encryptedData.version, key);
        } catch (keyError) {
          throw new Error(`Chave para versão ${encryptedData.version} não disponível: ${keyError.message}`);
        }
      }
      
      // Preparar parâmetros
      const iv = Buffer.from(encryptedData.iv, 'hex');
      const authTag = Buffer.from(encryptedData.authTag, 'hex');
      
      // Criar decipher
      const decipher = crypto.createDecipheriv(
        encryptedData.algorithm || this.algorithm, 
        key, 
        iv
      );
      
      // Configurar tag de autenticação
      decipher.setAuthTag(authTag);
      
      // Configurar AAD se fornecido
      if (options.aad) {
        decipher.setAAD(Buffer.from(options.aad));
      }
      
      // Descriptografar
      let decrypted = decipher.update(encryptedData.encrypted, 'hex', 'utf8');
      decrypted += decipher.final('utf8');
      
      // Registrar operação para auditoria
      this._logAuditEvent('decrypt', {
        operationId,
        version: encryptedData.version,
        dataSize: decrypted.length,
        duration: Date.now() - startTime,
        dataType: options.dataType || 'unknown',
        keyUpgrade: encryptedData.version !== this.keyVersion
      });
      
      // Tentar converter para objeto se for JSON
      try {
        const result = JSON.parse(decrypted);
        return result;
      } catch (e) {
        // Se não for JSON válido, retornar como string
        return decrypted;
      }
    } catch (error) {
      // Registrar falha específica na auditoria
      const errorInfo = {
        operationId,
        version: encryptedData?.version,
        errorType: 'decrypt_failed',
        errorMessage: error.message,
        duration: Date.now() - startTime,
        dataType: options.dataType || 'unknown'
      };
      
      this._logAuditEvent('decrypt_failed', errorInfo);
      
      // Lançar erro específico baseado no tipo de falha
      if (error.message.includes('Chave para versão')) {
        throw new Error('Falha ao descriptografar: chave não disponível');
      } else if (error.message.includes('tag')) {
        throw new Error('Falha ao descriptografar: integridade dos dados comprometida');
      } else {
        throw new Error('Falha ao descriptografar dados: ' + error.message);
      }
    }
  }

  /**
   * Criptografa especificamente dados bancários
   * @param {Object} bankData - Dados bancários a serem criptografados
   * @returns {Object} Dados bancários criptografados
   */
  async encryptBankData(bankData) {
    // Validar dados bancários antes de criptografar
    this._validateBankData(bankData);
    
    // Adicionar AAD específica para dados bancários
    const aad = `bank_data_${bankData.holderDocument}_${Date.now()}`;
    
    // Dados a serem protegidos
    const sensitiveData = {
      bankName: bankData.bankName,
      bankCode: bankData.bankCode,
      accountType: bankData.accountType,
      accountNumber: bankData.accountNumber,
      branchCode: bankData.branchCode,
      holderName: bankData.holderName,
      holderDocument: bankData.holderDocument
    };
    
    // Criptografar dados sensíveis
    const encryptedData = await this.encrypt(sensitiveData, { 
      aad, 
      dataType: 'bank_account'
    });
    
    // Retornar formato para armazenamento
    return {
      encrypted: encryptedData,
      // Manter apenas informações não sensíveis em texto claro
      bankName: bankData.bankName, // Nome do banco pode ser mantido para UI
      lastDigits: bankData.accountNumber.slice(-4), // Últimos 4 dígitos para referência
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString()
    };
  }

  /**
   * Descriptografa dados bancários
   * @param {Object} encryptedBankData - Dados bancários criptografados
   * @returns {Object} Dados bancários descriptografados
   */
  async decryptBankData(encryptedBankData) {
    if (!encryptedBankData || !encryptedBankData.encrypted) {
      throw new Error('Dados bancários inválidos ou não criptografados');
    }
    
    // Descriptografar dados sensíveis
    const decryptedData = await this.decrypt(encryptedBankData.encrypted, {
      dataType: 'bank_account'
    });
    
    // Combinar com metadados em texto claro
    return {
      ...decryptedData,
      lastDigits: encryptedBankData.lastDigits,
      createdAt: encryptedBankData.createdAt,
      updatedAt: encryptedBankData.updatedAt
    };
  }

  /**
   * Valida dados bancários antes da criptografia
   * @private
   * @param {Object} bankData - Dados bancários a serem validados
   */
  _validateBankData(bankData) {
    const requiredFields = [
      'bankName', 'bankCode', 'accountType', 
      'accountNumber', 'branchCode', 'holderName', 'holderDocument'
    ];
    
    const missingFields = requiredFields.filter(field => !bankData[field]);
    
    if (missingFields.length > 0) {
      throw new Error(`Dados bancários inválidos. Campos obrigatórios ausentes: ${missingFields.join(', ')}`);
    }
  }

  /**
   * Registra evento de auditoria
   * @private
   * @param {string} eventType - Tipo de evento (encrypt, decrypt, etc.)
   * @param {Object} eventData - Dados do evento
   */
  _logAuditEvent(eventType, eventData) {
    // Evitar logging de dados sensíveis
    const safeEventData = { ...eventData };
    delete safeEventData.data;
    
    logger.info(`Evento de criptografia: ${eventType}`, {
      service: 'encryptionService',
      function: eventType,
      ...safeEventData,
      timestamp: new Date().toISOString()
    });
    
    // Em sistemas críticos, armazenar logs de auditoria separadamente
    if (['encrypt_failed', 'decrypt_failed', 'key_rotation'].includes(eventType)) {
      // Aqui poderia salvar em um sistema de auditoria mais completo
      // Por exemplo: auditService.record(eventType, safeEventData);
    }
  }

  /**
   * Rotaciona a chave de criptografia para uma nova versão
   * @param {string} newVersion - Nova versão da chave
   * @returns {Object} Informação sobre a chave rotacionada
   */
  async rotateKey(newVersion) {
    await this._ensureInitialized();
    
    const operationId = crypto.randomUUID();
    const oldVersion = this.keyVersion;
    
    try {
      // Verificar se a nova chave existe no gerenciador de segredos
      const newKey = await this._loadKey(newVersion);
      
      // Adicionar ao cache
      this.keyCache.set(newVersion, newKey);
      
      // Atualizar versão atual
      this.keyVersion = newVersion;
      
      // Registrar evento de rotação
      this._logAuditEvent('key_rotation', {
        operationId,
        oldVersion,
        newVersion,
        timestamp: new Date().toISOString()
      });
      
      return {
        success: true,
        oldVersion,
        newVersion,
        timestamp: new Date().toISOString()
      };
    } catch (error) {
      this._logAuditEvent('key_rotation_failed', {
        operationId,
        oldVersion,
        newVersion,
        error: error.message,
        timestamp: new Date().toISOString()
      });
      
      throw new Error(`Falha ao rotacionar chave: ${error.message}`);
    }
  }

  /**
   * Re-criptografa dados com a chave atual
   * @param {Object} encryptedData - Dados já criptografados
   * @param {Object} options - Opções adicionais
   * @returns {Object} Dados re-criptografados com a chave atual
   */
  async reEncrypt(encryptedData, options = {}) {
    // Descriptografar com a chave antiga
    const decryptedData = await this.decrypt(encryptedData, options);
    
    // Criptografar com a chave atual
    return this.encrypt(decryptedData, options);
  }

  /**
   * Limpa as chaves antigas do cache conforme política
   * @param {number} maxAgeInDays - Idade máxima em dias para manter chaves no cache
   */
  cleanOldKeysFromCache(maxAgeInDays = 30) {
    const currentVersion = this.keyVersion;
    let keysRemoved = 0;
    
    // Manter apenas a chave atual e versões específicas configuradas
    for (const [version, _] of this.keyCache.entries()) {
      // Sempre manter a versão atual
      if (version === currentVersion) continue;
      
      // Configuração para versões a serem mantidas
      const keepVersions = process.env.ENCRYPTION_KEEP_VERSIONS
        ? process.env.ENCRYPTION_KEEP_VERSIONS.split(',')
        : [];
        
      if (!keepVersions.includes(version)) {
        this.keyCache.delete(version);
        keysRemoved++;
      }
    }
    
    // Registrar limpeza
    logger.info('Limpeza de chaves antigas do cache', {
      service: 'encryptionService',
      function: 'cleanOldKeysFromCache',
      keysRemoved,
      remainingKeys: this.keyCache.size
    });
  }

  /**
   * Gera uma nova chave de criptografia
   * @returns {string} Nova chave em formato hexadecimal
   */
  generateKey() {
    return crypto.randomBytes(32).toString('hex'); // 256 bits (32 bytes)
  }
}

// Exportar uma instância singleton com inicialização assíncrona
const encryptionService = new EncryptionService();
module.exports = encryptionService;