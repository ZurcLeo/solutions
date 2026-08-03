// models/Caixinha.js — Supabase-first (migrado de Firestore em 2026-05-19)
const { getSupabaseClient } = require('../config/supabase');
const { getFirestore } = require('../firebaseAdmin');
const Joi = require('joi');
const { logger } = require('../logger');
const { randomUUID } = require('crypto');

const modelCreateSchema = Joi.object({
  name: Joi.string().min(1).required(),
  adminId: Joi.string().required(),
  contribuicaoMensal: Joi.number().min(0).default(0),
  diaVencimento: Joi.number().integer().min(1).max(31).default(1),
  duracaoMeses: Joi.number().integer().min(1).max(120).default(12),
  saldoTotal: Joi.number().min(0).default(0),
  valorMulta: Joi.number().min(0).default(0),
  valorJuros: Joi.number().min(0).default(0),
  permiteEmprestimos: Joi.boolean().default(false),
}).unknown(true);

const modelUpdateSchema = Joi.object({
  name: Joi.string().min(1).optional(),
  contribuicaoMensal: Joi.number().min(0).optional(),
  diaVencimento: Joi.number().integer().min(1).max(31).optional(),
  duracaoMeses: Joi.number().integer().min(1).max(120).optional(),
  saldoTotal: Joi.number().min(0).optional(),
  valorMulta: Joi.number().min(0).optional(),
  valorJuros: Joi.number().min(0).optional(),
  permiteEmprestimos: Joi.boolean().optional(),
}).unknown(true);

const TABLE = 'caixinhas';
const SERVICE = 'caixinhaModel';

function mapCaixinha(row) {
  if (!row) return null;
  return {
    id:                 row.id,
    name:               row.name,
    description:        row.description || null,
    adminId:            row.admin_id,
    contribuicaoMensal: Number(row.contribuicao_mensal) || 0,
    saldoTotal:         Number(row.saldo_total) || 0,
    permiteEmprestimos: row.permite_emprestimos || false,
    diaVencimento:      row.dia_vencimento || 1,
    valorMulta:         Number(row.valor_multa) || 0,
    valorJuros:         Number(row.valor_juros) || 0,
    distribuicaoTipo:   row.distribuicao_tipo || 'padrão',
    duracaoMeses:       row.duracao_meses || 12,
    bankAccountActive:  row.bank_account_active || false,
    bankAccountData:    [],
    governanceModel:    row.governance_model || {
      type: 'GROUP_DISPUTE',
      quorumType: 'PERCENTAGE',
      quorumValue: 51,
      adminHasTiebreaker: true,
      canChangeAfterMembers: false,
    },
    dataCriacao:           row.created_at ? new Date(row.created_at) : new Date(),
    assentos:              row.assentos ?? null,
    concursosHabilitados:  row.concursos_habilitados ?? false,
    allowRifas:            row.allow_rifas ?? false,
    pixKey:                row.pix_key || null,
    members:               row.caixinha_members?.map(m => m.user_id) || [],
    contribuicao:       row.contribuicoes?.map(c => ({ id: c.id })) || [],
    contribuicaoData:   null,
    atividades: [
      ...(row.transacoes?.map(t => ({
        id: t.id,
        tipo: t.tipo,
        valor: t.valor,
        data: t.data,
        usuario: t.users?.full_name || t.user_id
      })) || []),
      ...(row.caixinha_members?.map(m => ({
        id: `member-${m.user_id}`,
        tipo: 'novo_membro',
        data: m.joined_at,
        usuario: m.users?.full_name || m.user_id
      })) || [])
    ].sort((a, b) => new Date(b.data) - new Date(a.data)).slice(0, 20),
  };
}

/** Converte campos camelCase do domínio → snake_case Supabase para UPDATE */
function toRow(data) {
  const row = {};
  if (data.name !== undefined)               row.name = data.name;
  if (data.description !== undefined)        row.description = data.description || null;
  if (data.adminId !== undefined)            row.admin_id = data.adminId;
  if (data.contribuicaoMensal !== undefined) row.contribuicao_mensal = data.contribuicaoMensal;
  if (data.saldoTotal !== undefined)         row.saldo_total = data.saldoTotal;
  if (data.permiteEmprestimos !== undefined) row.permite_emprestimos = data.permiteEmprestimos;
  if (data.diaVencimento !== undefined)      row.dia_vencimento = data.diaVencimento;
  if (data.valorMulta !== undefined)         row.valor_multa = data.valorMulta;
  if (data.valorJuros !== undefined)         row.valor_juros = data.valorJuros;
  if (data.distribuicaoTipo !== undefined)   row.distribuicao_tipo = data.distribuicaoTipo;
  if (data.duracaoMeses !== undefined)       row.duracao_meses = data.duracaoMeses;
  if (data.bankAccountActive !== undefined)  row.bank_account_active = data.bankAccountActive;
  if (data.governanceModel !== undefined)        row.governance_model = data.governanceModel;
  if (data.assentos !== undefined)               row.assentos = data.assentos ?? null;
  if (data.concursosHabilitados !== undefined)   row.concursos_habilitados = data.concursosHabilitados;
  if (data.allowRifas !== undefined)             row.allow_rifas = data.allowRifas;
  if (data.permiteEmprestimos !== undefined)     row.permite_emprestimos = data.permiteEmprestimos;
  if (data.pixKey !== undefined)                 row.pix_key = data.pixKey || null;
  return row;
}

function sb() {
  const client = getSupabaseClient();
  if (!client) throw new Error('Supabase client indisponível');
  return client;
}

class Caixinha {
  constructor(data) {
    this.id                   = data.id || null;
    // Frontend envia 'nome' (legado); DB/QA usam 'name' — aceitar ambos
    this.name                 = data.name || data.nome;
    this.description          = data.description;
    this.adminId              = data.adminId;
    this.members              = data.members || [];
    this.contribuicaoMensal   = data.contribuicaoMensal || 0;
    this.contribuicao         = data.contribuicao || [];
    this.contribuicaoData     = data.contribuicaoData || null;
    this.saldoTotal           = data.saldoTotal || 0;
    this.permiteEmprestimos   = data.permiteEmprestimos || false;
    this.diaVencimento        = data.diaVencimento || 1;
    this.valorMulta           = data.valorMulta || 0;
    this.valorJuros           = data.valorJuros || 0;
    this.distribuicaoTipo     = data.distribuicaoTipo || 'padrão';
    this.duracaoMeses         = data.duracaoMeses || 12;
    this.dataCriacao          = data.dataCriacao ? new Date(data.dataCriacao) : new Date();
    this.bankAccountActive    = data.bankAccountActive || false;
    this.bankAccountData      = data.bankAccountData || [];
    this.governanceModel      = data.governanceModel || {
      type: 'GROUP_DISPUTE',
      quorumType: 'PERCENTAGE',
      quorumValue: 51,
      adminHasTiebreaker: true,
      canChangeAfterMembers: false,
    };
    this.atividades           = data.atividades || [];
    // Novos campos (migration 20260531000001)
    this.assentos             = data.assentos ?? null;
    this.concursosHabilitados = data.concursosHabilitados ?? false;
    this.pixKey               = data.pixKey || null;
  }

  // ── Leitura ─────────────────────────────────────────────────────────────

  static async getAll(userId) {
    logger.info('Buscando caixinhas do usuário', { service: SERVICE, userId });

    try {
      // Resolve IDs via caixinha_members (Supabase)
      const { data: memberRows, error: mErr } = await sb()
        .from('caixinha_members')
        .select('caixinha_id')
        .eq('user_id', userId)
        .eq('active', true);

      if (mErr) throw mErr;

      if (memberRows && memberRows.length > 0) {
        const ids = memberRows.map(r => r.caixinha_id);
        const { data, error } = await sb()
          .from(TABLE)
          .select('*, caixinha_members(user_id, joined_at, users(full_name)), contribuicoes(id), transacoes(*, users(full_name))')
          .in('id', ids);

        if (error) throw error;
        logger.info('Caixinhas recuperadas via Supabase', { service: SERVICE, userId, count: (data || []).length });
        return (data || []).map(row => new Caixinha(mapCaixinha(row)));
      }

      // Fallback Firestore para dados legados ainda não migrados
      logger.warn('Sem caixinhas no Supabase; tentando Firestore (legado)', { service: SERVICE, userId });
      const user = await require('./User').getById(userId).catch(() => null);
      if (!user || !user.caixinhas || user.caixinhas.length === 0) return [];

      const db = getFirestore();
      const caixinhas = [];
      await Promise.all(user.caixinhas.map(id =>
        db.collection('caixinhas').doc(id).get().then(doc => {
          if (doc.exists) caixinhas.push(new Caixinha({ id: doc.id, ...doc.data() }));
        }).catch((err) => { logger.warn('Firestore fallback falhou ao buscar caixinha', { service: SERVICE, caixinhaId: id, error: err.message }); })
      ));
      return caixinhas;
    } catch (error) {
      logger.error('Erro ao buscar caixinhas', { service: SERVICE, userId, error: error.message });
      throw error;
    }
  }

  static async getById(caixinhaId) {
    if (!caixinhaId || typeof caixinhaId !== 'string' || !caixinhaId.trim()) {
      throw new Error('ID da caixinha inválido ou não fornecido.');
    }

    try {
      const { data, error } = await sb()
        .from(TABLE)
        .select('*, caixinha_members(user_id, joined_at, users(full_name)), contribuicoes(id), transacoes(*, users(full_name))')
        .eq('id', caixinhaId)
        .maybeSingle();

      if (error) throw error;
      if (data) return new Caixinha(mapCaixinha(data));

      // Fallback Firestore (dado legado)
      logger.warn('Caixinha não encontrada no Supabase; tentando Firestore', { service: SERVICE, caixinhaId });
      const doc = await getFirestore().collection('caixinhas').doc(caixinhaId).get();
      if (!doc.exists) throw new Error('Caixinha não encontrada.');
      return new Caixinha({ id: doc.id, ...doc.data() });
    } catch (error) {
      logger.error('Erro ao buscar caixinha', { service: SERVICE, caixinhaId, error: error.message });
      throw error;
    }
  }

  // ── Escrita ──────────────────────────────────────────────────────────────

  static async create(data) {
    const { error: vErr } = modelCreateSchema.validate(data);
    if (vErr) throw new Error(vErr.details[0].message);

    const caixinhaId = randomUUID();
    logger.info('Criando nova caixinha', { service: SERVICE, caixinhaId, adminId: data.adminId });

    try {
      const caixinha = new Caixinha(data);

      // Mapeia loanApprovalMethod → governanceModel (compat)
      if (data.loanApprovalMethod && !data.governanceModel) {
        caixinha.governanceModel = data.loanApprovalMethod === 'ADMIN_DECIDES'
          ? { type: 'ADMIN_CONTROL',  quorumType: 'PERCENTAGE', quorumValue: 51, adminHasTiebreaker: true, canChangeAfterMembers: false }
          : { type: 'GROUP_DISPUTE',  quorumType: 'PERCENTAGE', quorumValue: 51, adminHasTiebreaker: true, canChangeAfterMembers: false };
      }

      // 1. UPSERT caixinha (pode existir placeholder "Sincronizando..." se membro foi sincronizado antes)
      const { data: created, error } = await sb()
        .from(TABLE)
        .upsert({
          id:                 caixinhaId,
          name:               caixinha.name,
          description:        caixinha.description || null,
          admin_id:           caixinha.adminId,
          contribuicao_mensal: caixinha.contribuicaoMensal,
          dia_vencimento:     caixinha.diaVencimento,
          duracao_meses:      caixinha.duracaoMeses,
          distribuicao_tipo:  caixinha.distribuicaoTipo,
          permite_emprestimos: caixinha.permiteEmprestimos,
          valor_multa:        caixinha.valorMulta,
          valor_juros:        caixinha.valorJuros,
          governance_model:       caixinha.governanceModel,
          saldo_total:            0,
          assentos:               caixinha.assentos ?? null,
          concursos_habilitados:  caixinha.concursosHabilitados ?? false,
          pix_key:                caixinha.pixKey || null,
        }, { onConflict: 'id' })
        .select()
        .single();

      if (error) throw error;

      // 2. INSERT admin como membro (com compensação se falhar)
      try {
        const Membro = require('./Membro');
        await Membro.create({
          caixinhaId,
          userId:   caixinha.adminId,
          isAdmin:  true,
          active:   true,
          role:     'admin',
          status:   'ativo',
          joinedAt: new Date().toISOString(),
        });
      } catch (membroErr) {
        // Compensação: remove a caixinha criada
        await sb().from(TABLE).delete().eq('id', caixinhaId).catch((err) => { logger.warn('Compensação: falha ao remover caixinha criada', { service: SERVICE, caixinhaId, error: err.message }); });
        throw membroErr;
      }

      // 3. INSERT configuração de empréstimos
      if (caixinha.permiteEmprestimos) {
        const { error: lsErr } = await sb().from('caixinha_loan_settings').insert({
          caixinha_id:             caixinhaId,
          valor_multa:             data.valorMulta || 0,
          valor_juros:             data.valorJuros || 0,
          limite_emprestimo:       data.limiteEmprestimo || 0,
          prazo_maximo_emprestimo: data.prazoMaximoEmprestimo || 12,
          taxa_juros:              data.taxaJuros || 0,
        });
        if (lsErr) logger.warn('Falha ao criar loan settings', { service: SERVICE, error: lsErr.message });
      }

      logger.info('Caixinha criada com sucesso', { service: SERVICE, caixinhaId });
      return new Caixinha(mapCaixinha(created));
    } catch (error) {
      logger.error('Erro ao criar caixinha', { service: SERVICE, error: error.message });
      throw error;
    }
  }

  static async update(id, data) {
    const { error: vErr } = modelUpdateSchema.validate(data);
    if (vErr) throw new Error(vErr.details[0].message);

    logger.info('Atualizando caixinha', { service: SERVICE, caixinhaId: id });

    try {
      const row = toRow(data);
      const { data: updated, error } = await sb()
        .from(TABLE)
        .update(row)
        .eq('id', id)
        .select()
        .single();

      if (error) throw error;

      return new Caixinha(mapCaixinha(updated));
    } catch (error) {
      logger.error('Erro ao atualizar caixinha', { service: SERVICE, caixinhaId: id, error: error.message });
      throw error;
    }
  }

  static async delete(id) {
    logger.info('Excluindo caixinha', { service: SERVICE, caixinhaId: id });

    try {
      const { error } = await sb().from(TABLE).delete().eq('id', id);
      if (error) throw error;
    } catch (error) {
      logger.error('Erro ao excluir caixinha', { service: SERVICE, caixinhaId: id, error: error.message });
      throw error;
    }
  }

  // ── Métodos de instância ─────────────────────────────────────────────────

  async updateGovernanceModel(governanceData) {
    try {
      if (
        this.members.length > 1 &&
        !this.governanceModel.canChangeAfterMembers &&
        governanceData.type !== this.governanceModel.type
      ) {
        throw new Error('Não é permitido alterar o tipo de governança após a adição de membros');
      }
      const updatedModel = { ...this.governanceModel, ...governanceData };
      return await Caixinha.update(this.id, { governanceModel: updatedModel });
    } catch (error) {
      logger.error('Erro ao atualizar governança', { service: SERVICE, caixinhaId: this.id, error: error.message });
      throw error;
    }
  }

  async getContribuicoes() {
    const Contribuicao = require('./Contribuicao');
    return Contribuicao.getByCaixinha(this.id);
  }

  async addContribuicao(contribuicaoData) {
    const Contribuicao = require('./Contribuicao');
    return Contribuicao.create({ ...contribuicaoData, caixinhaId: this.id });
  }

  async updateSaldo(valor, tipo) {
    const novoSaldo = tipo === 'credito' ? this.saldoTotal + valor : this.saldoTotal - valor;
    await Caixinha.update(this.id, { saldoTotal: novoSaldo });
    return novoSaldo;
  }
}

module.exports = Caixinha;
