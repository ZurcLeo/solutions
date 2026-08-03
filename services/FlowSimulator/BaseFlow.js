const axios = require('axios');
const { logger } = require('../../logger');

/**
 * Classe base para todos os flows do QA Orchestrator.
 *
 * Cada subclasse implementa run(testUser) e usa this.step() para
 * executar cada etapa, capturando artifacts automaticamente.
 */
class BaseFlow {
  /**
   * @param {string} flowId    - Identificador único do flow (ex: 'auth', 'caixinha')
   * @param {string} layer     - 'api' | 'ui'
   * @param {string} runId     - ID do run de QA pai
   * @param {string} backendUrl - URL base do backend (ex: https://eloscloud-api.fly.dev)
   * @param {string} [qaToken] - Token para chamadas internas de QA
   * @param {Function} [onProgress] - Callback para emissão de eventos (SSE/Socket)
   */
  constructor(flowId, layer, runId, backendUrl, qaToken = '', onProgress = null) {
    this.flowId     = flowId;
    this.layer      = layer;
    this.runId      = runId;
    this.backendUrl = backendUrl || process.env.QA_BACKEND_URL || process.env.REACT_APP_BACKEND_URL || 'http://localhost:9000';
    this.qaToken    = qaToken;
    this.onProgress = onProgress;
    this.steps      = [];
  }

  /**
   * Executa uma etapa do flow com captura completa de artifacts.
   *
   * @param {string}   name  - Nome da etapa (ex: 'check_session')
   * @param {Function} fn    - Async function que executa a etapa.
   *                           Recebe { axios: axiosInstance, url } como argumento.
   * @returns {Promise<StepResult>}
   */
  async step(name, fn) {
    const correlationId = `qa_${this.runId}_${this.flowId}_${name}`;
    const start         = Date.now();

    if (this.onProgress) {
      this.onProgress({ event: 'step_start', data: { flow: this.flowId, step: name } });
    }

    // Axios configurado para capturar request/response como artifacts
    let capturedRequest  = null;
    let capturedResponse = null;
    let capturedStatus   = null;

    const axiosInstance = axios.create({
      baseURL: this.backendUrl,
      timeout: 15000,
      headers: {
        'x-correlation-id': correlationId,
        'x-qa-internal':    'true',
        ...(this.qaToken ? { 'x-qa-token': this.qaToken } : {}),
      },
    });

    // Interceptor de request: captura payload sem expor tokens em logs
    axiosInstance.interceptors.request.use(config => {
      capturedRequest = {
        method:  config.method?.toUpperCase(),
        url:     config.url,
        headers: BaseFlow._sanitizeHeaders(config.headers),
        body:    BaseFlow._safeClone(config.data) || null,
      };
      return config;
    });

    // Interceptor de response: captura response
    axiosInstance.interceptors.response.use(
      response => {
        capturedResponse = BaseFlow._safeClone(BaseFlow._sanitizeResponse(response.data));
        capturedStatus   = response.status;
        return response;
      },
      error => {
        if (error.response) {
          capturedResponse = BaseFlow._safeClone(error.response.data);
          capturedStatus   = error.response.status;
        }
        return Promise.reject(error);
      }
    );

    try {
      const result = await fn({ axios: axiosInstance, baseUrl: this.backendUrl });

      const stepResult = {
        name,
        success:       true,
        duration:      Date.now() - start,
        correlationId,
        artifacts: [{
          type:       'http_trace',
          request:    capturedRequest,
          response:   capturedResponse,
          statusCode: capturedStatus,
        }],
        ...BaseFlow._safeClone(result || {}),
      };

      if (this.onProgress) {
        this.onProgress({ 
          event: 'step_done', 
          data: { flow: this.flowId, step: name, success: true, duration: stepResult.duration } 
        });
      }

      this.steps.push(stepResult);
      return stepResult;

    } catch (err) {
      const stepResult = {
        name,
        success:       false,
        duration:      Date.now() - start,
        correlationId,
        error:         err.response?.data?.message || err.response?.data?.error || err.message,
        errorDetail:   err.response?.data || null,
        artifacts: [{
          type:       'http_trace',
          request:    capturedRequest,
          response:   capturedResponse,
          statusCode: capturedStatus || err.response?.status || null,
        }],
      };

      if (this.onProgress) {
        this.onProgress({ 
          event: 'step_done', 
          data: { flow: this.flowId, step: name, success: false, duration: stepResult.duration, error: stepResult.error } 
        });
      }

      logger.warn(`[QA] Flow "${this.flowId}" step "${name}" falhou`, {
        service:      'QAFlowSimulator',
        flowId:       this.flowId,
        step:         name,
        correlationId,
        error:        stepResult.error,
      });

      this.steps.push(stepResult);
      return stepResult;
    }
  }

  /**
   * Retorna o resultado consolidado do flow.
   */
  result() {
    const passed = this.steps.every(s => s.success);
    const failed = this.steps.filter(s => !s.success);
    return {
      flowId:    this.flowId,
      layer:     this.layer,
      passed,
      steps:     this.steps,
      failedSteps: failed.map(s => s.name),
      totalSteps:  this.steps.length,
      passedSteps: this.steps.filter(s => s.success).length,
    };
  }

  // Remove valores sensíveis dos headers antes de logar
  static _sanitizeHeaders(headers) {
    if (!headers) return {};
    const safe = { ...headers };
    ['authorization', 'cookie', 'x-qa-token'].forEach(h => {
      if (safe[h]) safe[h] = '[REDACTED]';
    });
    return safe;
  }

  // Remove campos sensíveis da response antes de gravar
  static _sanitizeResponse(data) {
    if (!data || typeof data !== 'object') return data;
    const safe = { ...data };
    ['accessToken', 'refreshToken', 'token', 'password'].forEach(k => {
      if (safe[k]) safe[k] = '[REDACTED]';
    });
    return safe;
  }

  /**
   * Clona um objeto removendo referências circulares para evitar erro no JSON.stringify.
   */
  static _safeClone(obj) {
    if (!obj || typeof obj !== 'object') return obj;
    
    const cache = new WeakSet();
    const stringified = JSON.stringify(obj, (key, value) => {
      if (typeof value === 'object' && value !== null) {
        if (cache.has(value)) return '[Circular]';
        cache.add(value);
      }
      return value;
    });
    
    return JSON.parse(stringified);
  }
}

module.exports = BaseFlow;
