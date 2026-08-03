'use strict';

const { getSupabaseClient } = require('../config/supabase');
const { logger } = require('../logger');
const civicKnowledgeService = require('./civicKnowledgeService');
const gamificationService = require('./gamificationService');
const trustPassportService = require('./trustPassportService');

const SERVICE = 'agoraService';

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

const RELATO_PUBLIC_STATUSES = ['publicado', 'encaminhado', 'resolvido'];

// ── Resolução IBGE → nome do município ──────────────────────────────────────

/**
 * Resolve código IBGE para nome e UF do município.
 * Tenta civic_knowledge_base primeiro (zero HTTP), fallback para BrasilAPI.
 */
async function resolveIbge(ibge) {
  if (!ibge) return null;
  const code = String(ibge).trim();
  if (!/^\d{6,7}$/.test(code)) return null;

  // 1. Busca no dataset local
  try {
    const { data } = await sb()
      .from('civic_knowledge_base')
      .select('municipio_nome, uf')
      .eq('municipio_ibge', code)
      .limit(1)
      .maybeSingle();
    if (data?.municipio_nome) {
      return { nome: data.municipio_nome, uf: data.uf };
    }
  } catch {}

  // 2. Fallback: BrasilAPI IBGE
  try {
    const res = await fetch(`https://brasilapi.com.br/api/ibge/municipios/v1/${code}`);
    if (res.ok) {
      const d = await res.json();
      // BrasilAPI retorna { nome, codigo_ibge } — sem UF diretamente, extraímos dos 2 primeiros dígitos
      const UF_MAP = {
        '11':'RO','12':'AC','13':'AM','14':'RR','15':'PA','16':'AP','17':'TO',
        '21':'MA','22':'PI','23':'CE','24':'RN','25':'PB','26':'PE','27':'AL','28':'SE','29':'BA',
        '31':'MG','32':'ES','33':'RJ','35':'SP',
        '41':'PR','42':'SC','43':'RS',
        '50':'MS','51':'MT','52':'GO','53':'DF',
      };
      const uf = UF_MAP[code.substring(0, 2)] || '';
      return { nome: (d.nome || '').toUpperCase(), uf };
    }
  } catch {}

  return null;
}

const TRUST_EVENTS = {
  ASSINATURA:             { domain: 'social',  type: 'agora_assinatura',             impact: 1 },
  RELATO_RESOLVIDO:       { domain: 'social',  type: 'agora_relato_resolvido',       impact: 3 },
  RESOLUCAO_DOCUMENTADA:  { domain: 'social',  type: 'agora_resolucao_documentada',  impact: 2 },
  MODERACAO_PERFORMED:    { domain: 'civic',   type: 'moderation_performed',         impact: 2 },
};

// ── Regiões ─────────────────────────────────────────────────────────────────

async function listRegioes(filters = {}) {
  const fn = 'listRegioes';
  try {
    let query = sb().from('agora_regioes').select('*').eq('ativo', true);

    if (filters.tipo) query = query.eq('tipo', filters.tipo);
    if (filters.municipio_ibge) query = query.eq('municipio_ibge', filters.municipio_ibge);
    if (filters.pai_id) query = query.eq('pai_id', filters.pai_id);

    query = query.order('nome', { ascending: true });

    const { data, error } = await query;
    if (error) throw error;
    return data || [];
  } catch (err) {
    logError(fn, err);
    throw err;
  }
}

async function createRegiao(adminUserId, regiaoData) {
  const fn = 'createRegiao';
  try {
    // Set current user for audit trigger
    await sb().rpc('set_config', { setting_name: 'app.current_user_id', setting_value: adminUserId });

    const { data, error } = await sb()
      .from('agora_regioes')
      .insert({
        nome: regiaoData.nome,
        tipo: regiaoData.tipo,
        pai_id: regiaoData.pai_id || null,
        municipio_ibge: regiaoData.municipio_ibge || null,
        estado_uf: regiaoData.estado_uf || null,
        latitude: regiaoData.latitude || null,
        longitude: regiaoData.longitude || null,
        raio_km: regiaoData.raio_km || 5.0,
        threshold_relato: regiaoData.threshold_relato || 10,
        threshold_enquete: regiaoData.threshold_enquete || 10,
        canal_oficial: regiaoData.canal_oficial || {},
        alto_risco: regiaoData.alto_risco || false,
      })
      .select()
      .single();

    if (error) throw error;
    log(fn, 'Região criada', { regiaoId: data.id });
    return data;
  } catch (err) {
    logError(fn, err);
    throw err;
  }
}

async function updateRegiao(adminUserId, regiaoId, updates) {
  const fn = 'updateRegiao';
  try {
    await sb().rpc('set_config', { setting_name: 'app.current_user_id', setting_value: adminUserId });

    const { data, error } = await sb()
      .from('agora_regioes')
      .update(updates)
      .eq('id', regiaoId)
      .select()
      .single();

    if (error) throw error;
    log(fn, 'Região atualizada', { regiaoId });
    return data;
  } catch (err) {
    logError(fn, err);
    throw err;
  }
}

async function getRegiaoLog(regiaoId) {
  const fn = 'getRegiaoLog';
  try {
    const { data, error } = await sb()
      .from('agora_regioes_log')
      .select('*')
      .eq('regiao_id', regiaoId)
      .order('created_at', { ascending: false });

    if (error) throw error;
    return data || [];
  } catch (err) {
    logError(fn, err);
    throw err;
  }
}

// ── Geolocalização de Regiões ─────────────────────────────────────────────

async function getRegiaoByCoords(lat, lng) {
  const fn = 'getRegiaoByCoords';
  try {
    const { data, error } = await sb().rpc('agora_regiao_por_coords', {
      p_lat: lat,
      p_lng: lng,
    });
    if (error) throw error;
    return data || [];
  } catch (err) {
    logError(fn, err);
    throw err;
  }
}

async function geocodeCep(cep) {
  if (!cep) return null;
  const raw = String(cep).replace(/\D/g, '');
  if (raw.length !== 8) return null;
  try {
    const res = await fetch(`https://brasilapi.com.br/api/cep/v2/${raw}`);
    if (!res.ok) return null;
    const data = await res.json();
    const coords = data?.location?.coordinates;
    if (!coords?.latitude || !coords?.longitude) return null;
    return {
      lat: Number(coords.latitude),
      lng: Number(coords.longitude),
      bairro: data.neighborhood || null,
      cidade: data.city || null,
      uf: data.state || null,
      ibge: data.ibge || null,
    };
  } catch {
    return null;
  }
}

async function getRegiaoByCep(cep) {
  const fn = 'getRegiaoByCep';
  try {
    const geo = await geocodeCep(cep);
    if (!geo) return { regioes: [], geo: null, message: 'CEP não encontrado ou sem coordenadas' };

    // 1. Tentar encontrar região existente por GPS
    let regioes = await getRegiaoByCoords(geo.lat, geo.lng);
    if (regioes.length > 0) {
      return { regioes, geo };
    }

    // 2. Não encontrou — auto-criar região a partir dos dados do CEP
    log(fn, 'Nenhuma região encontrada, criando automaticamente', { cep, bairro: geo.bairro, cidade: geo.cidade });
    const created = await autoCreateRegiao(geo);
    if (created) {
      return { regioes: [created], geo, autoCreated: true };
    }

    return { regioes: [], geo, message: 'Não foi possível determinar a região para este CEP' };
  } catch (err) {
    logError(fn, err);
    throw err;
  }
}

/**
 * Cria região automaticamente a partir de dados do CEP (BrasilAPI).
 * Resolve hierarquia: município (pai) → bairro (filho).
 * Se o município já existe, reutiliza. Senão, cria também.
 */
async function autoCreateRegiao(geo) {
  const fn = 'autoCreateRegiao';
  const supabase = sb();

  if (!geo.cidade) return null;

  const ibge = geo.ibge || null;

  // 1. Buscar ou criar o município-pai
  let municipioPai = null;
  const cidadeUpper = geo.cidade.toUpperCase();

  // Busca por nome + UF (case-insensitive via UPPER)
  const { data: existingMunicipio } = await supabase
    .from('agora_regioes')
    .select('*')
    .eq('tipo', 'municipio')
    .ilike('nome', cidadeUpper)
    .eq('estado_uf', (geo.uf || '').toUpperCase())
    .eq('ativo', true)
    .limit(1)
    .maybeSingle();

  if (existingMunicipio) {
    municipioPai = existingMunicipio;
  } else {
    // Criar município
    const { data: newMunicipio, error: mErr } = await supabase
      .from('agora_regioes')
      .insert({
        nome: cidadeUpper,
        tipo: 'municipio',
        municipio_ibge: ibge,
        estado_uf: (geo.uf || '').toUpperCase(),
        latitude: geo.lat,
        longitude: geo.lng,
        raio_km: 15.0,  // raio amplo para município
        threshold_relato: 10,
        threshold_enquete: 5,
        ativo: true,
      })
      .select()
      .single();

    if (mErr) {
      logError(fn, mErr, { detail: 'Falha ao criar município auto' });
      return null;
    }
    municipioPai = newMunicipio;
    log(fn, 'Município criado automaticamente', { nome: cidadeUpper, id: newMunicipio.id });
  }

  // 2. Se tem bairro, criar bairro como filho do município
  if (geo.bairro) {
    const bairroUpper = geo.bairro.toUpperCase();

    // Verificar se bairro já existe nesse município
    const { data: existingBairro } = await supabase
      .from('agora_regioes')
      .select('*')
      .eq('tipo', 'bairro')
      .ilike('nome', bairroUpper)
      .eq('pai_id', municipioPai.id)
      .eq('ativo', true)
      .limit(1)
      .maybeSingle();

    if (existingBairro) return existingBairro;

    const { data: newBairro, error: bErr } = await supabase
      .from('agora_regioes')
      .insert({
        nome: bairroUpper,
        tipo: 'bairro',
        pai_id: municipioPai.id,
        municipio_ibge: ibge || municipioPai.municipio_ibge,
        estado_uf: municipioPai.estado_uf,
        latitude: geo.lat,
        longitude: geo.lng,
        raio_km: 3.0,  // raio para bairro
        threshold_relato: 10,
        threshold_enquete: 5,
        ativo: true,
      })
      .select()
      .single();

    if (bErr) {
      logError(fn, bErr, { detail: 'Falha ao criar bairro auto' });
      return municipioPai; // Fallback: retorna o município
    }

    log(fn, 'Bairro criado automaticamente', { nome: bairroUpper, municipio: cidadeUpper, id: newBairro.id });
    return newBairro;
  }

  // Sem bairro — retorna o município
  return municipioPai;
}

// ── Relatos ─────────────────────────────────────────────────────────────────

async function classifyPreview(titulo, descricao, municipioIbge) {
  const fn = 'classifyPreview';
  log(fn, 'Preview de classificação solicitado', { municipioIbge });

  // Resolver IBGE → nome do município antes de classificar
  const resolved = await resolveIbge(municipioIbge);
  const municipioNome = resolved?.nome || null;
  const uf = resolved?.uf || '';

  const classification = await civicKnowledgeService.classifyContent(titulo, descricao, municipioNome || municipioIbge);

  if (classification.flag_risco) {
    return classification; // Contém blocked + channels
  }

  // Buscar roteamento com nome real do município
  const orgaos = await civicKnowledgeService.routeToChannel(
    classification, municipioNome, uf || classification.uf || ''
  );
  const primaryOrgao = orgaos?.[0] || null;

  // Gerar orientação
  const guidance = await civicKnowledgeService.generateGuidance(classification, primaryOrgao);

  return {
    ...classification,
    municipio_nome: municipioNome,
    uf,
    orgaos,
    guidance,
  };
}

async function createRelato(userId, data) {
  const fn = 'createRelato';
  log(fn, 'Criando relato', { userId });

  // 1. Resolver IBGE → nome do município
  const resolved = await resolveIbge(data.municipio_ibge);
  const municipioNome = data.municipio_nome || resolved?.nome || null;
  const uf = data.uf || resolved?.uf || '';

  // 2. Classificar conteúdo
  const classification = await civicKnowledgeService.classifyContent(
    data.titulo, data.descricao, municipioNome
  );

  // D8: conteúdo de risco NUNCA armazenado
  if (classification.flag_risco) {
    log(fn, 'Conteúdo de risco bloqueado — nada armazenado', { userId });
    return classification;
  }

  // 3. Buscar roteamento com nome real
  const orgaos = await civicKnowledgeService.routeToChannel(
    classification, municipioNome, uf || classification.uf || ''
  );
  const primaryOrgao = orgaos?.[0] || null;

  // 3. Gerar orientação
  const guidance = await civicKnowledgeService.generateGuidance(classification, primaryOrgao);

  // 4. Inserir relato
  const { data: relato, error } = await sb()
    .from('agora_relatos')
    .insert({
      regiao_id: data.regiao_id,
      criado_por: userId,
      criado_por_nome_pub: data.criado_por_nome_pub !== false,
      titulo: data.titulo,
      descricao: data.descricao,
      categoria: classification.tipo || data.categoria || 'outros',
      imagens: data.imagens || [],
      localizacao_lat: data.localizacao_lat || null,
      localizacao_lng: data.localizacao_lng || null,
      endereco_texto: data.endereco_texto || null,
      orgao_recomendado: primaryOrgao?.orgao || null,
      esfera_recomendada: classification.esfera || null,
      passo_a_passo: guidance?.passo_a_passo || [],
      canais_recomendados: guidance?.canais || [],
      status: 'pendente_moderacao',
    })
    .select()
    .single();

  if (error) throw error;

  // 5. Assignar moderador
  try {
    await sb().rpc('agora_assignar_moderador', { p_relato_id: relato.id });
  } catch (modErr) {
    logError(fn, modErr, { detail: 'Falha ao assignar moderador, relato criado sem moderação' });
  }

  // 6. Gamification
  gamificationService.triggerEvent('relato_created', userId).catch(() => {});

  log(fn, 'Relato criado com sucesso', { relatoId: relato.id, categoria: relato.categoria });
  return { ...relato, guidance };
}

async function listRelatos(regiaoId, filters = {}) {
  const fn = 'listRelatos';
  try {
    let query = sb()
      .from('agora_relatos')
      .select('id, titulo, descricao, categoria, status, assinaturas_count, localizacao_lat, localizacao_lng, endereco_texto, regiao_id, criado_por, criado_por_nome_pub, created_at')
      .in('status', RELATO_PUBLIC_STATUSES);

    if (regiaoId) {
      query = query.eq('regiao_id', regiaoId);
    } else if (!filters.all_regions) {
      query = query.is('regiao_id', null);
    }
    if (filters.categoria) query = query.eq('categoria', filters.categoria);
    if (filters.status) query = query.eq('status', filters.status);

    const page = filters.page || 1;
    const limit = Math.min(filters.limit || 20, 50);
    const from = (page - 1) * limit;

    query = query.order('created_at', { ascending: false }).range(from, from + limit - 1);

    const { data, error } = await query;
    if (error) throw error;
    return data || [];
  } catch (err) {
    logError(fn, err);
    throw err;
  }
}

async function getRelato(relatoId) {
  const fn = 'getRelato';
  try {
    const { data, error } = await sb()
      .from('agora_relatos')
      .select('*')
      .eq('id', relatoId)
      .single();

    if (error) throw error;
    return data;
  } catch (err) {
    logError(fn, err);
    throw err;
  }
}

// ── Assinaturas ─────────────────────────────────────────────────────────────

async function signRelato(userId, relatoId, nomeCompleto, cpfMascarado, regiaoId) {
  const fn = 'signRelato';
  log(fn, 'Assinando relato', { userId, relatoId });

  const { data, error } = await sb()
    .from('agora_assinaturas')
    .insert({
      relato_id: relatoId,
      user_id: userId,
      regiao_id: regiaoId || null,
      nome_completo: nomeCompleto,
      cpf_mascarado: cpfMascarado,
    })
    .select()
    .single();

  if (error) {
    if (error.code === '23505') throw new Error('Você já assinou este relato');
    throw error;
  }

  // Trust passport event
  trustPassportService.recordEvent(userId, 'social', 'agora_assinatura', 1).catch(() => {});

  // Gamification
  gamificationService.triggerEvent('relato_signed', userId).catch(() => {});

  log(fn, 'Assinatura registrada', { relatoId });
  return data;
}

async function hasUserSigned(userId, relatoId) {
  const { data } = await sb()
    .from('agora_assinaturas')
    .select('id')
    .eq('relato_id', relatoId)
    .eq('user_id', userId)
    .maybeSingle();

  return !!data;
}

async function getRelatoSignatures(relatoId) {
  const fn = 'getRelatoSignatures';
  try {
    const { data, error } = await sb()
      .from('agora_assinaturas')
      .select('nome_completo, cpf_mascarado, created_at')
      .eq('relato_id', relatoId)
      .order('created_at', { ascending: true });

    if (error) throw error;
    return data || [];
  } catch (err) {
    logError(fn, err);
    throw err;
  }
}

// ── Encaminhamento e Resolução ──────────────────────────────────────────────

async function registerEncaminhamento(userId, relatoId, orgao, protocolo) {
  const fn = 'registerEncaminhamento';

  const { data, error } = await sb()
    .from('agora_relatos')
    .update({
      status: 'encaminhado',
      protocolo_orgao: orgao,
      protocolo_numero: protocolo,
      encaminhado_em: new Date().toISOString(),
    })
    .eq('id', relatoId)
    .eq('criado_por', userId)
    .select()
    .single();

  if (error) throw error;
  log(fn, 'Encaminhamento registrado', { relatoId, orgao, protocolo });
  return data;
}

async function registerResolucao(userId, relatoId, descricao, evidenciaUrl) {
  const fn = 'registerResolucao';

  const { data, error } = await sb()
    .from('agora_relatos')
    .update({
      status: 'resolvido',
      resolucao_descricao: descricao,
      resolucao_evidencia_url: evidenciaUrl || null,
      resolvido_em: new Date().toISOString(),
    })
    .eq('id', relatoId)
    .eq('criado_por', userId)
    .select()
    .single();

  if (error) throw error;

  // Trust events
  trustPassportService.recordEvent(userId, 'social', 'agora_relato_resolvido', 3).catch(() => {});
  if (evidenciaUrl) {
    trustPassportService.recordEvent(userId, 'social', 'agora_resolucao_documentada', 2).catch(() => {});
  }

  // Gamification
  gamificationService.triggerEvent('relato_resolved', userId).catch(() => {});

  log(fn, 'Resolução registrada', { relatoId });
  return data;
}

// ── Moderação ───────────────────────────────────────────────────────────────

async function getModerationQueue(userId, isAdmin) {
  const fn = 'getModerationQueue';
  try {
    let query = sb()
      .from('agora_moderacao_fila')
      .select(`
        id, relato_id, tipo, assignado_a, decisao, motivo, escalar_em, escalado, created_at, decidido_em,
        agora_relatos!inner(id, titulo, descricao, categoria, esfera_recomendada, regiao_id, assinaturas_count, created_at, status)
      `)
      .is('decisao', null);

    if (!isAdmin) {
      query = query.eq('assignado_a', userId);
    }

    query = query.order('escalar_em', { ascending: true });

    const { data, error } = await query;
    if (error) throw error;

    // Achatar agora_relatos no nível raiz para o frontend consumir direto.
    // Guardiões são CEGOS ao autor: não incluir criado_por.
    return (data || []).map(item => {
      const relato = item.agora_relatos || {};
      const { agora_relatos: _nested, ...filaFields } = item;
      return {
        ...filaFields,
        titulo:        relato.titulo,
        descricao:     relato.descricao,
        categoria:     relato.categoria,
        esfera:        relato.esfera_recomendada,
        regiao_id:     relato.regiao_id,
        assinaturas_count: relato.assinaturas_count,
        relato_status: relato.status,
        relato_created_at: relato.created_at,
        criado_por:    isAdmin ? relato.criado_por : undefined,
      };
    });
  } catch (err) {
    logError(fn, err);
    throw err;
  }
}

async function decideModerationItem(userId, relatoId, decision, motivo) {
  const fn = 'decideModerationItem';
  log(fn, 'Decisão de moderação', { userId, relatoId, decision });

  // Atualizar fila
  const { error: filaError } = await sb()
    .from('agora_moderacao_fila')
    .update({
      decisao: decision,
      motivo: motivo || null,
      decidido_em: new Date().toISOString(),
    })
    .eq('relato_id', relatoId)
    .eq('assignado_a', userId)
    .is('decisao', null);

  if (filaError) throw filaError;

  // Atualizar status do relato
  const newStatus = decision === 'aprovado' ? 'publicado' : decision === 'rejeitado' ? 'rejeitado' : 'pendente_moderacao';

  if (decision !== 'escalado') {
    const { error: relatoError } = await sb()
      .from('agora_relatos')
      .update({ status: newStatus })
      .eq('id', relatoId);

    if (relatoError) throw relatoError;
  }

  // Trust event para moderador
  trustPassportService.recordEvent(userId, 'civic', 'moderation_performed', 2).catch(() => {});

  log(fn, 'Moderação concluída', { relatoId, decision, newStatus });
  return { relatoId, decision, newStatus };
}

async function escalateModeration(relatoId) {
  const fn = 'escalateModeration';

  const { error } = await sb()
    .from('agora_moderacao_fila')
    .update({ escalado: true, tipo: 'admin' })
    .eq('relato_id', relatoId)
    .is('decisao', null);

  if (error) throw error;
  log(fn, 'Moderação escalada para admin', { relatoId });
}

async function overrideModeration(adminUserId, relatoId, decision, motivo) {
  const fn = 'overrideModeration';
  log(fn, 'Admin override', { adminUserId, relatoId, decision });

  // Fechar item de moderação existente
  await sb()
    .from('agora_moderacao_fila')
    .update({ decisao: 'escalado', motivo: 'Admin override' })
    .eq('relato_id', relatoId)
    .is('decisao', null);

  // Criar novo item com decisão admin
  await sb()
    .from('agora_moderacao_fila')
    .insert({
      relato_id: relatoId,
      tipo: 'admin',
      assignado_a: adminUserId,
      decisao: decision,
      motivo: motivo || 'Admin override',
      decidido_em: new Date().toISOString(),
    });

  // Atualizar relato
  const newStatus = decision === 'aprovado' ? 'publicado' : 'rejeitado';
  await sb()
    .from('agora_relatos')
    .update({ status: newStatus })
    .eq('id', relatoId);

  log(fn, 'Override concluído', { relatoId, newStatus });
  return { relatoId, decision, newStatus };
}

// ── Enquetes ────────────────────────────────────────────────────────────────

async function createEnquete(userId, data) {
  const fn = 'createEnquete';

  // Gate: Trust Level ≥ 4 ou admin
  const canCreate = await sb().rpc('agora_pode_criar_informativo', { p_user_id: userId });
  if (!canCreate?.data) {
    throw new Error('Trust Level insuficiente para criar enquetes (mínimo: Nível 4)');
  }

  const { data: enquete, error } = await sb()
    .from('agora_enquetes')
    .insert({
      criado_por: userId,
      regiao_id: data.regiao_id || null,
      pergunta: data.pergunta,
      descricao: data.descricao || null,
      opcoes: data.opcoes,
      encerra_em: data.encerra_em || null,
    })
    .select()
    .single();

  if (error) throw error;

  gamificationService.triggerEvent('enquete_created', userId).catch(() => {});
  log(fn, 'Enquete criada', { enqueteId: enquete.id });
  return enquete;
}

async function listEnquetes(regiaoId, filters = {}) {
  const fn = 'listEnquetes';
  try {
    let query = sb().from('agora_enquetes').select('*');

    // Inclui enquetes da região selecionada + globais (regiao_id IS NULL)
    if (regiaoId) {
      query = query.or(`regiao_id.eq.${regiaoId},regiao_id.is.null`);
    } else if (!filters.all_regions) {
      // Sem região: retorna apenas enquetes globais (visíveis para todos)
      query = query.is('regiao_id', null);
    }
    // Se filters.all_regions = true (admin), não filtra por região
    // Default: apenas enquetes abertas (admin passa status='all' para ver todas)
    if (filters.status && filters.status !== 'all') {
      query = query.eq('status', filters.status);
    } else if (!filters.status) {
      query = query.eq('status', 'aberta');
    }

    query = query.order('created_at', { ascending: false });

    const page = filters.page || 1;
    const limit = Math.min(filters.limit || 20, 50);
    const from = (page - 1) * limit;
    query = query.range(from, from + limit - 1);

    const { data, error } = await query;
    if (error) throw error;
    return data || [];
  } catch (err) {
    logError(fn, err);
    throw err;
  }
}

async function getEnquete(enqueteId, userId) {
  const { data, error } = await sb()
    .from('agora_enquetes')
    .select('*')
    .eq('id', enqueteId)
    .single();

  if (error) throw error;
  if (!data) return null;

  // Check if user has voted (HMAC RPC)
  let has_voted = false;
  if (userId) {
    has_voted = await hasUserVotedEnquete(userId, enqueteId);
  }

  // Transform resultado JSONB {opcao_id: count} → resultados [{opcao, votos}]
  const opcoes = data.opcoes || [];
  const resultado = data.resultado || {};
  const resultados = opcoes.map(o => ({
    opcao: o.texto,
    votos: resultado[o.id] || 0,
  }));

  return {
    ...data,
    has_voted,
    resultados,
  };
}

async function voteEnquete(userId, enqueteId, opcaoId) {
  const fn = 'voteEnquete';

  // Verificar se já votou (RPC HMAC)
  const { data: alreadyVoted } = await sb().rpc('agora_user_voted_enquete', {
    p_user_id: userId,
    p_enquete_id: enqueteId,
  });

  if (alreadyVoted) {
    throw new Error('Você já votou nesta enquete');
  }

  // Inserir voto (trigger HMAC anonimiza)
  const { error } = await sb()
    .from('agora_respostas_enquete')
    .insert({
      enquete_id: enqueteId,
      user_id: userId,  // será hasheado pelo trigger
      opcao_id: opcaoId,
    });

  if (error) throw error;

  // Atualizar counter no enquete (aguarda para re-fetch pegar dados frescos)
  await updateEnqueteResults(enqueteId);

  // Gamification
  gamificationService.triggerEvent('enquete_voted', userId).catch(() => {});

  log(fn, 'Voto registrado (anônimo)', { enqueteId });
  return { success: true };
}

async function hasUserVotedEnquete(userId, enqueteId) {
  const { data } = await sb().rpc('agora_user_voted_enquete', {
    p_user_id: userId,
    p_enquete_id: enqueteId,
  });
  return !!data;
}

async function getEnqueteResults(enqueteId) {
  const { data, error } = await sb().rpc('agora_get_enquete_resultados', {
    p_enquete_id: enqueteId,
  });

  if (error) throw error;
  return data?.[0] || { total_votos: 0, resultados: {} };
}

async function updateEnqueteResults(enqueteId) {
  const results = await getEnqueteResults(enqueteId);
  await sb()
    .from('agora_enquetes')
    .update({
      resultado: results.resultados || {},
      total_votos: results.total_votos || 0,
    })
    .eq('id', enqueteId);
}

async function closeEnquete(userId, enqueteId) {
  const { data, error } = await sb()
    .from('agora_enquetes')
    .update({ status: 'encerrada' })
    .eq('id', enqueteId)
    .eq('criado_por', userId)
    .select()
    .single();

  if (error) throw error;
  return data;
}

// ── Informativos ────────────────────────────────────────────────────────────

async function createInformativo(userId, data) {
  const fn = 'createInformativo';

  const canCreate = await sb().rpc('agora_pode_criar_informativo', { p_user_id: userId });
  if (!canCreate?.data) {
    throw new Error('Trust Level insuficiente para criar informativos (mínimo: Nível 4)');
  }

  const { data: informativo, error } = await sb()
    .from('agora_informativos')
    .insert({
      criado_por: userId,
      regiao_id: data.regiao_id || null,
      titulo: data.titulo,
      resumo: data.resumo,
      conteudo: data.conteudo,
      fonte_url: data.fonte_url,
      casa: data.casa || null,
      tags: data.tags || [],
      status: 'rascunho',
    })
    .select()
    .single();

  if (error) throw error;
  log(fn, 'Informativo criado', { informativoId: informativo.id });
  return informativo;
}

async function listInformativos(regiaoId, filters = {}) {
  let query = sb().from('agora_informativos').select('*');

  // Inclui informativos da região selecionada + globais (regiao_id IS NULL)
  if (regiaoId) {
    query = query.or(`regiao_id.eq.${regiaoId},regiao_id.is.null`);
  } else if (!filters.all_regions) {
    query = query.is('regiao_id', null);
  }
  // Default: apenas publicados (admin passa status explícito)
  if (filters.status && filters.status !== 'all') {
    query = query.eq('status', filters.status);
  } else if (!filters.status) {
    query = query.eq('status', 'publicado');
  }
  if (filters.casa) query = query.eq('casa', filters.casa);

  query = query.order('publicado_em', { ascending: false, nullsFirst: false });

  const page = filters.page || 1;
  const limit = Math.min(filters.limit || 20, 50);
  const from = (page - 1) * limit;
  query = query.range(from, from + limit - 1);

  const { data, error } = await query;
  if (error) throw error;
  return data || [];
}

async function getInformativo(informativoId) {
  const { data, error } = await sb()
    .from('agora_informativos')
    .select('*')
    .eq('id', informativoId)
    .single();

  if (error) throw error;
  return data;
}

async function publishInformativo(userId, informativoId) {
  const { data, error } = await sb()
    .from('agora_informativos')
    .update({ status: 'publicado', publicado_em: new Date().toISOString() })
    .eq('id', informativoId)
    .eq('criado_por', userId)
    .select()
    .single();

  if (error) throw error;
  return data;
}

async function archiveInformativo(userId, informativoId) {
  const { data, error } = await sb()
    .from('agora_informativos')
    .update({ status: 'arquivado' })
    .eq('id', informativoId)
    .eq('criado_por', userId)
    .select()
    .single();

  if (error) throw error;
  return data;
}

async function voteInformativo(userId, informativoId, voto) {
  const fn = 'voteInformativo';

  // Verificar se já votou
  const { data: alreadyVoted } = await sb().rpc('agora_user_voted_informativo', {
    p_user_id: userId,
    p_informativo_id: informativoId,
  });

  if (alreadyVoted) throw new Error('Você já votou neste informativo');

  const { error } = await sb()
    .from('agora_votos_enquete')
    .insert({
      informativo_id: informativoId,
      user_id: userId,  // será hasheado pelo trigger
      voto,
    });

  if (error) throw error;

  gamificationService.triggerEvent('enquete_voted', userId).catch(() => {});
  log(fn, 'Voto em informativo registrado (anônimo)', { informativoId });
  return { success: true };
}

// ── Informativo Likes ────────────────────────────────────────────────────────

async function toggleInformativoLike(userId, informativoId) {
  const fn = 'toggleInformativoLike';

  // Check if already liked
  const { data: existing } = await sb()
    .from('agora_informativo_likes')
    .select('user_id')
    .eq('user_id', userId)
    .eq('informativo_id', informativoId)
    .maybeSingle();

  if (existing) {
    // Unlike
    const { error } = await sb()
      .from('agora_informativo_likes')
      .delete()
      .eq('user_id', userId)
      .eq('informativo_id', informativoId);
    if (error) throw error;
  } else {
    // Like
    const { error } = await sb()
      .from('agora_informativo_likes')
      .insert({ user_id: userId, informativo_id: informativoId });
    if (error) throw error;
    gamificationService.triggerEvent('informativo_liked', userId).catch(() => {});
  }

  // Return updated count
  const { data: informativo } = await sb()
    .from('agora_informativos')
    .select('likes_count')
    .eq('id', informativoId)
    .single();

  const liked = !existing;
  log(fn, liked ? 'Informativo curtido' : 'Curtida removida', { informativoId, userId });
  return { liked, likes_count: informativo?.likes_count || 0 };
}

async function hasUserLikedInformativo(userId, informativoId) {
  const { data } = await sb()
    .from('agora_informativo_likes')
    .select('user_id')
    .eq('user_id', userId)
    .eq('informativo_id', informativoId)
    .maybeSingle();
  return !!data;
}

// ── Stats ───────────────────────────────────────────────────────────────────

async function getRelatoStats(regiaoId) {
  const fn = 'getRelatoStats';
  try {
    const supabase = sb();

    // Total por status
    const { data: relatos } = await supabase
      .from('agora_relatos')
      .select('status')
      .eq('regiao_id', regiaoId);

    const statusCounts = (relatos || []).reduce((acc, r) => {
      acc[r.status] = (acc[r.status] || 0) + 1;
      return acc;
    }, {});

    // Total enquetes
    const { count: enquetesCount } = await supabase
      .from('agora_enquetes')
      .select('id', { count: 'exact', head: true })
      .eq('regiao_id', regiaoId);

    // Total informativos publicados
    const { count: informativosCount } = await supabase
      .from('agora_informativos')
      .select('id', { count: 'exact', head: true })
      .eq('regiao_id', regiaoId)
      .eq('status', 'publicado');

    return {
      relatos: statusCounts,
      total_relatos: relatos?.length || 0,
      total_enquetes: enquetesCount || 0,
      total_informativos: informativosCount || 0,
    };
  } catch (err) {
    logError(fn, err);
    throw err;
  }
}

async function getFeed(regiaoId, filters = {}) {
  const fn = 'getFeed';
  try {
    const page = filters.page || 1;
    const limit = Math.min(filters.limit || 20, 50);
    const from = (page - 1) * limit;

    // Feed unificado: relatos publicados + enquetes abertas + informativos publicados
    const [relatos, enquetes, informativos] = await Promise.all([
      sb().from('agora_relatos')
        .select('id, titulo, categoria, status, assinaturas_count, created_at')
        .eq('regiao_id', regiaoId)
        .in('status', RELATO_PUBLIC_STATUSES)
        .order('created_at', { ascending: false })
        .range(from, from + limit - 1),
      sb().from('agora_enquetes')
        .select('id, pergunta, status, total_votos, encerra_em, created_at')
        .eq('regiao_id', regiaoId)
        .eq('status', 'aberta')
        .order('created_at', { ascending: false })
        .limit(5),
      sb().from('agora_informativos')
        .select('id, titulo, resumo, casa, tags, publicado_em')
        .eq('regiao_id', regiaoId)
        .eq('status', 'publicado')
        .order('publicado_em', { ascending: false })
        .limit(5),
    ]);

    return {
      relatos: relatos.data || [],
      enquetes: enquetes.data || [],
      informativos: informativos.data || [],
    };
  } catch (err) {
    logError(fn, err);
    throw err;
  }
}

// ── Exports ─────────────────────────────────────────────────────────────────

module.exports = {
  // Regiões
  listRegioes,
  createRegiao,
  updateRegiao,
  getRegiaoLog,
  getRegiaoByCoords,
  getRegiaoByCep,
  resolveIbge,
  // Relatos
  classifyPreview,
  createRelato,
  listRelatos,
  getRelato,
  // Assinaturas
  signRelato,
  hasUserSigned,
  getRelatoSignatures,
  // Encaminhamento/Resolução
  registerEncaminhamento,
  registerResolucao,
  // Moderação
  getModerationQueue,
  decideModerationItem,
  escalateModeration,
  overrideModeration,
  // Enquetes
  createEnquete,
  listEnquetes,
  getEnquete,
  voteEnquete,
  hasUserVotedEnquete,
  getEnqueteResults,
  closeEnquete,
  // Informativos
  createInformativo,
  listInformativos,
  getInformativo,
  publishInformativo,
  archiveInformativo,
  voteInformativo,
  toggleInformativoLike,
  hasUserLikedInformativo,
  // Stats/Feed
  getRelatoStats,
  getFeed,
  // Constantes
  TRUST_EVENTS,
};
