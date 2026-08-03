/**
 * @fileoverview Serviço de consulta direta à Receita Federal — situação cadastral CPF.
 * @module services/cpfVerificationService
 *
 * Substitui a dependência do InfoSimples para o fluxo de CPF (KYC-RF-001).
 * Acessa diretamente o portal público da Receita Federal via scraping HTTP.
 * Zero Puppeteer, zero browser headless — a Receita não tem CAPTCHA na consulta pública.
 *
 * Fluxo ASP.NET WebForms (duas requisições obrigatórias):
 *   1. GET → captura __VIEWSTATE + __EVENTVALIDATION + cookies de sessão
 *   2. POST → envia CPF + nascimento + campos ocultos capturados
 *             → HTML com situação cadastral
 *      cheerio.load(html) → extrai situação + nome (se disponível)
 *
 * LGPD:
 *   - CPF NUNCA é logado em plaintext — usar cpfMask em todos os logger.*
 *   - birthdate NUNCA é logado
 *   - nome raw NUNCA é persistido (apenas booleano name_match em kyc_audit_log)
 *
 * Contrato de saída:
 *   {
 *     status: "REGULAR" | "PENDENTE_DE_REGULARIZACAO" | "CANCELADA" |
 *             "SUSPENSA" | "NULA" | "ERROR",
 *     name: string | null,       // bônus — cross-reference, não bloqueante
 *     verified_at: string,       // ISO 8601
 *     source: "receita-federal-direct",
 *     errorType?: string         // apenas quando status === "ERROR"
 *   }
 */

const axios   = require('axios');
const cheerio = require('cheerio');
const { CookieJar }              = require('tough-cookie');
const { wrapper: cookieWrapper } = require('axios-cookiejar-support');
const maskCPF  = require('../utils/cpfMask');
const { logger } = require('../logger');

// ─────────────────────────────────────────────────────────────
// Constantes
// ─────────────────────────────────────────────────────────────

const RECEITA_URL =
  'https://servicos.receita.fazenda.gov.br/servicos/cpf/consultasituacao/consultapublica.asp';

const REQUEST_TIMEOUT_MS = 15_000; // 15s — Receita pode ser lenta

const SERVICE = 'cpfVerificationService';

// Mapa de normalização: texto bruto Receita → enum do contrato
const SITUACAO_MAP = {
  'REGULAR':                     'REGULAR',
  'PENDENTE DE REGULARIZAÇÃO':   'PENDENTE_DE_REGULARIZACAO',
  'PENDENTE DE REGULARIZACAO':   'PENDENTE_DE_REGULARIZACAO',
  'CANCELADA':                   'CANCELADA',
  'CANCELADA POR ENCERRAMENTO':  'CANCELADA',
  'CANCELADA DE OFÍCIO':         'CANCELADA',
  'SUSPENSA':                    'SUSPENSA',
  'NULA':                        'NULA',
  'INAPTA':                      'SUSPENSA', // tratado como suspensa no MVP
};

// ─────────────────────────────────────────────────────────────
// Circuit Breaker (em memória — módulo-level)
// ─────────────────────────────────────────────────────────────

const CB_THRESHOLD   = 5;    // falhas consecutivas para abrir o circuito
const CB_OPEN_MS     = 120_000; // 2 minutos em estado OPEN
const CB_WINDOW_MS   = 60_000;  // janela de 60s para contar falhas

const _cb = {
  state:         'CLOSED',  // CLOSED | OPEN | HALF_OPEN
  failures:      0,
  windowStart:   Date.now(),
  openedAt:      null,
  nextHalfOpen:  null,
};

const _cbRecordSuccess = () => {
  if (_cb.state !== 'CLOSED') {
    logger.info(`${SERVICE} circuit-breaker: CLOSED (recuperado)`, { service: SERVICE });
  }
  _cb.state       = 'CLOSED';
  _cb.failures    = 0;
  _cb.windowStart = Date.now();
  _cb.openedAt    = null;
  _cb.nextHalfOpen = null;
};

const _cbRecordFailure = () => {
  const now = Date.now();

  // Resetar janela se expirou
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
      service:    SERVICE,
      failures:   _cb.failures,
      opensIn_ms: CB_OPEN_MS,
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
      return true; // deixa passar 1 tentativa
    }
    return false; // ainda OPEN
  }

  // HALF_OPEN → permite a tentativa
  return true;
};

// ─────────────────────────────────────────────────────────────
// Helpers de parse
// ─────────────────────────────────────────────────────────────

/**
 * Normaliza texto extraído do HTML da Receita.
 * Remove acentos inconsistentes, transforma em uppercase e trim.
 */
const _normalizeText = (text) =>
  (text || '')
    .trim()
    .toUpperCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, ''); // remove diacríticos para comparação robusta

/**
 * Mapeia situação normalizada para o enum do contrato.
 * Retorna null se não reconhece (indicará PARSE_ERROR).
 */
const _mapSituacao = (rawText) => {
  const normalized = _normalizeText(rawText)
    .replace(/\s+/g, ' ')
    .trim();

  // Busca exata
  if (SITUACAO_MAP[normalized]) return SITUACAO_MAP[normalized];

  // Busca parcial (mais tolerante a variações do HTML)
  for (const [key, val] of Object.entries(SITUACAO_MAP)) {
    if (normalized.includes(_normalizeText(key))) return val;
  }

  return null;
};

/**
 * Extrai situação cadastral e nome do HTML retornado pela Receita.
 * A página usa tabelas com labels/valores — buscamos pelos padrões conhecidos.
 *
 * @param {string} html - HTML bruto da resposta POST
 * @returns {{ situation: string|null, name: string|null, rawSituacao: string }}
 */
const _parseReceitaHTML = (html) => {
  const $ = cheerio.load(html);

  let situation   = null;
  let name        = null;
  let rawSituacao = '';

  // ── Estratégia 1: buscar por label "Situação Cadastral" em células de tabela
  $('td, th, label, span, div, p').each((_, el) => {
    const text = $(el).text().trim();
    const normalized = _normalizeText(text);

    if (normalized.includes('SITUACAO CADASTRAL') || normalized.includes('SITUAÇAO CADASTRAL')) {
      // O valor geralmente está na próxima célula/elemento irmão
      const next = $(el).next();
      if (next.length) {
        rawSituacao = next.text().trim();
        situation = _mapSituacao(rawSituacao);
      }
      // Ou está no texto do mesmo elemento após dois pontos
      if (!situation) {
        const match = text.match(/situaç[aã]o cadastral[:\s]+(.+)/i);
        if (match) {
          rawSituacao = match[1].trim();
          situation = _mapSituacao(rawSituacao);
        }
      }
    }

    if ((normalized.includes('NOME') || normalized === 'NOME:') && !name) {
      const next = $(el).next();
      if (next.length) {
        const candidate = next.text().trim();
        // Nome geralmente tem mais de 3 chars e não é um número
        if (candidate.length > 3 && !/^\d+$/.test(candidate)) {
          name = candidate;
        }
      }
    }
  });

  // ── Estratégia 2: buscar padrão de texto diretamente no body
  if (!situation) {
    const bodyText = $('body').text();
    const sitMatch = bodyText.match(/situaç[aã]o\s+cadastral[:\s]*([A-ZÇÃÕÁÉÍÓÚ\s]+)/i);
    if (sitMatch) {
      rawSituacao = sitMatch[1].trim();
      situation = _mapSituacao(rawSituacao);
    }

    if (!name) {
      const nameMatch = bodyText.match(/nome[:\s]+([A-ZÇÃÕÁÉÍÓÚ\s]{3,60})/i);
      if (nameMatch) {
        name = nameMatch[1].trim();
      }
    }
  }

  // ── Estratégia 3: buscar em spans/tds com class específica (histórico)
  if (!situation) {
    const candidates = ['#lblSituacao', '.situacao', '#situacao', '[id*="situacao" i]'];
    for (const sel of candidates) {
      const el = $(sel).first();
      if (el.length) {
        rawSituacao = el.text().trim();
        situation = _mapSituacao(rawSituacao);
        if (situation) break;
      }
    }
  }

  return { situation, name: name || null, rawSituacao };
};

/**
 * Extrai campos hidden do HTML da Receita (VIEWSTATE, EVENTVALIDATION, etc.)
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
// Formata data DD/MM/AAAA (formato esperado pela Receita)
// ─────────────────────────────────────────────────────────────

const _formatBirthdate = (birthdate) => {
  // Entrada esperada: "YYYY-MM-DD"
  const match = String(birthdate).match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (!match) return null;
  const [, year, month, day] = match;
  return `${day}/${month}/${year}`;
};

// ─────────────────────────────────────────────────────────────
// Função principal
// ─────────────────────────────────────────────────────────────

/**
 * Consulta situação cadastral do CPF diretamente na Receita Federal.
 *
 * @param {string} cpfDigits  - 11 dígitos do CPF, sem pontuação
 * @param {string} birthdate  - Data de nascimento no formato "YYYY-MM-DD"
 * @returns {Promise<{
 *   status: string,
 *   name: string|null,
 *   verified_at: string,
 *   source: string,
 *   errorType?: string
 * }>}
 */
const verify = async (cpfDigits, birthdate) => {
  const maskedCPF = maskCPF(cpfDigits);
  const startMs   = Date.now();

  logger.info(`${SERVICE}.verify: iniciando consulta`, { service: SERVICE, maskedCPF });

  // ── Circuit breaker check
  if (!_cbShouldAllow()) {
    logger.warn(`${SERVICE}.verify: circuit breaker OPEN — rejeitando sem HTTP`, {
      service: SERVICE,
      maskedCPF,
    });
    return {
      status:      'ERROR',
      name:        null,
      verified_at: new Date().toISOString(),
      source:      'receita-federal-direct',
      errorType:   'CIRCUIT_OPEN',
    };
  }

  // ── Formatar data de nascimento para DD/MM/AAAA
  const birthdateFormatted = _formatBirthdate(birthdate);
  if (!birthdateFormatted) {
    return {
      status:      'ERROR',
      name:        null,
      verified_at: new Date().toISOString(),
      source:      'receita-federal-direct',
      errorType:   'INVALID_DATA',
    };
  }

  // ── Formatar CPF: XXX.XXX.XXX-XX
  const cpfFormatted =
    `${cpfDigits.slice(0, 3)}.${cpfDigits.slice(3, 6)}.${cpfDigits.slice(6, 9)}-${cpfDigits.slice(9)}`;

  try {
    // ── Criar client axios com CookieJar (necessário para VIEWSTATE)
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
          'Accept':
            'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
          'Accept-Language': 'pt-BR,pt;q=0.9',
        },
      })
    );

    // ── Passo 1: GET — captura VIEWSTATE + EVENTVALIDATION + cookies
    logger.debug(`${SERVICE}.verify: GET Receita Federal`, { service: SERVICE, maskedCPF });

    const getResponse = await client.get(RECEITA_URL);
    const hiddenFields = _extractHiddenFields(getResponse.data);

    if (!hiddenFields['__VIEWSTATE']) {
      logger.warn(`${SERVICE}.verify: __VIEWSTATE não encontrado no GET`, {
        service: SERVICE,
        maskedCPF,
        statusCode: getResponse.status,
      });
      _cbRecordFailure();
      return {
        status:      'ERROR',
        name:        null,
        verified_at: new Date().toISOString(),
        source:      'receita-federal-direct',
        errorType:   'PARSE_ERROR',
      };
    }

    // ── Passo 2: POST — envia CPF + nascimento + campos ocultos
    const postBody = new URLSearchParams({
      ...hiddenFields,
      txtCPF:             cpfFormatted,
      txtDataNascimento:  birthdateFormatted,
      Enviar:             'Consultar',  // nome do botão submit
    });

    logger.debug(`${SERVICE}.verify: POST Receita Federal`, { service: SERVICE, maskedCPF });

    const postResponse = await client.post(RECEITA_URL, postBody.toString(), {
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded',
        'Referer':      RECEITA_URL,
        'Origin':       'https://servicos.receita.fazenda.gov.br',
      },
    });

    const durationMs = Date.now() - startMs;

    // ── Parse do HTML de resposta
    const { situation, name, rawSituacao } = _parseReceitaHTML(postResponse.data);

    // ── Verificar se o HTML indica dados inválidos (Receita rejeita CPF/nascimento errado)
    const bodyText = (postResponse.data || '').toLowerCase();
    const isInvalidData =
      bodyText.includes('cpf ou data de nascimento') ||
      bodyText.includes('dados informados não conferem') ||
      bodyText.includes('cpf inválido') ||
      bodyText.includes('não encontrado');

    if (isInvalidData && !situation) {
      logger.info(`${SERVICE}.verify: dados inválidos (Receita rejeitou)`, {
        service: SERVICE,
        maskedCPF,
        durationMs,
      });
      _cbRecordSuccess(); // Receita respondeu — circuito ok
      return {
        status:      'ERROR',
        name:        null,
        verified_at: new Date().toISOString(),
        source:      'receita-federal-direct',
        errorType:   'INVALID_DATA',
      };
    }

    // ── Situação não reconhecida → PARSE_ERROR
    if (!situation) {
      logger.error(`${SERVICE}.verify: PARSE_ERROR — estrutura HTML inesperada`, {
        service:    SERVICE,
        maskedCPF,
        durationMs,
        rawSituacao,
        // Logar trecho do HTML para diagnóstico (sem PII — a Receita retorna dados públicos)
        htmlSnippet: (postResponse.data || '').slice(0, 500),
      });
      _cbRecordFailure();
      return {
        status:      'ERROR',
        name:        null,
        verified_at: new Date().toISOString(),
        source:      'receita-federal-direct',
        errorType:   'PARSE_ERROR',
      };
    }

    // ── Sucesso
    _cbRecordSuccess();

    logger.info(`${SERVICE}.verify: consulta concluída`, {
      service:    SERVICE,
      maskedCPF,
      status:     situation,
      hasName:    !!name,
      durationMs,
    });

    return {
      status:      situation,
      name:        name || null,
      verified_at: new Date().toISOString(),
      source:      'receita-federal-direct',
    };

  } catch (err) {
    const durationMs = Date.now() - startMs;
    const isTimeout  = err.code === 'ECONNABORTED' || err.message?.includes('timeout');
    const isNetwork  = ['ECONNREFUSED', 'ENOTFOUND', 'ECONNRESET', 'ERR_NETWORK']
      .includes(err.code);

    _cbRecordFailure();

    logger.error(`${SERVICE}.verify: erro na consulta HTTP`, {
      service:     SERVICE,
      maskedCPF,
      errorCode:   err.code,
      errorMsg:    err.message,
      isTimeout,
      durationMs,
    });

    return {
      status:      'ERROR',
      name:        null,
      verified_at: new Date().toISOString(),
      source:      'receita-federal-direct',
      errorType:   isTimeout || isNetwork ? 'UNAVAILABLE' : 'UNAVAILABLE',
    };
  }
};

// ─────────────────────────────────────────────────────────────
// Exporta estado do circuit breaker para testes/monitoring
// ─────────────────────────────────────────────────────────────

const getCircuitBreakerState = () => ({
  state:       _cb.state,
  failures:    _cb.failures,
  openedAt:    _cb.openedAt,
  nextHalfOpen: _cb.nextHalfOpen,
});

module.exports = {
  verify,
  getCircuitBreakerState,
  // Exposto apenas para testes unitários
  _parseReceitaHTML,
  _mapSituacao,
  _extractHiddenFields,
  _formatBirthdate,
};
