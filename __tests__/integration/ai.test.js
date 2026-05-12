const AIService = require('../../services/AIService');
const SupportService = require('../../services/SupportService');

// Mock do SupportService
jest.mock('../../services/SupportService', () => ({
  shouldEscalateToHuman: jest.fn(),
  requestEscalation: jest.fn().mockResolvedValue({ id: 'ticket-123' })
}));

// Mock do logger
jest.mock('../../logger', () => ({
  logger: {
    info: jest.fn(),
    error: jest.fn(),
    warn: jest.fn(),
    debug: jest.fn()
  }
}));

describe('AIService Integration Tests', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  describe('Escalation Logic', () => {
    it('should escalate to human support when shouldEscalateToHuman is true', async () => {
      SupportService.shouldEscalateToHuman.mockReturnValue(true);
      
      const response = await AIService.processMessage('user123', 'conv456', 'Eu quero reclamar de um roubo');
      
      expect(SupportService.requestEscalation).toHaveBeenCalledWith('conv456', 'user123');
      expect(response).toContain('transferir sua conversa para nossa equipe de suporte');
    });
  });

  describe('Fallback Responses', () => {
    it('should provide a balance-related fallback response', async () => {
      const userContext = {
        firstName: 'Leo',
        caixinhas: [{ id: 'c1', balance: 150 }]
      };
      
      // Forçamos o fallback chamando o método privado (ou garantindo que openai é null no mock)
      const response = AIService._getFallbackResponse('Qual meu saldo na caixinha?', 'user123', userContext);
      
      expect(response).toContain('R$ 150.00');
      expect(response).toContain('dashboard');
    });

    it('should provide a generic help response', async () => {
      const response = AIService._getFallbackResponse('ajuda', 'user123');
      expect(response).toContain('Central de Ajuda ElosCloud');
      expect(response).toContain('caixinhas');
    });
  });

  describe('Error Handling', () => {
    it('should use fallback when OpenAI is not initialized', async () => {
      // Como o AIService exporta uma instância única e o openai é inicializado no topo do arquivo,
      // se não houver OPENAI_API_KEY no ambiente de teste, ele usará o fallback.
      SupportService.shouldEscalateToHuman.mockReturnValue(false);
      
      const response = await AIService.processMessage('user123', 'conv456', 'oi');
      expect(response).toContain('Olá');
    });
  });
});
