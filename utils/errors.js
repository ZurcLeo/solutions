// src/utils/errors.js
/**
 * Classe base para erros personalizados da aplicação
 * @extends Error
 */
class AppError extends Error {
    /**
     * Cria uma instância de AppError
     * @param {string} message - Mensagem de erro
     * @param {string} code - Código de erro interno da aplicação
     */
    constructor(message, code = 'UNKNOWN_ERROR') {
      super(message);
      this.name = this.constructor.name;
      this.code = code;
      
      // Captura stack trace (funciona bem no Node.js e em navegadores modernos)
      if (Error.captureStackTrace) {
        Error.captureStackTrace(this, this.constructor);
      }
    }
  }
  
  /**
   * Erro HTTP para uso em APIs
   * @extends AppError
   */
  class HttpError extends AppError {
    /**
     * Cria uma instância de HttpError
     * @param {string} message - Mensagem de erro
     * @param {number} statusCode - Código de status HTTP
     * @param {string} code - Código de erro interno da aplicação
     */
    constructor(message, statusCode = 500, code = 'SERVER_ERROR') {
      super(message, code);
      this.statusCode = statusCode;
      
      // Definir código com base no status HTTP se não for fornecido explicitamente
      if (code === 'SERVER_ERROR' && statusCode) {
        this.code = this.getCodeFromStatus(statusCode);
      }
    }
  
    /**
     * Determina um código de erro baseado no código de status HTTP
     * @param {number} statusCode - Código de status HTTP
     * @returns {string} Código de erro interno
     * @private
     */
    getCodeFromStatus(statusCode) {
      const statusMap = {
        400: 'BAD_REQUEST',
        401: 'UNAUTHORIZED',
        403: 'FORBIDDEN',
        404: 'NOT_FOUND',
        409: 'CONFLICT',
        422: 'VALIDATION_ERROR',
        429: 'TOO_MANY_REQUESTS',
        500: 'SERVER_ERROR',
        503: 'SERVICE_UNAVAILABLE'
      };
  
      return statusMap[statusCode] || 'SERVER_ERROR';
    }
  }
  
  /**
   * Erro de validação para entradas inválidas
   * @extends HttpError
   */
  class ValidationError extends HttpError {
    /**
     * Cria uma instância de ValidationError
     * @param {string} message - Mensagem de erro
     * @param {Object} errors - Detalhes dos erros de validação
     */
    constructor(message, errors = {}) {
      super(message, 422, 'VALIDATION_ERROR');
      this.errors = errors;
    }
  }
  
  /**
   * Erro de autenticação
   * @extends HttpError
   */
  class AuthenticationError extends HttpError {
    /**
     * Cria uma instância de AuthenticationError
     * @param {string} message - Mensagem de erro
     */
    constructor(message = 'Não autenticado') {
      super(message, 401, 'UNAUTHORIZED');
    }
  }
  
  /**
   * Erro de autorização (sem permissão)
   * @extends HttpError
   */
  class ForbiddenError extends HttpError {
    /**
     * Cria uma instância de ForbiddenError
     * @param {string} message - Mensagem de erro
     */
    constructor(message = 'Acesso negado') {
      super(message, 403, 'FORBIDDEN');
    }
  }
  
  /**
   * Erro para quando um recurso não é encontrado
   * @extends HttpError
   */
  class NotFoundError extends HttpError {
    /**
     * Cria uma instância de NotFoundError
     * @param {string} resource - Nome do recurso não encontrado
     * @param {string} id - Identificador do recurso
     */
    constructor(resource = 'Recurso', id = '') {
      const message = id 
        ? `${resource} com ID ${id} não encontrado` 
        : `${resource} não encontrado`;
      super(message, 404, 'NOT_FOUND');
      this.resource = resource;
      this.id = id;
    }
  }
  
  /**
   * Erro para quando ocorre um conflito (ex: duplicação)
   * @extends HttpError
   */
  class ConflictError extends HttpError {
    /**
     * Cria uma instância de ConflictError
     * @param {string} message - Mensagem de erro
     */
    constructor(message = 'Conflito de dados') {
      super(message, 409, 'CONFLICT');
    }
  }
  
  /**
   * Erro para quando o cliente atinge limites de requisição
   * @extends HttpError
   */
  class RateLimitError extends HttpError {
    /**
     * Cria uma instância de RateLimitError
     * @param {string} message - Mensagem de erro
     * @param {number} retryAfter - Tempo em segundos para tentar novamente
     */
    constructor(message = 'Limite de requisições excedido', retryAfter = 60) {
      super(message, 429, 'RATE_LIMIT_EXCEEDED');
      this.retryAfter = retryAfter;
    }
  }
  
  /**
   * Erro para quando ocorre um erro de serviço dependente
   * @extends HttpError
   */
  class ServiceError extends HttpError {
    /**
     * Cria uma instância de ServiceError
     * @param {string} service - Nome do serviço
     * @param {string} message - Mensagem de erro
     * @param {Error} originalError - Erro original
     */
    constructor(service, message = 'Erro no serviço', originalError = null) {
      super(`${message}: ${service}`, 503, 'SERVICE_UNAVAILABLE');
      this.service = service;
      this.originalError = originalError;
    }
  }
  
  /**
   * Middleware para tratamento de erros em Express
   * @param {Function} fn - Função de controlador
   * @returns {Function} Middleware de tratamento de erros
   */
  const asyncHandler = (fn) => (req, res, next) => {
    Promise.resolve(fn(req, res, next)).catch(next);
  };
  
  module.exports = {
    AppError,
    HttpError,
    ValidationError,
    AuthenticationError,
    ForbiddenError,
    NotFoundError,
    ConflictError,
    RateLimitError,
    ServiceError,
    asyncHandler
  };