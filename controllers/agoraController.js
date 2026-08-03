'use strict';

const Joi = require('joi');
const { logger } = require('../logger');
const agoraService = require('../services/agoraService');

const CTRL = 'agoraController';

function uid(req) { return req.user?.uid || req.user?.id; }

function isAdmin(req) {
  return req.user?.isAdmin || req.user?.roles?.some(r => r.roleName === 'admin' && r.validationStatus === 'validated');
}

// ── Regiões ─────────────────────────────────────────────────────────────────

exports.listRegioes = async (req, res) => {
  try {
    const data = await agoraService.listRegioes(req.query);
    return res.status(200).json({ success: true, data });
  } catch (err) {
    logger.error('listRegioes falhou', { service: CTRL, error: err.message });
    return res.status(500).json({ success: false, message: err.message });
  }
};

exports.getRegiaoByCep = async (req, res) => {
  try {
    const { error: vErr } = Joi.object({ cep: Joi.string().pattern(/^\d{5}-?\d{3}$/).required() }).validate(req.query);
    if (vErr) return res.status(400).json({ success: false, message: vErr.details[0].message });

    const result = await agoraService.getRegiaoByCep(req.query.cep);
    return res.status(200).json({ success: true, data: result });
  } catch (err) {
    logger.error('getRegiaoByCep falhou', { service: CTRL, error: err.message });
    return res.status(500).json({ success: false, message: err.message });
  }
};

exports.getRegiaoByGps = async (req, res) => {
  try {
    const { error: vErr } = Joi.object({
      lat: Joi.number().min(-90).max(90).required(),
      lng: Joi.number().min(-180).max(180).required(),
    }).validate(req.query);
    if (vErr) return res.status(400).json({ success: false, message: vErr.details[0].message });

    const data = await agoraService.getRegiaoByCoords(
      Number(req.query.lat),
      Number(req.query.lng),
    );
    return res.status(200).json({ success: true, data });
  } catch (err) {
    logger.error('getRegiaoByGps falhou', { service: CTRL, error: err.message });
    return res.status(500).json({ success: false, message: err.message });
  }
};

const createRegiaoSchema = Joi.object({
  nome: Joi.string().min(2).max(200).required(),
  tipo: Joi.string().valid('comunidade', 'bairro', 'zona', 'municipio').required(),
  pai_id: Joi.string().max(128).allow(null, ''),
  municipio_ibge: Joi.string().max(20).allow(null, ''),
  estado_uf: Joi.string().length(2).allow(null, ''),
  latitude: Joi.number().min(-90).max(90).allow(null),
  longitude: Joi.number().min(-180).max(180).allow(null),
  raio_km: Joi.number().min(0.1).max(100).default(5),
  threshold_relato: Joi.number().integer().min(3).max(500).default(10),
  threshold_enquete: Joi.number().integer().min(3).max(200).default(10),
  canal_oficial: Joi.object().default({}),
  alto_risco: Joi.boolean().default(false),
});

exports.createRegiao = async (req, res) => {
  if (!isAdmin(req)) return res.status(403).json({ success: false, message: 'Apenas admins podem criar regiões' });

  const { error, value } = createRegiaoSchema.validate(req.body);
  if (error) return res.status(400).json({ success: false, message: error.details[0].message });

  try {
    const data = await agoraService.createRegiao(uid(req), value);
    return res.status(201).json({ success: true, data });
  } catch (err) {
    logger.error('createRegiao falhou', { service: CTRL, error: err.message });
    return res.status(500).json({ success: false, message: err.message });
  }
};

const updateRegiaoSchema = Joi.object({
  nome: Joi.string().min(2).max(200),
  threshold_relato: Joi.number().integer().min(3).max(500),
  threshold_enquete: Joi.number().integer().min(3).max(200),
  canal_oficial: Joi.object(),
  alto_risco: Joi.boolean(),
  ativo: Joi.boolean(),
  latitude: Joi.number().min(-90).max(90).allow(null),
  longitude: Joi.number().min(-180).max(180).allow(null),
  raio_km: Joi.number().min(0.1).max(100),
}).min(1);

exports.updateRegiao = async (req, res) => {
  if (!isAdmin(req)) return res.status(403).json({ success: false, message: 'Apenas admins podem editar regiões' });

  const { error, value } = updateRegiaoSchema.validate(req.body);
  if (error) return res.status(400).json({ success: false, message: error.details[0].message });

  try {
    const data = await agoraService.updateRegiao(uid(req), req.params.id, value);
    return res.status(200).json({ success: true, data });
  } catch (err) {
    logger.error('updateRegiao falhou', { service: CTRL, error: err.message });
    return res.status(500).json({ success: false, message: err.message });
  }
};

exports.getRegiaoLog = async (req, res) => {
  if (!isAdmin(req)) return res.status(403).json({ success: false, message: 'Apenas admins podem ver log de regiões' });

  try {
    const data = await agoraService.getRegiaoLog(req.params.id);
    return res.status(200).json({ success: true, data });
  } catch (err) {
    logger.error('getRegiaoLog falhou', { service: CTRL, error: err.message });
    return res.status(500).json({ success: false, message: err.message });
  }
};

// ── Classificação Preview ───────────────────────────────────────────────────

const classifySchema = Joi.object({
  titulo: Joi.string().min(5).max(500).required(),
  descricao: Joi.string().min(10).max(5000).required(),
  municipio_ibge: Joi.string().max(20).allow(null, ''),
});

exports.classifyPreview = async (req, res) => {
  const { error, value } = classifySchema.validate(req.body);
  if (error) return res.status(400).json({ success: false, message: error.details[0].message });

  try {
    const result = await agoraService.classifyPreview(value.titulo, value.descricao, value.municipio_ibge);

    // D8: se blocked, retorna canais de proteção
    if (result.blocked) {
      return res.status(200).json({ success: true, data: result });
    }

    return res.status(200).json({ success: true, data: result });
  } catch (err) {
    logger.error('classifyPreview falhou', { service: CTRL, error: err.message });
    return res.status(500).json({ success: false, message: err.message });
  }
};

// ── Relatos ─────────────────────────────────────────────────────────────────

const createRelatoSchema = Joi.object({
  regiao_id: Joi.string().min(1).max(128).required(),
  titulo: Joi.string().min(5).max(500).required(),
  descricao: Joi.string().min(10).max(5000).required(),
  categoria: Joi.string().valid(
    'infraestrutura', 'saude', 'educacao', 'seguranca_publica',
    'meio_ambiente', 'transporte', 'iluminacao', 'saneamento',
    'acessibilidade', 'cultura_lazer', 'habitacao', 'outros'
  ).allow(null),
  criado_por_nome_pub: Joi.boolean().default(true),
  imagens: Joi.array().items(Joi.string().uri()).max(5).default([]),
  localizacao_lat: Joi.number().min(-90).max(90).allow(null),
  localizacao_lng: Joi.number().min(-180).max(180).allow(null),
  endereco_texto: Joi.string().max(500).allow(null, ''),
  municipio_ibge: Joi.string().max(20).allow(null, ''),
  classificacao: Joi.any().strip(),
});

exports.createRelato = async (req, res) => {
  const { error, value } = createRelatoSchema.validate(req.body);
  if (error) return res.status(400).json({ success: false, message: error.details[0].message });

  try {
    const result = await agoraService.createRelato(uid(req), value);

    // D8: blocked content returns safety channels
    if (result.blocked) {
      return res.status(200).json({ success: true, data: result });
    }

    return res.status(201).json({ success: true, data: result });
  } catch (err) {
    logger.error('createRelato falhou', { service: CTRL, error: err.message });
    return res.status(500).json({ success: false, message: err.message });
  }
};

exports.listRelatos = async (req, res) => {
  try {
    const data = await agoraService.listRelatos(req.query.regiao_id, req.query);
    return res.status(200).json({ success: true, data });
  } catch (err) {
    logger.error('listRelatos falhou', { service: CTRL, error: err.message });
    return res.status(500).json({ success: false, message: err.message });
  }
};

exports.getRelato = async (req, res) => {
  try {
    const data = await agoraService.getRelato(req.params.id);
    if (!data) return res.status(404).json({ success: false, message: 'Relato não encontrado' });
    return res.status(200).json({ success: true, data });
  } catch (err) {
    logger.error('getRelato falhou', { service: CTRL, error: err.message });
    return res.status(500).json({ success: false, message: err.message });
  }
};

// ── Assinaturas ─────────────────────────────────────────────────────────────

const signSchema = Joi.object({
  nome_completo: Joi.string().min(3).max(200).required(),
  cpf_mascarado: Joi.string().pattern(/^XXX\.XXX\.\d{3}-\d{2}$/).required(),
  regiao_id: Joi.string().max(128).allow(null, ''),
});

exports.signRelato = async (req, res) => {
  const { error, value } = signSchema.validate(req.body);
  if (error) return res.status(400).json({ success: false, message: error.details[0].message });

  try {
    const data = await agoraService.signRelato(
      uid(req), req.params.id, value.nome_completo, value.cpf_mascarado, value.regiao_id
    );
    return res.status(201).json({ success: true, data });
  } catch (err) {
    if (err.message.includes('já assinou')) return res.status(409).json({ success: false, message: err.message });
    logger.error('signRelato falhou', { service: CTRL, error: err.message });
    return res.status(500).json({ success: false, message: err.message });
  }
};

exports.hasUserSigned = async (req, res) => {
  try {
    const signed = await agoraService.hasUserSigned(uid(req), req.params.id);
    return res.status(200).json({ success: true, data: { signed } });
  } catch (err) {
    logger.error('hasUserSigned falhou', { service: CTRL, error: err.message });
    return res.status(500).json({ success: false, message: err.message });
  }
};

exports.getManifesto = async (req, res) => {
  try {
    const relato = await agoraService.getRelato(req.params.id);
    if (!relato) return res.status(404).json({ success: false, message: 'Relato não encontrado' });

    const signatures = await agoraService.getRelatoSignatures(req.params.id);

    return res.status(200).json({
      success: true,
      data: {
        relato: {
          id: relato.id,
          titulo: relato.titulo,
          descricao: relato.descricao,
          categoria: relato.categoria,
          assinaturas_count: relato.assinaturas_count,
          created_at: relato.created_at,
        },
        assinantes: signatures.map(s => ({
          nome_completo: s.nome_completo,
          cpf_mascarado: s.cpf_mascarado,
          assinado_em: s.created_at,
        })),
      },
    });
  } catch (err) {
    logger.error('getManifesto falhou', { service: CTRL, error: err.message });
    return res.status(500).json({ success: false, message: err.message });
  }
};

// ── Encaminhamento/Resolução ────────────────────────────────────────────────

const encaminhamentoSchema = Joi.object({
  orgao: Joi.string().min(2).max(300).required(),
  protocolo: Joi.string().min(1).max(100).required(),
});

exports.registerEncaminhamento = async (req, res) => {
  const { error, value } = encaminhamentoSchema.validate(req.body);
  if (error) return res.status(400).json({ success: false, message: error.details[0].message });

  try {
    const data = await agoraService.registerEncaminhamento(uid(req), req.params.id, value.orgao, value.protocolo);
    return res.status(200).json({ success: true, data });
  } catch (err) {
    logger.error('registerEncaminhamento falhou', { service: CTRL, error: err.message });
    return res.status(500).json({ success: false, message: err.message });
  }
};

const resolucaoSchema = Joi.object({
  descricao: Joi.string().min(10).max(2000).required(),
  evidencia_url: Joi.string().uri().allow(null, ''),
});

exports.registerResolucao = async (req, res) => {
  const { error, value } = resolucaoSchema.validate(req.body);
  if (error) return res.status(400).json({ success: false, message: error.details[0].message });

  try {
    const data = await agoraService.registerResolucao(uid(req), req.params.id, value.descricao, value.evidencia_url);
    return res.status(200).json({ success: true, data });
  } catch (err) {
    logger.error('registerResolucao falhou', { service: CTRL, error: err.message });
    return res.status(500).json({ success: false, message: err.message });
  }
};

// ── Moderação ───────────────────────────────────────────────────────────────

exports.getModerationQueue = async (req, res) => {
  try {
    const data = await agoraService.getModerationQueue(uid(req), isAdmin(req));
    return res.status(200).json({ success: true, data });
  } catch (err) {
    logger.error('getModerationQueue falhou', { service: CTRL, error: err.message });
    return res.status(500).json({ success: false, message: err.message });
  }
};

const moderationSchema = Joi.object({
  decision: Joi.string().valid('aprovado', 'rejeitado', 'escalado').required(),
  motivo: Joi.string().max(1000).allow(null, ''),
});

exports.moderateRelato = async (req, res) => {
  const { error, value } = moderationSchema.validate(req.body);
  if (error) return res.status(400).json({ success: false, message: error.details[0].message });

  try {
    const data = await agoraService.decideModerationItem(uid(req), req.params.id, value.decision, value.motivo);
    return res.status(200).json({ success: true, data });
  } catch (err) {
    logger.error('moderateRelato falhou', { service: CTRL, error: err.message });
    return res.status(500).json({ success: false, message: err.message });
  }
};

exports.overrideModeration = async (req, res) => {
  if (!isAdmin(req)) return res.status(403).json({ success: false, message: 'Apenas admins podem fazer override' });

  const { error, value } = moderationSchema.validate(req.body);
  if (error) return res.status(400).json({ success: false, message: error.details[0].message });

  try {
    const data = await agoraService.overrideModeration(uid(req), req.params.id, value.decision, value.motivo);
    return res.status(200).json({ success: true, data });
  } catch (err) {
    logger.error('overrideModeration falhou', { service: CTRL, error: err.message });
    return res.status(500).json({ success: false, message: err.message });
  }
};

// ── Enquetes ────────────────────────────────────────────────────────────────

const createEnqueteSchema = Joi.object({
  regiao_id: Joi.string().max(128).allow(null, ''),
  pergunta: Joi.string().min(5).max(500).required(),
  descricao: Joi.string().max(2000).allow(null, ''),
  opcoes: Joi.array().items(Joi.object({
    id: Joi.string().min(1).max(10).required(),
    texto: Joi.string().min(1).max(200).required(),
  })).min(2).max(10).required(),
  encerra_em: Joi.date().iso().allow(null),
});

exports.createEnquete = async (req, res) => {
  const { error, value } = createEnqueteSchema.validate(req.body);
  if (error) return res.status(400).json({ success: false, message: error.details[0].message });

  try {
    const data = await agoraService.createEnquete(uid(req), value);
    return res.status(201).json({ success: true, data });
  } catch (err) {
    if (err.message.includes('Trust Level')) return res.status(403).json({ success: false, message: err.message });
    logger.error('createEnquete falhou', { service: CTRL, error: err.message });
    return res.status(500).json({ success: false, message: err.message });
  }
};

exports.listEnquetes = async (req, res) => {
  try {
    const data = await agoraService.listEnquetes(req.query.regiao_id, req.query);
    return res.status(200).json({ success: true, data });
  } catch (err) {
    logger.error('listEnquetes falhou', { service: CTRL, error: err.message });
    return res.status(500).json({ success: false, message: err.message });
  }
};

exports.getEnquete = async (req, res) => {
  try {
    const data = await agoraService.getEnquete(req.params.id, uid(req));
    if (!data) return res.status(404).json({ success: false, message: 'Enquete não encontrada' });
    return res.status(200).json({ success: true, data });
  } catch (err) {
    logger.error('getEnquete falhou', { service: CTRL, error: err.message });
    return res.status(500).json({ success: false, message: err.message });
  }
};

const voteEnqueteSchema = Joi.object({
  opcao_id: Joi.string().min(1).max(10).required(),
});

exports.voteEnquete = async (req, res) => {
  const { error, value } = voteEnqueteSchema.validate(req.body);
  if (error) return res.status(400).json({ success: false, message: error.details[0].message });

  try {
    const data = await agoraService.voteEnquete(uid(req), req.params.id, value.opcao_id);
    return res.status(201).json({ success: true, data });
  } catch (err) {
    if (err.message.includes('já votou')) return res.status(409).json({ success: false, message: err.message });
    logger.error('voteEnquete falhou', { service: CTRL, error: err.message });
    return res.status(500).json({ success: false, message: err.message });
  }
};

exports.hasVotedEnquete = async (req, res) => {
  try {
    const voted = await agoraService.hasUserVotedEnquete(uid(req), req.params.id);
    return res.status(200).json({ success: true, data: { voted } });
  } catch (err) {
    logger.error('hasVotedEnquete falhou', { service: CTRL, error: err.message });
    return res.status(500).json({ success: false, message: err.message });
  }
};

exports.getEnqueteResults = async (req, res) => {
  try {
    const data = await agoraService.getEnqueteResults(req.params.id);
    return res.status(200).json({ success: true, data });
  } catch (err) {
    logger.error('getEnqueteResults falhou', { service: CTRL, error: err.message });
    return res.status(500).json({ success: false, message: err.message });
  }
};

exports.closeEnquete = async (req, res) => {
  try {
    const data = await agoraService.closeEnquete(uid(req), req.params.id);
    return res.status(200).json({ success: true, data });
  } catch (err) {
    logger.error('closeEnquete falhou', { service: CTRL, error: err.message });
    return res.status(500).json({ success: false, message: err.message });
  }
};

// ── Informativos ────────────────────────────────────────────────────────────

const createInformativoSchema = Joi.object({
  regiao_id: Joi.string().max(128).allow(null, ''),
  titulo: Joi.string().min(5).max(500).required(),
  resumo: Joi.string().min(10).max(1000).required(),
  conteudo: Joi.string().min(20).max(10000).required(),
  fonte_url: Joi.string().uri().required(),
  casa: Joi.string().valid('camara', 'senado', 'assembleia', 'camara_municipal', 'executivo', 'judiciario').allow(null),
  tags: Joi.array().items(Joi.string().max(50)).max(10).default([]),
});

exports.createInformativo = async (req, res) => {
  const { error, value } = createInformativoSchema.validate(req.body);
  if (error) return res.status(400).json({ success: false, message: error.details[0].message });

  try {
    const data = await agoraService.createInformativo(uid(req), value);
    return res.status(201).json({ success: true, data });
  } catch (err) {
    if (err.message.includes('Trust Level')) return res.status(403).json({ success: false, message: err.message });
    logger.error('createInformativo falhou', { service: CTRL, error: err.message });
    return res.status(500).json({ success: false, message: err.message });
  }
};

exports.listInformativos = async (req, res) => {
  try {
    const data = await agoraService.listInformativos(req.query.regiao_id, req.query);
    return res.status(200).json({ success: true, data });
  } catch (err) {
    logger.error('listInformativos falhou', { service: CTRL, error: err.message });
    return res.status(500).json({ success: false, message: err.message });
  }
};

exports.getInformativo = async (req, res) => {
  try {
    const data = await agoraService.getInformativo(req.params.id);
    if (!data) return res.status(404).json({ success: false, message: 'Informativo não encontrado' });
    return res.status(200).json({ success: true, data });
  } catch (err) {
    logger.error('getInformativo falhou', { service: CTRL, error: err.message });
    return res.status(500).json({ success: false, message: err.message });
  }
};

exports.publishInformativo = async (req, res) => {
  try {
    const data = await agoraService.publishInformativo(uid(req), req.params.id);
    return res.status(200).json({ success: true, data });
  } catch (err) {
    logger.error('publishInformativo falhou', { service: CTRL, error: err.message });
    return res.status(500).json({ success: false, message: err.message });
  }
};

exports.archiveInformativo = async (req, res) => {
  try {
    const data = await agoraService.archiveInformativo(uid(req), req.params.id);
    return res.status(200).json({ success: true, data });
  } catch (err) {
    logger.error('archiveInformativo falhou', { service: CTRL, error: err.message });
    return res.status(500).json({ success: false, message: err.message });
  }
};

const voteInformativoSchema = Joi.object({
  voto: Joi.string().valid('relevante', 'irrelevante', 'neutro').required(),
});

exports.voteInformativo = async (req, res) => {
  const { error, value } = voteInformativoSchema.validate(req.body);
  if (error) return res.status(400).json({ success: false, message: error.details[0].message });

  try {
    const data = await agoraService.voteInformativo(uid(req), req.params.id, value.voto);
    return res.status(201).json({ success: true, data });
  } catch (err) {
    if (err.message.includes('já votou')) return res.status(409).json({ success: false, message: err.message });
    logger.error('voteInformativo falhou', { service: CTRL, error: err.message });
    return res.status(500).json({ success: false, message: err.message });
  }
};

// ── Informativo Likes ────────────────────────────────────────────────────────

exports.toggleInformativoLike = async (req, res) => {
  try {
    const data = await agoraService.toggleInformativoLike(uid(req), req.params.id);
    return res.status(200).json({ success: true, data });
  } catch (err) {
    logger.error('toggleInformativoLike falhou', { service: CTRL, error: err.message });
    return res.status(500).json({ success: false, message: err.message });
  }
};

exports.hasUserLikedInformativo = async (req, res) => {
  try {
    const liked = await agoraService.hasUserLikedInformativo(uid(req), req.params.id);
    return res.status(200).json({ success: true, data: { liked } });
  } catch (err) {
    logger.error('hasUserLikedInformativo falhou', { service: CTRL, error: err.message });
    return res.status(500).json({ success: false, message: err.message });
  }
};

// ── Stats/Feed ──────────────────────────────────────────────────────────────

exports.getStats = async (req, res) => {
  try {
    const data = await agoraService.getRelatoStats(req.params.regiaoId);
    return res.status(200).json({ success: true, data });
  } catch (err) {
    logger.error('getStats falhou', { service: CTRL, error: err.message });
    return res.status(500).json({ success: false, message: err.message });
  }
};

exports.getFeed = async (req, res) => {
  try {
    const data = await agoraService.getFeed(req.params.regiaoId, req.query);
    return res.status(200).json({ success: true, data });
  } catch (err) {
    logger.error('getFeed falhou', { service: CTRL, error: err.message });
    return res.status(500).json({ success: false, message: err.message });
  }
};
