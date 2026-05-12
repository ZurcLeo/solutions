const crypto = require('crypto');

// 1. Configurar ambiente para testes ANTES do require do service
const keyV1 = '0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef';
const keyV2 = 'fedcba9876543210fedcba9876543210fedcba9876543210fedcba9876543210';

process.env.NODE_ENV = 'development';
process.env.ENCRYPTION_KEY = keyV1;
process.env.ENCRYPTION_KEY_V2 = keyV2;
process.env.ENCRYPTION_KEY_VERSION = '1';

const encryptionService = require('../../../services/encryptionService');

// Mock do logger
jest.mock('../../../logger', () => ({
  logger: {
    info: jest.fn(),
    warn: jest.fn(),
    error: jest.fn()
  }
}));

describe('EncryptionService - Auditoria e Retrocompatibilidade', () => {
  const { logger } = require('../../../logger');
  
  beforeEach(async () => {
    jest.clearAllMocks();
    
    // Resetar estado do singleton para os testes
    encryptionService.keyCache.clear();
    encryptionService.keyVersion = '1';
    encryptionService.algorithm = 'aes-256-gcm';
    
    // Forçar recarga das chaves
    await encryptionService._initialize();
  });

  describe('1. Retrocompatibilidade', () => {
    it('deve descriptografar dados da versão 1 quando a chave atual é a versão 2', async () => {
      // 1. Criptografar com a V1
      const data = { sensitive: 'segredo_v1' };
      const encryptedV1 = await encryptionService.encrypt(data);
      expect(encryptedV1.version).toBe('1');

      // 2. Simular rotação de chave para V2
      await encryptionService.rotateKey('2');
      expect(encryptionService.keyVersion).toBe('2');

      // 3. Tentar descriptografar o dado antigo (V1) com o serviço agora na V2
      const decrypted = await encryptionService.decrypt(encryptedV1);
      expect(decrypted).toEqual(data);
    });

    it('deve permitir re-criptografia (re-keying) de dados antigos para a chave nova', async () => {
      // 1. Dado criptografado com V1
      const data = "PII_DATA_123";
      const encryptedV1 = await encryptionService.encrypt(data);

      // 2. Rotacionar para V2
      await encryptionService.rotateKey('2');

      // 3. Re-criptografar
      const reEncrypted = await encryptionService.reEncrypt(encryptedV1);
      
      expect(reEncrypted.version).toBe('2');
      expect(reEncrypted.encrypted).not.toBe(encryptedV1.encrypted);
      
      // 4. Validar que o conteúdo é o mesmo
      const finalDecrypted = await encryptionService.decrypt(reEncrypted);
      expect(finalDecrypted).toBe(data);
    });
  });

  describe('2. Prevenção de Vazamento de Dados (Logger)', () => {
    it('NUNCA deve incluir o dado original (plaintext) nos logs em caso de erro na criptografia', async () => {
      const sensitiveData = "MINHA_SENHA_ULTRA_SECRETA_123";
      
      // Simular erro forçando a quebra do algoritmo ou chave
      encryptionService.algorithm = 'invalid-alg';
      
      try {
        await encryptionService.encrypt(sensitiveData);
      } catch (e) {
        // Erro esperado
      }

      // Verificar todas as chamadas ao logger.error
      const errorCalls = logger.error.mock.calls;
      errorCalls.forEach(call => {
        const logContent = JSON.stringify(call);
        expect(logContent).not.toContain(sensitiveData);
      });
      
      // Verificar logs de auditoria
      const infoCalls = logger.info.mock.calls;
      infoCalls.forEach(call => {
        const logContent = JSON.stringify(call);
        expect(logContent).not.toContain(sensitiveData);
      });
    });

    it('NUNCA deve incluir o dado descriptografado nos logs em caso de erro na descriptografia', async () => {
      const sensitiveData = "DADO_CONFIDENCIAL_PARA_DECRYPT";
      const encrypted = await encryptionService.encrypt(sensitiveData);
      
      // Simular erro de integridade (tag inválida)
      encrypted.authTag = '00000000000000000000000000000000';
      
      try {
        await encryptionService.decrypt(encrypted);
      } catch (e) {
        // Erro esperado
      }

      // Verificar que o dado sensível não vazou nos logs de erro
      const errorCalls = logger.error.mock.calls;
      errorCalls.forEach(call => {
        const logContent = JSON.stringify(call);
        expect(logContent).not.toContain(sensitiveData);
      });
    });

    it('NUNCA deve vazar a chave de criptografia (Buffer/Hex) nos logs', async () => {
      // Tentar carregar uma chave inexistente para disparar erro
      try {
        await encryptionService._loadKey('999');
      } catch (e) {}

      const allLogs = [
        ...logger.info.mock.calls,
        ...logger.error.mock.calls,
        ...logger.warn.mock.calls
      ];

      allLogs.forEach(call => {
        const logContent = JSON.stringify(call);
        // Verifica se o log contém a string da chave V1 ou V2
        expect(logContent).not.toContain(keyV1);
        expect(logContent).not.toContain(keyV2);
      });
    });
  });
});
