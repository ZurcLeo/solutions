/**
 * @fileoverview Serviço de consulta direta à Receita Federal — situação cadastral CNPJ.
 * @module services/cnpjVerificationService
 *
 * Substitui a dependência do InfoSimples para o fluxo de CNPJ.
 * Acessa diretamente o portal público da Receita Federal via scraping HTTP.
 * Zero Puppeteer, zero browser headless — sem CAPTCHA na consulta pública.
 *
 * Fluxo ASP.NET WebForms (duas requisições obrigatórias):
 *   1. GET → captura __VIEWSTATE + __EVENTVALIDATION + cookies de sessão
 *   2. POST → envia CNPJ + campos ocultos capturados
 *             → HTML com situação cadastral + razão social
 *      cheerio.load(html) → extrai situação + nome (se disponível)
 *
 * LGPD:
 *   - CNPJ NUNCA é logado em plaintext — usar cnpjMask em todos os logger.*
 *   - Razão social NÃO é persistida (dados públicos, mas não necessários para auditoria)
 *
 * Contrato de saída:
 *   {
 *     status: "ATIVA" | "INAPTA" | "SUSPENSA" | "BAIXADA" | "NULA" | "ERROR",
 *     companyName: string | null,  // razão social — bônus, não bloqueante
 *     verified_at: string,         // ISO 8601
 *     source: "receita-federal-direct",
 *     errorType?: string           // apenas quando status === "ERROR"
 *   }
 */

const axios   = require('axios');
const cheerio = require('cheerio');
const { CookieJar }              = require('tough-cookie');
const { wrapper: cookieWrapper } = require('axios-cookiejar-support');
const maskCNPJ   = require('../utils/cnpjMask');
const { logger } = require('../logger');

// ─────────────────────────────────────────────────────────────
// Constantes
// ─────────────────────────────────────────────────────────────

const RECEITA_URL =
  'https://solucoes.receita.fazenda.gov.br/Servicos/cnpjreva/Cnpjreva_Solicitacao.asp';

const REQUEST_TIMEOUT_MS = 15_000; // 15s

const SERVICE = 'cnpjVerificationService';

// Mapa de normalização: texto bruto Receita → enum do contrato
const SITUACAO_MAP = {
  'ATIVA':     'ATIVA',
  'INAPTA':    'INAPTA',
  'SUSPENSA':  'SUSPENSA',
  'BAIXADA':   'BAIXADA',
  'NULA':      'NULA',
  'ATIVO':     'ATIVA',   // variação ortográfica
  'INATIVA':   'INAPTA',  // variação semântica
};

// ─────────────────────────────────────────────────────────────
// Circuit Breaker (em memória — módulo-level)
// Mesmo padrão do cpfVerificationService
// ─────────────────────────────────────────────────────────────

const CB_THRESHOLD = 5;
const CB_OPEN_MS   = 120_000; // 2 minutos
const CB_WINDOW_MS = 60_000;  // janela de 60s

const _cb = {
  state:        'CLOSED',
  failures:     0,
  windowStart:  Date.now(),
  openedAt:     null,
  nextHalfOpen: null,
};

const _cbRecordSuccess = () => {
  if (_cb.state !== 'CLOSED') {
    logger.info(`${SERVICE} circuit-breaker: CLOSED (recuperado)`, { service: SERVICE });
  }
  _cb.state        = 'CLOSED';
  _cb.failures     = 0;
  _cb.windowStart  = Date.now();
  _cb.openedAt     = null;
  _cb.nextHalfOpen = null;
};

const _cbRecordFailure = () => {
  const now = Date.now();
  if (now - _cb.windowStart > CB_WINDOW_MS) {
    _cb.failures    = 0;
    _cb.windowStart = now;
  }
  _cb.failures += 1;
  if (_cb.state === 'HALF_OPEN' || _cb.failures >= CB_THRESHOLD) {
    _cb.state        = 'OPEN';
    _cb.openedAt     = now;
    _cb.nextHalfOpen = now + CB_OPEN_MS;
    logger.warn(`${SERVICE} circuit-breaker: OPEN (${_cb.failures} falhas)`, {
      service: SERVICE, failures: _cb.failures, opensIn_ms: CB_OPEN_MS,
    });
  }
};

const _cbShouldAllow = () => {
  const now = Date.now();
  if (_cb.state === 'CLOSED') return true;
  if (_cb.state === 'OPEN') {
    if (now >= _cb.nextHalfOpen) {
      _cb.state = 'HALF_OPEN';
      logger.info(`${SERVICE} circuit-breaker: HALF_OPEN (testando)`, { service: SERVICE });
      return true;
    }
    return false;
  }
  return true; // HALF_OPEN
};

// ─────────────────────────────────────────────────────────────
// Helpers de parse
// ─────────────────────────────────────────────────────────────

const _normalizeText = (text) =>
  (text || '')
    .trim()
    .toUpperCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '');

const _mapSituacao = (rawText) => {
  const normalized = _normalizeText(rawText).replace(/\s+/g, ' ').trim();
  if (SITUACAO_MAP[normalized]) return SITUACAO_MAP[normalized];
  for (const [key, val] of Object.entries(SITUACAO_MAP)) {
    if (normalized.includes(_normalizeText(key))) return val;
  }
  return null;
};

/**
 * Extrai situação cadastral e razão social do HTML retornado pela Receita.
 *
 * @param {string} html - HTML bruto da resposta POST
 * @returns {{ situation: string|null, companyName: string|null, rawSituacao: string }}
 */
const _parseReceitaHTML = (html) => {
  const $ = cheerio.load(html);

  let situation   = null;
  let companyName = null;
  let rawSituacao = '';

  // ── Estratégia 1: buscar label "Situação Cadastral" em células
  $('td, th, label, span, div, p, b').each((_, el) => {
    const text       = $(el).text().trim();
    const normalized = _normalizeText(text);

    if (normalized.includes('SITUACAO CADASTRAL') || normalized.includes('SITUAÇAO CADASTRAL')) {
      const next = $(el).next();
      if (next.length) {
        rawSituacao = next.text().trim();
        situation   = _mapSituacao(rawSituacao);
      }
      if (!situation) {
        const match = text.match(/situaç[aã]o\s+cadastral[:\s]+(.+)/i);
        if (match) {
          rawSituacao = match[1].trim();
          situation   = _mapSituacao(rawSituacao);
        }
      }
    }

    // Razão Social — label comum no portal CNPJ
    if (
      (normalized === 'RAZAO SOCIAL' || normalized === 'RAZÃO SOCIAL' ||
       normalized.includes('RAZAO SOCIAL:') || normalized.includes('RAZÃO SOCIAL:')) &&
      !companyName
    ) {
      const next = $(el).next();
      if (next.length) {
        const candidate = next.text().trim();
        if (candidate.length > 2 && !/^\d+$/.test(candidate)) {
          companyName = candidate;
        }
      }
    }
  });

  // ── Estratégia 2: regex no body completo
  if (!situation) {
    const bodyText = $('body').text();
    const sitMatch = bodyText.match(/situaç[aã]o\s+cadastral[:\s]*([A-ZÇÃÕÁÉÍÓÚ\s]+)/i);
    if (sitMatch) {
      rawSituacao = sitMatch[1].trim();
      situation   = _mapSituacao(rawSituacao);
    }
    if (!companyName) {
      const nameMatch = bodyText.match(/raz[aã]o\s+social[:\s]+([A-Z0-9ÇÃÕÁÉÍÓÚ\s&./,-]{3,80})/i);
      if (nameMatch) companyName = nameMatch[1].trim();
    }
  }

  // ── Estratégia 3: seletores CSS históricos do portal
  if (!situation) {
    const candidates = ['#lblSituacao', '.situacao', '#situacao', '[id*="situacao" i]'];
    for (const sel of candidates) {
      const el = $(sel).first();
      if (el.length) {
        rawSituacao = el.text().trim();
        situation   = _mapSituacao(rawSituacao);
        if (situation) break;
      }
    }
  }

  return { situation, companyName: companyName || null, rawSituacao };
};

/**
 * Extrai campos hidden do HTML (VIEWSTATE, EVENTVALIDATION, etc.)
 */
const _extractHiddenFields = (html) => {
  const $ = cheerio.load(html);
  const fields = {};
  $('input[type="hidden"]').each((_, el) => {
    const name  = $(el).attr('name');
    const value = $(el).attr('value') || '';
    if (name) fields[name] = value;
  });
  return fields;
};

// ─────────────────────────────────────────────────────────────
// Função principal
// ─────────────────────────────────────────────────────────────

/**
 * Consulta situação cadastral do CNPJ diretamente na Receita Federal.
 *
 * @param {string} cnpjDigits - 14 dígitos do CNPJ, sem pontuação
 * @returns {Promise<{
 *   status: string,
 *   companyName: string|null,
 *   verified_at: string,
 *   source: string,
 *   errorType?: string
 * }>}
 */
const verify = async (cnpjDigits) => {
  const masked  = maskCNPJ(cnpjDigits);
  const startMs = Date.now();

  logger.info(`${SERVICE}.verify: iniciando consulta`, { service: SERVICE, masked });

  // ── Circuit breaker
  if (!_cbShouldAllow()) {
    logger.warn(`${SERVICE}.verify: circuit breaker OPEN — rejeitando sem HTTP`, {
      service: SERVICE, masked,
    });
    return {
      status:      'ERROR',
      companyName: null,
      verified_at: new Date().toISOString(),
      source:      'receita-federal-direct',
      errorType:   'CIRCUIT_OPEN',
    };
  }

  // ── Formatar CNPJ: XX.XXX.XXX/XXXX-XX
  const cnpjFormatted =
    `${cnpjDigits.slice(0,2)}.${cnpjDigits.slice(2,5)}.${cnpjDigits.slice(5,8)}` +
    `/${cnpjDigits.slice(8,12)}-${cnpjDigits.slice(12)}`;

  try {
    const jar    = new CookieJar();
    const client = cookieWrapper(
      axios.create({
        jar,
        withCredentials: true,
        timeout: REQUEST_TIMEOUT_MS,
        headers: {
          'User-Agent':
            'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 ' +
            '(KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
          'Accept':          'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
          'Accept-Language': 'pt-BR,pt;q=0.9',
        },
      })
    );

    // ── Passo 1: GET — captura VIEWSTATE + EVENTVALIDATION + cookies
    logger.debug(`${SERVICE}.verify: GET Receita Federal`, { service: SERVICE, masked });

    const getResponse  = await client.get(RECEITA_URL);
    const hiddenFields = _extractHiddenFields(getResponse.data);

    if (!hiddenFields['__VIEWSTATE']) {
      logger.warn(`${SERVICE}.verify: __VIEWSTATE não encontrado no GET`, {
        service: SERVICE, masked, statusCode: getResponse.status,
      });
      _cbRecordFailure();
      return {
        status:      'ERROR',
        companyName: null,
        verified_at: new Date().toISOString(),
        source:      'receita-federal-direct',
        errorType:   'PARSE_ERROR',
      };
    }

    // ── Passo 2: POST — envia CNPJ + campos ocultos
    const postBody = new URLSearchParams({
      ...hiddenFields,
      cnpj:    cnpjFormatted,
      Enviar:  'Consultar',
    });

    logger.debug(`${SERVICE}.verify: POST Receita Federal`, { service: SERVICE, masked });

    const postResponse = await client.post(RECEITA_URL, postBody.toString(), {
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded',
        'Referer':      RECEITA_URL,
        'Origin':       'https://solucoes.receita.fazenda.gov.br',
      },
    });

    const durationMs = Date.now() - startMs;

    // ── Parse do HTML de resposta
    const { situation, companyName, rawSituacao } = _parseReceitaHTML(postResponse.data);

    // ── Verificar se Receita sinalizou CNPJ inválido
    const bodyText      = (postResponse.data || '').toLowerCase();
    const isInvalidData =
      bodyText.includes('cnpj inválido') ||
      bodyText.includes('cnpj invalido') ||
      bodyText.includes('cnpj não encontrado') ||
      bodyText.includes('dados informados não conferem');

    if (isInvalidData && !situation) {
      logger.info(`${SERVICE}.verify: CNPJ inválido (Receita rejeitou)`, {
        service: SERVICE, masked, durationMs,
      });
      _cbRecordSuccess();
      return {
        status:      'ERROR',
        companyName: null,
        verified_at: new Date().toISOString(),
        source:      'receita-federal-direct',
        errorType:   'INVALID_DATA',
      };
    }

    // ── Situação não reconhecida → PARSE_ERROR
    if (!situation) {
      logger.error(`${SERVICE}.verify: PARSE_ERROR — estrutura HTML inesperada`, {
        service: SERVICE, masked, durationMs, rawSituacao,
        htmlSnippet: (postResponse.data || '').slice(0, 500),
      });
      _cbRecordFailure();
      return {
        status:      'ERROR',
        companyName: null,
        verified_at: new Date().toISOString(),
        source:      'receita-federal-direct',
        errorType:   'PARSE_ERROR',
      };
    }

    // ── Sucesso
    _cbRecordSuccess();

    logger.info(`${SERVICE}.verify: consulta concluída`, {
      service: SERVICE, masked, status: situation, hasName: !!companyName, durationMs,
    });

    return {
      status:      situation,
      companyName: companyName || null,
      verified_at: new Date().toISOString(),
      source:      'receita-federal-direct',
    };

  } catch (err) {
    const durationMs = Date.now() - startMs;
    const isNetwork  = ['ECONNREFUSED', 'ENOTFOUND', 'ECONNRESET', 'ECONNABORTED', 'ERR_NETWORK']
      .includes(err.code) || err.message?.includes('timeout');

    _cbRecordFailure();

    logger.error(`${SERVICE}.verify: erro na consulta HTTP`, {
      service: SERVICE, masked, errorCode: err.code, errorMsg: err.message, durationMs,
    });

    return {
      status:      'ERROR',
      companyName: null,
      verified_at: new Date().toISOString(),
      source:      'receita-federal-direct',
      errorType:   isNetwork ? 'UNAVAILABLE' : 'UNAVAILABLE',
    };
  }
};

// ─────────────────────────────────────────────────────────────
// Exports
// ─────────────────────────────────────────────────────────────

const getCircuitBreakerState = () => ({
  state:        _cb.state,
  failures:     _cb.failures,
  openedAt:     _cb.openedAt,
  nextHalfOpen: _cb.nextHalfOpen,
});

module.exports = {
  verify,
  getCircuitBreakerState,
  // Exposto para testes unitários
  _parseReceitaHTML,
  _mapSituacao,
  _extractHiddenFields,
};
