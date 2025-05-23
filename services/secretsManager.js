// services/secretsManager.js (adaptado para Render)

const crypto = require('crypto');
const { logger } = require('../logger');

class RenderSecretsManager {
  constructor() {
    this.secretsCache = new Map();
    this.masterKeyName = 'MASTER_ENCRYPTION_KEY';
    
    // A chave mestra é usada para criptografar localmente outras chaves
    if (!process.env[this.masterKeyName]) {
      logger.warn('Chave mestra não definida, usando configuração menos segura', {
        service: 'secretsManager'
      });
    }
  }

  /**
   * Obtém um segredo, possivelmente desencriptando-o primeiro
   * @param {string} secretName - Nome do segredo
   * @returns {string} Valor do segredo
   */

  async initialize() {
    // Verificar chave mestra
    if (!process.env[this.masterKeyName]) {
      logger.warn('Chave mestra não definida, usando modo compatibilidade', {
        service: 'secretsManager',
        function: 'initialize'
      });
      this._compatibilityMode = true;
    } else {
      this._compatibilityMode = false;
      logger.info('Gerenciador de segredos inicializado com chave mestra', {
        service: 'secretsManager',
        function: 'initialize'
      });
    }
    
    return this;
  }
  
  // Adicionar método para verificar modo compatibilidade
  isInCompatibilityMode() {
    return this._compatibilityMode === true;
  }

  async getSecret(secretName) {
    // Verificar cache primeiro
    if (this.secretsCache.has(secretName)) {
      return this.secretsCache.get(secretName);
    }
    
    // Buscar variável de ambiente
    const secretValue = process.env[secretName];
    if (!secretValue) {
      throw new Error(`Segredo '${secretName}' não encontrado nas variáveis de ambiente`);
    }
    
    // Verificar se o valor está criptografado
    if (secretValue.startsWith('ENC:') && process.env[this.masterKeyName]) {
      try {
        // Descriptografar o valor
        const encryptedValue = secretValue.substring(4); // Remover prefixo 'ENC:'
        const parts = encryptedValue.split(':');
        if (parts.length !== 3) {
          throw new Error('Formato inválido de segredo criptografado');
        }
        
        const [iv, authTag, ciphertext] = parts;
        const masterKey = Buffer.from(process.env[this.masterKeyName], 'hex');
        
        const decipher = crypto.createDecipheriv(
          'aes-256-gcm', 
          masterKey, 
          Buffer.from(iv, 'hex')
        );
        
        decipher.setAuthTag(Buffer.from(authTag, 'hex'));
        
        let decrypted = decipher.update(ciphertext, 'hex', 'utf8');
        decrypted += decipher.final('utf8');
        
        // Armazenar em cache
        this.secretsCache.set(secretName, decrypted);
        return decrypted;
      } catch (error) {
        logger.error('Erro ao descriptografar segredo', {
          service: 'secretsManager',
          secretName,
          error: error.message
        });
        throw new Error(`Erro ao processar segredo '${secretName}'`);
      }
    }
    
    // Se não estiver criptografado, usar valor como está
    this.secretsCache.set(secretName, secretValue);
    return secretValue;
  }

  /**
   * Utilitário para pré-criptografar um segredo
   * Usar offline antes de adicionar ao Render
   * @param {string} plainValue - Valor em texto claro
   * @param {string} masterKey - Chave mestra em hex (32 bytes)
   * @returns {string} Valor criptografado para armazenar como variável
   */
  static encryptForEnvironment(plainValue, masterKey) {
    const key = Buffer.from(masterKey, 'hex');
    const iv = crypto.randomBytes(16);
    const cipher = crypto.createCipheriv('aes-256-gcm', key, iv);
    
    let encrypted = cipher.update(plainValue, 'utf8', 'hex');
    encrypted += cipher.final('hex');
    const authTag = cipher.getAuthTag().toString('hex');
    
    // Formato: "ENC:iv:authTag:ciphertext"
    return `ENC:${iv.toString('hex')}:${authTag}:${encrypted}`;
  }
}

// Exportar como singleton
const secretsManager = new RenderSecretsManager();
module.exports = secretsManager;