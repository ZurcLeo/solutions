/**
 * @fileoverview Serviço de criptografia para gerenciar o ciclo de vida de dados sensíveis, incluindo criptografia, descriptografia, rotação de chaves e auditoria.
 * @module services/encryptionService
 * @requires crypto
 * @requires ../logger
 * @requires ./secretsManager
 */
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
   * Inicializa o serviço de forma assíncrona, carregando a chave principal e pré-carregando versões anteriores.
   * @private
   * @async
   * @function _initialize
   * @returns {Promise<boolean>} Retorna `true` se a inicialização for bem-sucedida.
   * @throws {Error} Se houver falha ao carregar as chaves de criptografia.
   * @description Garante que as chaves de criptografia necessárias estejam disponíveis em cache antes que o serviço possa ser utilizado.
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
   * Carrega uma chave de criptografia específica (por versão) do gerenciador de segredos ou das variáveis de ambiente.
   * @private
   * @async
   * @function _loadKey
   * @param {string} version - A versão da chave a ser carregada (ex: '1', '2').
   * @returns {Promise<Buffer>} A chave de criptografia em formato Buffer.
   * @throws {Error} Se a chave não for encontrada ou ocorrer um erro ao carregá-la.
   * @description Primeiramente verifica o cache; se a chave não estiver presente, a recupera de forma segura dependendo do ambiente (`secretsManager` em produção, `process.env` em desenvolvimento).
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
   * Garante que o serviço esteja completamente inicializado antes de permitir operações de criptografia/descriptografia.
   * @private
   * @async
   * @function _ensureInitialized
   * @returns {Promise<void>}
   * @throws {Error} Se o serviço não estiver inicializado.
   * @description Espera pela conclusão do processo de inicialização assíncrono.
   */
  async _ensureInitialized() {
    if (!this.initialized) {
      throw new Error('Serviço de criptografia não inicializado');
    }
    
    await this.initialized;
  }

  /**
   * Criptografa dados sensíveis utilizando o algoritmo `aes-256-gcm` e a chave de criptografia atual.
   * @async
   * @function encrypt
   * @param {Object|string} data - Os dados a serem criptografados. Pode ser um objeto (será serializado para JSON) ou uma string.
   * @param {Object} [options={}] - Opções adicionais para a criptografia.
   * @param {string} [options.aad] - Dados Autenticados Adicionais (Additional Authenticated Data) para proteção extra de integridade.
   * @param {string} [options.dataType='unknown'] - Um rótulo para o tipo de dado que está sendo criptografado, útil para auditoria.
   * @returns {Promise<Object>} Um objeto contendo os dados criptografados, IV, tag de autenticação, versão da chave e algoritmo.
   * @throws {Error} Se houver falha na criptografia (ex: chave não disponível).
   * @description Converte os dados para string, gera um IV (Vetor de Inicialização) aleatório, criptografa, gera uma tag de autenticação e registra um evento de auditoria.
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
   * Descriptografa dados previamente criptografados pelo serviço.
   * @async
   * @function decrypt
   * @param {Object} encryptedData - O objeto contendo os dados criptografados e metadados (`version`, `iv`, `encrypted`, `authTag`).
   * @param {Object} [options={}] - Opções adicionais para a descriptografia.
   * @param {string} [options.aad] - Dados Autenticados Adicionais (deve ser o mesmo usado na criptografia, se aplicável).
   * @param {string} [options.dataType='unknown'] - Rótulo para o tipo de dado, útil para auditoria.
   * @returns {Promise<Object|string>} Os dados descriptografados. Tenta parsear como JSON se for válido, caso contrário retorna como string.
   * @throws {Error} Se os dados criptografados forem inválidos/incompletos, a chave não estiver disponível, ou a integridade dos dados estiver comprometida (falha na autenticação da tag).
   * @description Recupera a chave correta pela versão, descriptografa os dados e valida sua integridade usando a tag de autenticação, registrando um evento de auditoria.
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
   * Criptografa especificamente dados bancários, adicionando metadados e um AAD.
   * @async
   * @function encryptBankData
   * @param {Object} bankData - Os dados bancários a serem criptografados.
   * @param {string} bankData.bankName - Nome do banco.
   * @param {string} bankData.bankCode - Código do banco.
   * @param {string} bankData.accountType - Tipo da conta (ex: 'corrente', 'poupança').
   * @param {string} bankData.accountNumber - Número da conta bancária.
   * @param {string} bankData.branchCode - Código da agência.
   * @param {string} bankData.holderName - Nome do titular da conta.
   * @param {string} bankData.holderDocument - Documento do titular da conta (CPF/CNPJ).
   * @returns {Promise<Object>} Um objeto contendo os dados criptografados e informações não sensíveis para exibição (ex: `lastDigits`).
   * @throws {Error} Se os dados bancários forem inválidos (campos obrigatórios ausentes).
   * @description Valida, estrutura e criptografa dados bancários confidenciais, retornando uma representação segura para armazenamento.
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
   * Descriptografa dados bancários previamente criptografados.
   * @async
   * @function decryptBankData
   * @param {Object} encryptedBankData - O objeto que contém os dados bancários criptografados, incluindo o campo `encrypted`.
   * @returns {Promise<Object>} Os dados bancários descriptografados, combinados com quaisquer metadados em texto claro.
   * @throws {Error} Se os dados bancários forem inválidos ou não estiverem no formato criptografado esperado.
   * @description Descriptografa a parte sensível dos dados bancários e os recombina com as informações não criptografadas.
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
   * Valida a presença dos campos obrigatórios em um objeto de dados bancários.
   * @private
   * @function _validateBankData
   * @param {Object} bankData - Os dados bancários a serem validados.
   * @throws {Error} Se qualquer campo obrigatório estiver ausente.
   * @description Garante a integridade e completude dos dados bancários antes de sua criptografia.
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
   * Registra eventos de auditoria relacionados a operações de criptografia/descriptografia.
   * @private
   * @function _logAuditEvent
   * @param {string} eventType - O tipo de evento (ex: 'encrypt', 'decrypt', 'encrypt_failed', 'decrypt_failed', 'key_rotation').
   * @param {Object} eventData - Dados adicionais relevantes para o evento.
   * @returns {void}
   * @description Utiliza o logger para registrar informações sobre as operações de criptografia e pode, em sistemas críticos, enviar para um serviço de auditoria dedicado.
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
   * Rotaciona a chave de criptografia atual para uma nova versão.
   * @async
   * @function rotateKey
   * @param {string} newVersion - A nova versão da chave para a qual o serviço deve alternar.
   * @returns {Promise<Object>} Um objeto com o status de sucesso, a versão antiga e a nova da chave, e o timestamp da rotação.
   * @throws {Error} Se a nova chave não for encontrada ou ocorrer um erro durante a rotação.
   * @description Carrega a nova chave, a define como a chave ativa do serviço e registra o evento de rotação para auditoria.
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
   * Re-criptografa dados que foram criptografados com uma chave antiga para a chave de criptografia atualmente ativa.
   * @async
   * @function reEncrypt
   * @param {Object} encryptedData - Os dados já criptografados (pode ser com uma chave antiga).
   * @param {Object} [options={}] - Opções adicionais (as mesmas usadas na criptografia e descriptografia).
   * @returns {Promise<Object>} Os dados re-criptografados com a chave atual.
   * @throws {Error} Se houver falha na descriptografia com a chave antiga ou na nova criptografia.
   * @description Descriptografa os dados usando a chave original e, em seguida, os criptografa novamente com a chave mais recente.
   */
  async reEncrypt(encryptedData, options = {}) {
    // Descriptografar com a chave antiga
    const decryptedData = await this.decrypt(encryptedData, options);
    
    // Criptografar com a chave atual
    return this.encrypt(decryptedData, options);
  }

  /**
   * Limpa chaves antigas do cache de chaves, mantendo apenas a chave atual e as versões configuradas para serem mantidas.
   * @function cleanOldKeysFromCache
   * @param {number} [maxAgeInDays=30] - A idade máxima em dias para manter as chaves no cache (atualmente não usado diretamente, mas pode ser um filtro futuro).
   * @returns {void}
   * @description Ajuda a gerenciar o cache de chaves para evitar o acúmulo desnecessário de chaves antigas que não são mais necessárias para descriptografia.
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
   * Gera uma nova chave de criptografia aleatória de 256 bits.
   * @function generateKey
   * @returns {string} Uma nova chave criptográfica em formato hexadecimal.
   * @description Cria uma chave segura que pode ser usada para novas versões de criptografia.
   */
  generateKey() {
    return crypto.randomBytes(32).toString('hex'); // 256 bits (32 bytes)
  }
}

// Exportar uma instância singleton com inicialização assíncrona
const encryptionService = new EncryptionService();
module.exports = encryptionService;