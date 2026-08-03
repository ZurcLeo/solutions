'use strict';

const { getSupabaseClient } = require('../config/supabase');
const anthropicClient = require('../config/anthropic/anthropicClient');
const { logger } = require('../logger');
const { safeParseAIJson } = require('../utils/aiHelpers');

const SERVICE = 'civicKnowledgeService';

function sb() {
  const client = getSupabaseClient();
  if (!client) throw new Error('Supabase client não disponível');
  return client;
}

function log(fn, msg, extra = {}) {
  logger.info(msg, { service: SERVICE, function: fn, ...extra });
}

function logError(fn, err, extra = {}) {
  logger.error(`Erro em ${fn}: ${err.message}`, {
    service: SERVICE, function: fn, error: err.message, ...extra,
  });
}

// ── Constantes ──────────────────────────────────────────────────────────────

const AI_MODEL = 'claude-sonnet-4-20250514';

const RISK_KEYWORDS = [
  'milícia', 'milicia', 'traficante', 'tráfico', 'trafico',
  'facção', 'faccao', 'comando', 'pcc', 'cv ', 'tcp',
  'bala perdida', 'tiroteio', 'fuzil', 'arma de guerra',
  'executado', 'execução', 'justiceiro', 'tribunal do crime',
];

const SAFETY_CHANNELS = [
  { nome: 'Disque-Denúncia', telefone: '197', tipo: 'telefone', descricao: 'Denúncia anônima à polícia' },
  { nome: 'Disque Direitos Humanos', telefone: '100', tipo: 'telefone', descricao: 'Violação de direitos humanos' },
  { nome: 'Ministério Público', url: 'https://www.cnmp.mp.br/portal/institucional/procuradorias', tipo: 'site', descricao: 'Procuradoria do seu estado' },
  { nome: 'CVV — Centro de Valorização da Vida', telefone: '188', tipo: 'telefone', descricao: 'Apoio emocional 24h' },
];

const CLASSIFICATION_SYSTEM_PROMPT = `Você é um classificador de relatos cívicos para uma plataforma brasileira de participação comunitária.

Analise o texto do relato e retorne SOMENTE um JSON válido (sem markdown):
{
  "tipo": "infraestrutura|saude|educacao|seguranca_publica|meio_ambiente|transporte|iluminacao|saneamento|acessibilidade|cultura_lazer|habitacao|outros",
  "assunto_keywords": ["palavra1", "palavra2", "palavra3"],
  "esfera": "municipal|estadual|federal",
  "urgencia": "baixa|media|alta|critica",
  "flag_risco": false
}

REGRAS:
- "tipo" deve ser a categoria mais específica possível
- "esfera" é o nível de governo responsável (maioria é municipal)
- "urgencia": critica = risco à vida, alta = afeta muitas pessoas, media = inconveniente significativo, baixa = melhoria
- "flag_risco": true APENAS se o texto menciona violência armada, facções, milícias ou poderes paralelos
- "assunto_keywords": 3-5 palavras-chave para busca no dataset CGU
- NUNCA invente dados. Se não tem certeza da esfera, use "municipal"`;

const GUIDANCE_SYSTEM_PROMPT = `Você é um orientador cívico que ajuda cidadãos brasileiros a resolver problemas de infraestrutura.

Dado o tipo do relato e o órgão responsável, gere orientação prática em JSON:
{
  "canais": [
    {"nome": "Canal 1", "tipo": "site|telefone|app|presencial", "url_ou_contato": "...", "instrucao": "Como usar"}
  ],
  "passo_a_passo": [
    {"passo": 1, "titulo": "Título curto", "descricao": "O que fazer", "url": "link opcional"}
  ],
  "dica_eficacia": "Uma dica para aumentar a chance de resolução",
  "prazo_estimado": "Expectativa de prazo baseada no histórico"
}

REGRAS:
- Máximo 3 canais, ordenados por eficácia
- Passo a passo: 3-5 passos, linguagem simples
- Inclua sempre o Fala.BR (falabr.cgu.gov.br) como opção federal
- Para questões municipais, cite ouvidoria e 156
- Seja prático e objetivo`;

// ── Detecção de risco ───────────────────────────────────────────────────────

function detectRiskKeywords(texto) {
  const lower = texto.toLowerCase();
  return RISK_KEYWORDS.some(kw => lower.includes(kw));
}

/**
 * Detecta conteúdo sobre poderes paralelos (keywords + IA se disponível).
 * @returns {{ isRisk: boolean, channels: object[] }}
 */
async function detectRisk(texto) {
  const fn = 'detectRisk';

  // Nível 1: keywords
  if (detectRiskKeywords(texto)) {
    log(fn, 'Conteúdo de risco detectado via keywords');
    return { isRisk: true, channels: SAFETY_CHANNELS };
  }

  // Nível 2: IA (se disponível)
  if (anthropicClient) {
    try {
      const response = await anthropicClient.messages.create({
        model: AI_MODEL,
        max_tokens: 100,
        system: [
          {
            type: 'text',
            text: 'Você é um detector de conteúdo de risco. Analise se o texto menciona violência armada, facções, milícias ou poderes paralelos. Responda SOMENTE "RISCO" ou "SEGURO".',
            cache_control: { type: 'ephemeral' },
          },
        ],
        messages: [{
          role: 'user',
          content: `Texto: "${texto.substring(0, 500)}"`,
        }],
      });

      logger.info('[civicKnowledgeService] Claude cache metrics (detectRisk)', {
        service: SERVICE,
        cache_read: response.usage?.cache_read_input_tokens || 0,
        cache_creation: response.usage?.cache_creation_input_tokens || 0,
        input_tokens: response.usage?.input_tokens || 0,
      });

      const result = response.content?.[0]?.text?.trim()?.toUpperCase() || '';
      if (result.includes('RISCO')) {
        log(fn, 'Conteúdo de risco detectado via IA');
        return { isRisk: true, channels: SAFETY_CHANNELS };
      }
    } catch (err) {
      logError(fn, err, { detail: 'Falha na detecção de risco via IA, usando apenas keywords' });
    }
  }

  return { isRisk: false, channels: [] };
}

/**
 * Retorna canais de proteção sem armazenar nada.
 * D8: conteúdo sobre poderes paralelos NUNCA entra na plataforma.
 */
function handleRiskContent() {
  return {
    blocked: true,
    message: 'Para sua segurança, este tipo de relato não pode ser publicado na plataforma. Use os canais abaixo para denúncia segura e anônima.',
    channels: SAFETY_CHANNELS,
  };
}

// ── Classificação por IA ────────────────────────────────────────────────────

/**
 * Classifica conteúdo do relato usando Claude.
 * Fallback: classificação por keywords se IA indisponível.
 */
async function classifyContent(titulo, descricao, municipio) {
  const fn = 'classifyContent';
  const fullText = `${titulo}\n\n${descricao}`;

  // Verificar risco PRIMEIRO
  const risk = await detectRisk(fullText);
  if (risk.isRisk) {
    return { flag_risco: true, ...handleRiskContent() };
  }

  // Tentar IA
  if (anthropicClient) {
    try {
      const response = await anthropicClient.messages.create({
        model: AI_MODEL,
        max_tokens: 300,
        messages: [{
          role: 'user',
          content: `Município: ${municipio || 'não informado'}\nTítulo: ${titulo}\nDescrição: ${descricao}`,
        }],
        system: [
          {
            type: 'text',
            text: CLASSIFICATION_SYSTEM_PROMPT,
            cache_control: { type: 'ephemeral' },
          },
        ],
      });

      logger.info('[civicKnowledgeService] Claude cache metrics (classifyContent)', {
        service: SERVICE,
        cache_read: response.usage?.cache_read_input_tokens || 0,
        cache_creation: response.usage?.cache_creation_input_tokens || 0,
        input_tokens: response.usage?.input_tokens || 0,
      });

      const rawText = response.content?.[0]?.text || '';
      const parsed = safeParseAIJson(rawText);
      log(fn, 'Classificação por IA concluída', { tipo: parsed.tipo, esfera: parsed.esfera });
      return { flag_risco: false, ...parsed };
    } catch (err) {
      logError(fn, err, { detail: 'Falha na classificação IA, usando fallback por keywords' });
    }
  }

  // Fallback: keywords
  if (!anthropicClient) {
    logger.warn('[civicKnowledgeService] anthropicClient indisponível — classificação usando fallback por keywords', { service: SERVICE });
  }
  return classifyByKeywords(titulo, descricao);
}

/**
 * Classificação simples por keywords (fallback sem IA).
 */
function classifyByKeywords(titulo, descricao) {
  const text = `${titulo} ${descricao}`.toLowerCase();

  const KEYWORD_MAP = {
    iluminacao: ['poste', 'lampada', 'lâmpada', 'iluminação', 'escuro', 'luz'],
    saneamento: ['esgoto', 'bueiro', 'alagamento', 'enchente', 'água', 'saneamento'],
    transporte: ['ônibus', 'onibus', 'parada', 'semáforo', 'semaforo', 'trânsito', 'transito'],
    infraestrutura: ['buraco', 'calçada', 'calcada', 'asfalto', 'rua', 'ponte', 'viaduto'],
    saude: ['ubs', 'posto de saúde', 'hospital', 'fila', 'medicamento', 'vacina'],
    educacao: ['escola', 'creche', 'professor', 'merenda', 'uniforme'],
    meio_ambiente: ['lixo', 'desmatamento', 'queimada', 'poluição', 'poluicao', 'rio'],
    acessibilidade: ['rampa', 'cadeirante', 'acessibilidade', 'piso tátil'],
    seguranca_publica: ['policiamento', 'ronda', 'câmera', 'camera', 'delegacia'],
    habitacao: ['moradia', 'ocupação', 'desabamento', 'infiltração'],
  };

  // Conta matches por categoria em vez de parar no primeiro
  const scores = {};
  for (const [tipo, keywords] of Object.entries(KEYWORD_MAP)) {
    const matched = keywords.filter(kw => text.includes(kw));
    if (matched.length > 0) {
      scores[tipo] = { count: matched.length, keywords: matched };
    }
  }

  if (Object.keys(scores).length === 0) {
    return { flag_risco: false, tipo: 'outros', assunto_keywords: [], esfera: 'municipal', urgencia: 'media' };
  }

  // Escolhe a categoria com mais matches
  const melhor = Object.entries(scores)
    .sort((a, b) => b[1].count - a[1].count)[0];

  return {
    flag_risco: false,
    tipo: melhor[0],
    assunto_keywords: melhor[1].keywords.slice(0, 5),
    esfera: 'municipal',
    urgencia: 'media',
  };
}

// ── Roteamento cívico ───────────────────────────────────────────────────────

/**
 * Busca órgão recomendado no dataset local (civic_knowledge_base).
 *
 * O dataset CGU é predominantemente federal. Para infraestrutura municipal
 * (buraco, iluminação, saneamento), a cobertura é parcial. Quando não
 * encontra órgão municipal, retorna fallback com ouvidoria da prefeitura
 * + instrução para usar o Fala.BR.
 *
 * @param {Object} classificacao — saída de classifyContent
 * @param {string} municipioNome — nome do município (UPPER)
 * @param {string} uf — sigla UF (2 chars)
 */
async function routeToChannel(classificacao, municipioNome, uf) {
  const fn = 'routeToChannel';

  if (!municipioNome || !uf) {
    log(fn, 'Município/UF não informados, retornando fallback municipal');
    return getMunicipalFallback(municipioNome, uf, classificacao);
  }

  try {
    // 1. Busca exata: município + esfera + assuntos (overlapping via GIN)
    let query = sb()
      .from('civic_knowledge_base')
      .select('*')
      .eq('municipio_nome', municipioNome.toUpperCase())
      .eq('uf', uf.toUpperCase())
      .eq('esfera', classificacao.esfera || 'federal')
      .order('taxa_resolucao', { ascending: false })
      .limit(5);

    // Filtra por assuntos se disponíveis (overlaps)
    const keywords = classificacao.assunto_keywords?.slice(0, 3) || [];
    if (keywords.length > 0) {
      query = query.overlaps('assuntos', keywords);
    }

    const { data, error } = await query;
    if (error) throw error;

    // 2. Se não encontrou com assuntos, tenta sem filtro de assuntos
    if (!data || data.length === 0) {
      log(fn, 'Nenhum match com assuntos, tentando sem filtro');
      const { data: dataFallback, error: errFallback } = await sb()
        .from('civic_knowledge_base')
        .select('*')
        .eq('municipio_nome', municipioNome.toUpperCase())
        .eq('uf', uf.toUpperCase())
        .order('total_registros', { ascending: false })
        .limit(5);

      if (errFallback) throw errFallback;

      if (!dataFallback || dataFallback.length === 0) {
        log(fn, 'Nenhum órgão encontrado no dataset local — fallback municipal', { municipioNome, uf });
        return getMunicipalFallback(municipioNome, uf, classificacao);
      }

      return dataFallback;
    }

    log(fn, `Encontrados ${data.length} órgãos no dataset`, { municipioNome, uf });
    return data;
  } catch (err) {
    logError(fn, err, { municipioNome, uf });
    return getMunicipalFallback(municipioNome, uf, classificacao);
  }
}

/**
 * Fallback quando o dataset CGU não cobre o município (comum para infra municipal).
 * Retorna link direto para ouvidoria da prefeitura + Fala.BR.
 */
function getMunicipalFallback(municipioNome, uf, classificacao) {
  const municipioFormatado = municipioNome
    ? municipioNome.charAt(0) + municipioNome.slice(1).toLowerCase()
    : 'seu município';

  return [{
    orgao_nome: `Ouvidoria da Prefeitura de ${municipioFormatado}`,
    esfera: 'municipal',
    municipio_nome: municipioNome || '',
    uf: uf || '',
    taxa_resolucao: null,
    tempo_medio_resposta_dias: null,
    _fallback: true,
    _instrucao: `O dataset federal da CGU não cobre este órgão municipal. ` +
      `Procure a ouvidoria da prefeitura de ${municipioFormatado} (156) ou ` +
      `registre no Fala.BR (falabr.cgu.gov.br).`,
  }];
}

/**
 * Gera orientação usando Claude (passo a passo + canais recomendados).
 */
async function generateGuidance(classificacao, orgao) {
  const fn = 'generateGuidance';

  if (!anthropicClient) {
    log(fn, 'Claude indisponível, retornando orientação genérica');
    return getGenericGuidance(classificacao);
  }

  try {
    const prompt = `Tipo do relato: ${classificacao.tipo}
Esfera: ${classificacao.esfera}
Urgência: ${classificacao.urgencia}
Palavras-chave: ${(classificacao.assunto_keywords || []).join(', ')}
Órgão recomendado: ${orgao?.orgao_nome || 'não identificado'}
Canal principal: ${orgao?.canal_principal || 'não informado'}
Taxa de resolução histórica: ${orgao?.taxa_resolucao ? `${orgao.taxa_resolucao.toFixed(0)}%` : 'desconhecida'}
Tempo médio: ${orgao?.tempo_medio_resposta_dias ? `${orgao.tempo_medio_resposta_dias} dias` : 'desconhecido'}
${orgao?._fallback ? 'NOTA: Dados do dataset CGU não cobrem este órgão municipal — orientar uso do Fala.BR e ouvidoria local.' : ''}`;

    const response = await anthropicClient.messages.create({
      model: AI_MODEL,
      max_tokens: 500,
      messages: [{ role: 'user', content: prompt }],
      system: [
        {
          type: 'text',
          text: GUIDANCE_SYSTEM_PROMPT,
          cache_control: { type: 'ephemeral' },
        },
      ],
    });

    logger.info('[civicKnowledgeService] Claude cache metrics (generateGuidance)', {
      service: SERVICE,
      cache_read: response.usage?.cache_read_input_tokens || 0,
      cache_creation: response.usage?.cache_creation_input_tokens || 0,
      input_tokens: response.usage?.input_tokens || 0,
    });

    const rawText = response.content?.[0]?.text || '';
    const parsed = safeParseAIJson(rawText);
    log(fn, 'Orientação gerada por IA', { tipo: classificacao.tipo });
    return parsed;
  } catch (err) {
    logError(fn, err, { detail: 'Fallback para orientação genérica' });
    return getGenericGuidance(classificacao);
  }
}

/**
 * Orientação genérica (fallback sem IA).
 */
function getGenericGuidance(classificacao) {
  return {
    canais: [
      { nome: 'Fala.BR', tipo: 'site', url_ou_contato: 'https://falabr.cgu.gov.br', instrucao: 'Registre sua manifestação no portal Fala.BR da CGU' },
      { nome: 'Ouvidoria Municipal (156)', tipo: 'telefone', url_ou_contato: '156', instrucao: 'Ligue para a ouvidoria do seu município' },
      { nome: 'Câmara de Vereadores', tipo: 'presencial', url_ou_contato: '', instrucao: 'Procure o vereador do seu bairro' },
    ],
    passo_a_passo: [
      { passo: 1, titulo: 'Documente o problema', descricao: 'Tire fotos e anote o endereço exato' },
      { passo: 2, titulo: 'Registre a reclamação', descricao: 'Use o Fala.BR ou ligue 156 para registrar formalmente' },
      { passo: 3, titulo: 'Guarde o protocolo', descricao: 'Anote o número do protocolo para acompanhamento' },
      { passo: 4, titulo: 'Acompanhe', descricao: 'Consulte o andamento pelo mesmo canal após 15 dias úteis' },
    ],
    dica_eficacia: 'Relatos com fotos e localização precisa têm 3x mais chance de resolução.',
    prazo_estimado: classificacao.esfera === 'municipal' ? '15-30 dias úteis' : '30-90 dias úteis',
  };
}

// ── Import job CGU ──────────────────────────────────────────────────────────

/**
 * Importa dataset CGU para civic_knowledge_base.
 * @param {Array} records — array de objetos com campos do CSV CGU
 */
async function importCGUDataset(records) {
  const fn = 'importCGUDataset';
  log(fn, `Importando ${records.length} registros do dataset CGU`);

  const supabase = sb();
  let imported = 0;
  let errors = 0;

  // Processa em lotes de 100
  for (let i = 0; i < records.length; i += 100) {
    const batch = records.slice(i, i + 100).map(r => ({
      municipio_ibge: r.municipio_ibge || null,
      municipio_nome: (r.municipio_nome || r.municipio_manifestacao || '').toUpperCase(),
      uf: (r.uf || '').toUpperCase(),
      orgao_nome: r.orgao_nome || r.orgao || r.nome_orgao,
      orgao_siorg_id: r.orgao_siorg_id || null,
      esfera: r.esfera || 'federal',
      tipo_manifesto: r.tipo_manifesto || [],
      assuntos: r.assuntos || [],
      taxa_resolucao: r.taxa_resolucao || 0,
      tempo_medio_resposta_dias: r.tempo_medio_resposta_dias || r.tempo_medio_dias || 0,
      total_registros: r.total_registros || 0,
      canal_principal: r.canal_principal || '',
      url_canal: r.url_canal || '',
      ultima_atualizacao: new Date().toISOString(),
    }));

    const { error } = await supabase
      .from('civic_knowledge_base')
      .upsert(batch, { onConflict: 'orgao_siorg_id,municipio_nome,esfera', ignoreDuplicates: false });

    if (error) {
      logError(fn, error, { batch: i });
      errors += batch.length;
    } else {
      imported += batch.length;
    }
  }

  log(fn, `Import concluído: ${imported} importados, ${errors} erros`);
  return { imported, errors };
}

// ── Exports ─────────────────────────────────────────────────────────────────

module.exports = {
  classifyContent,
  routeToChannel,
  generateGuidance,
  detectRisk,
  handleRiskContent,
  importCGUDataset,
  // Expostos para teste
  classifyByKeywords,
  getGenericGuidance,
  RISK_KEYWORDS,
  SAFETY_CHANNELS,
};
