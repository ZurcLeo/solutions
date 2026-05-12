const paymentService = require('../../../services/paymentService');
const { MercadoPagoConfig, Payment } = require('mercadopago');

// Mock do SDK do MercadoPago
jest.mock('mercadopago', () => {
  const mockCreate = jest.fn();
  return {
    MercadoPagoConfig: jest.fn(),
    Payment: jest.fn(() => ({
      create: mockCreate
    })),
    _mockCreate: mockCreate // Exportação auxiliar para controle nos testes
  };
});

// Mock do logger para não poluir o console de testes
jest.mock('../../../logger', () => ({
  logger: {
    info: jest.fn(),
    warn: jest.fn(),
    error: jest.fn()
  }
}));

describe('PaymentService', () => {
  const { _mockCreate } = require('mercadopago');

  beforeEach(() => {
    jest.clearAllMocks();
    process.env.MERCADOPAGO_ACCESS_TOKEN = 'test_token';
    // Reinicializa o cliente MP que é feito no constructor do singleton
    paymentService.client = new MercadoPagoConfig({ accessToken: 'test' });
    paymentService.payment = new Payment(paymentService.client);
  });

  describe('createPixPayment', () => {
    const validPayer = {
      email: 'test@example.com',
      identificationNumber: '12345678909',
      identificationType: 'CPF'
    };

    it('deve gerar QR Code com sucesso quando os dados são válidos', async () => {
      const mockResponse = {
        id: '12345',
        status: 'pending',
        date_of_expiration: '2026-05-12T00:00:00.000Z',
        point_of_interaction: {
          transaction_data: {
            qr_code: 'any_qr_code',
            qr_code_base64: 'any_base64',
            ticket_url: 'any_url'
          }
        }
      };

      _mockCreate.mockResolvedValue(mockResponse);

      const result = await paymentService.createPixPayment(100, 'Teste', validPayer);

      expect(result).toEqual({
        id: '12345',
        qr_code: 'any_qr_code',
        qr_code_base64: 'any_base64',
        ticket_url: 'any_url',
        status: 'pending',
        expires_at: '2026-05-12T00:00:00.000Z'
      });
      expect(_mockCreate).toHaveBeenCalled();
    });

    it('deve lançar erro 400 quando o gateway reporta dados inválidos (ex: CPF)', async () => {
      const error400 = new Error('Bad Request');
      error400.status = 400;
      error400.cause = [{ code: 'invalid_identification', message: 'CPF inválido' }];

      _mockCreate.mockRejectedValue(error400);

      await expect(paymentService.createPixPayment(100, 'Teste', validPayer))
        .rejects.toThrow('Bad Request');
    });

    it('deve tratar timeout/gateway offline corretamente', async () => {
      const timeoutError = new Error('Gateway Timeout');
      timeoutError.status = 504;

      _mockCreate.mockRejectedValue(timeoutError);

      await expect(paymentService.createPixPayment(100, 'Teste', validPayer))
        .rejects.toThrow('Gateway Timeout');
    });

    it('deve lançar erro se o token do MercadoPago não estiver configurado', async () => {
      // Simula modo degradado forçando nulidade no singleton
      const originalPayment = paymentService.payment;
      paymentService.payment = null;
      
      await expect(paymentService.createPixPayment(100, 'Teste', validPayer))
        .rejects.toThrow('MERCADOPAGO_ACCESS_TOKEN não está configurado');
      
      // Restaura para os próximos testes
      paymentService.payment = originalPayment;
    });
  });
});
