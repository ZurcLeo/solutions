// src/models/Dispute.js — Supabase-first, Firestore fallback
const { getFirestore } = require('../firebaseAdmin');
const { getSupabaseClient } = require('../config/supabase');
const { logger } = require('../logger');

const CAIXINHAS_COLLECTION = 'caixinhas';
const DISPUTES_SUBCOLLECTION = 'disputes';

// ─── Helpers camelCase ↔ snake_case ────────────────────────────────────────

function toSnakeCase(data) {
  const map = {
    caixinhaId: 'caixinha_id',
    proposedBy: 'proposed_by',
    proposedChanges: 'proposed_changes',
    expiresAt: 'expires_at',
    resolvedAt: 'resolved_at',
    createdAt: 'created_at',
    updatedAt: 'updated_at',
  };
  const result = {};
  for (const [key, value] of Object.entries(data)) {
    const snakeKey = map[key] || key;
    result[snakeKey] = value instanceof Date ? value.toISOString() : value;
  }
  return result;
}

function toCamelCase(row) {
  if (!row) return null;
  return {
    id: row.id,
    caixinhaId: row.caixinha_id,
    title: row.title,
    description: row.description,
    type: row.type,
    proposedBy: row.proposed_by,
    proposedByName: 'Membro da Caixinha',
    proposedChanges: row.proposed_changes || {},
    status: row.status || 'OPEN',
    createdAt: row.created_at,
    expiresAt: row.expires_at,
    resolvedAt: row.resolved_at,
    votes: [],
  };
}

function voteRowToCamel(row) {
  if (!row) return null;
  return {
    id: row.id,
    disputeId: row.dispute_id,
    userId: row.user_id,
    vote: row.vote_type === 'YES',        // compatibilidade legado
    vote_type: row.vote_type,
    comment: row.comment || null,
    timestamp: row.voted_at,
    votedAt: row.voted_at,
  };
}

// ─── Classe Dispute ─────────────────────────────────────────────────────────

class Dispute {
  constructor(data) {
    this.id = data.id;
    this.caixinhaId = data.caixinhaId;
    this.title = data.title;
    this.description = data.description;
    this.type = data.type; // RULE_CHANGE, LOAN_APPROVAL, MEMBER_REMOVAL
    this.proposedBy = data.proposedBy;
    this.proposedByName = data.proposedByName || 'Membro da Caixinha';
    this.proposedChanges = data.proposedChanges || {};
    this.status = data.status || 'OPEN';
    this.createdAt = data.createdAt ? new Date(data.createdAt) : new Date();
    this.expiresAt = data.expiresAt
      ? new Date(data.expiresAt)
      : new Date(Date.now() + 7 * 24 * 60 * 60 * 1000);
    this.resolvedAt = data.resolvedAt ? new Date(data.resolvedAt) : null;
    this.votes = data.votes || [];
  }

  static _getDisputesCollection(caixinhaId) {
    return getFirestore()
      .collection(CAIXINHAS_COLLECTION)
      .doc(caixinhaId)
      .collection(DISPUTES_SUBCOLLECTION);
  }

  // ── create ─────────────────────────────────────────────────────────────────

  static async create(data) {
    logger.info('Criando nova disputa', {
      model: 'Dispute', method: 'create',
      caixinhaId: data.caixinhaId, type: data.type,
    });

    const dispute = new Dispute(data);
    const supabase = getSupabaseClient();

    if (supabase) {
      try {
        const tempId = `disp_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
        const { data: sbRow, error: sbErr } = await supabase
          .from('disputes')
          .insert({
            id: tempId,
            caixinha_id: dispute.caixinhaId,
            title: dispute.title,
            description: dispute.description,
            type: dispute.type,
            proposed_by: dispute.proposedBy,
            proposed_changes: dispute.proposedChanges,
            status: dispute.status,
            expires_at: dispute.expiresAt.toISOString(),
            resolved_at: dispute.resolvedAt ? dispute.resolvedAt.toISOString() : null,
          })
          .select()
          .single();

        if (sbErr) throw sbErr;

        dispute.id = sbRow.id;
        logger.info('Disputa criada no Supabase', { model: 'Dispute', disputeId: dispute.id });

        // Firestore como backup (fire-and-forget)
        setImmediate(async () => {
          try {
            await this._getDisputesCollection(dispute.caixinhaId).doc(dispute.id).set({
              ...dispute,
              createdAt: dispute.createdAt.toISOString(),
              expiresAt: dispute.expiresAt.toISOString(),
              resolvedAt: dispute.resolvedAt ? dispute.resolvedAt.toISOString() : null,
            });
          } catch (fsErr) {
            logger.warn('Backup Firestore da disputa falhou (não crítico)', {
              model: 'Dispute', error: fsErr.message,
            });
          }
        });

        return dispute;
      } catch (sbErr) {
        logger.warn('Supabase falhou ao criar disputa, usando Firestore', {
          model: 'Dispute', error: sbErr.message,
        });
      }
    }

    // Firestore fallback
    const { id: _omit, ...disputeData } = dispute;
    const docRef = await this._getDisputesCollection(dispute.caixinhaId).add({
      ...disputeData,
      createdAt: dispute.createdAt.toISOString(),
      expiresAt: dispute.expiresAt.toISOString(),
      resolvedAt: dispute.resolvedAt ? dispute.resolvedAt.toISOString() : null,
    });
    dispute.id = docRef.id;
    logger.info('Disputa criada no Firestore (fallback)', { model: 'Dispute', disputeId: dispute.id });
    return dispute;
  }

  // ── getById ────────────────────────────────────────────────────────────────

  static async getById(caixinhaId, disputeId) {
    logger.info('Buscando disputa por ID', {
      model: 'Dispute', method: 'getById', disputeId, caixinhaId,
    });

    const supabase = getSupabaseClient();

    if (supabase) {
      try {
        const { data: sbRow, error: sbErr } = await supabase
          .from('disputes')
          .select('*, dispute_votes(*)')
          .eq('id', disputeId)
          .eq('caixinha_id', caixinhaId)
          .maybeSingle();

        if (sbErr) throw sbErr;

        if (sbRow) {
          const camel = toCamelCase(sbRow);
          camel.votes = (sbRow.dispute_votes || []).map(voteRowToCamel);
          logger.info('Disputa recuperada do Supabase', { model: 'Dispute', disputeId });
          return new Dispute(camel);
        }
      } catch (sbErr) {
        logger.warn('Supabase falhou ao buscar disputa, usando Firestore', {
          model: 'Dispute', error: sbErr.message,
        });
      }
    }

    const doc = await this._getDisputesCollection(caixinhaId).doc(disputeId).get();
    if (!doc.exists) {
      throw new Error(`Disputa não encontrada: ${disputeId} na caixinha: ${caixinhaId}`);
    }
    logger.info('Disputa recuperada do Firestore (fallback)', { model: 'Dispute', disputeId });
    return new Dispute({ id: doc.id, ...doc.data(), caixinhaId });
  }

  // ── getByCaixinhaId ────────────────────────────────────────────────────────

  static async getByCaixinhaId(caixinhaId, status) {
    logger.info('Buscando disputas por caixinhaId', {
      model: 'Dispute', method: 'getByCaixinhaId', caixinhaId, status,
    });

    const supabase = getSupabaseClient();

    if (supabase) {
      try {
        let query = supabase
          .from('disputes')
          .select('*, dispute_votes(*)')
          .eq('caixinha_id', caixinhaId);

        if (status === 'active') {
          query = query.eq('status', 'OPEN');
        } else if (status === 'resolved') {
          query = query.in('status', ['APPROVED', 'REJECTED', 'EXPIRED', 'CANCELLED']);
        }

        const { data: rows, error: sbErr } = await query;
        if (sbErr) throw sbErr;

        const disputes = (rows || []).map(row => {
          const camel = toCamelCase(row);
          camel.votes = (row.dispute_votes || []).map(voteRowToCamel);
          return new Dispute(camel);
        });

        logger.info('Disputas recuperadas do Supabase', {
          model: 'Dispute', count: disputes.length,
        });
        return disputes;
      } catch (sbErr) {
        logger.warn('Supabase falhou ao buscar disputas, usando Firestore', {
          model: 'Dispute', error: sbErr.message,
        });
      }
    }

    let query = this._getDisputesCollection(caixinhaId);
    if (status === 'active') {
      query = query.where('status', '==', 'OPEN');
    } else if (status === 'resolved') {
      query = query.where('status', 'in', ['APPROVED', 'REJECTED', 'EXPIRED', 'CANCELLED']);
    }

    const snapshot = await query.get();
    const disputes = [];
    snapshot.forEach(doc => {
      disputes.push(new Dispute({ id: doc.id, ...doc.data(), caixinhaId }));
    });

    logger.info('Disputas recuperadas do Firestore (fallback)', {
      model: 'Dispute', count: disputes.length,
    });
    return disputes;
  }

  // ── addVote ────────────────────────────────────────────────────────────────

  static async addVote(caixinhaId, disputeId, voteData) {
    logger.info('Adicionando voto à disputa', {
      model: 'Dispute', method: 'addVote',
      disputeId, caixinhaId, userId: voteData.userId,
    });

    const supabase = getSupabaseClient();
    const voteType = voteData.vote_type
      || (voteData.vote === true ? 'YES' : voteData.vote === false ? 'NO' : 'ABSTAIN');

    if (supabase) {
      try {
        const { error: sbErr } = await supabase
          .from('dispute_votes')
          .upsert(
            { dispute_id: disputeId, user_id: voteData.userId, vote_type: voteType },
            { onConflict: 'dispute_id,user_id' }
          );

        if (sbErr) throw sbErr;

        logger.info('Voto registrado no Supabase', {
          model: 'Dispute', disputeId, userId: voteData.userId,
        });

        // Retorna disputa atualizada (com votos frescos do Supabase)
        return await this.getById(caixinhaId, disputeId);
      } catch (sbErr) {
        logger.warn('Supabase falhou ao adicionar voto, usando Firestore', {
          model: 'Dispute', error: sbErr.message,
        });
      }
    }

    // Firestore fallback: votos como array no doc da disputa
    const dispute = await this.getById(caixinhaId, disputeId);
    const existingIdx = dispute.votes.findIndex(
      v => (v.userId || v.user_id) === voteData.userId
    );
    const voteEntry = {
      userId: voteData.userId,
      vote: voteData.vote,
      vote_type: voteType,
      comment: voteData.comment || null,
      votedAt: new Date().toISOString(),
    };

    if (existingIdx >= 0) {
      dispute.votes[existingIdx] = { ...dispute.votes[existingIdx], ...voteEntry };
    } else {
      dispute.votes.push(voteEntry);
    }

    return await this.update(caixinhaId, disputeId, { votes: dispute.votes });
  }

  // ── update ─────────────────────────────────────────────────────────────────

  static async update(caixinhaId, disputeId, data) {
    logger.info('Atualizando disputa', {
      model: 'Dispute', method: 'update', disputeId, caixinhaId,
    });

    // Normaliza datas
    const normalizeDate = (v) => v instanceof Date ? v.toISOString() : v;
    const normalizedData = {
      ...data,
      ...(data.createdAt && { createdAt: normalizeDate(data.createdAt) }),
      ...(data.expiresAt && { expiresAt: normalizeDate(data.expiresAt) }),
      ...(data.resolvedAt && { resolvedAt: normalizeDate(data.resolvedAt) }),
    };

    const supabase = getSupabaseClient();

    if (supabase) {
      try {
        // votes ficam em dispute_votes — não atualizar no doc principal do Supabase
        const { votes: _votes, ...rest } = normalizedData;
        const sbPayload = toSnakeCase(rest);

        const { error: sbErr } = await supabase
          .from('disputes')
          .update(sbPayload)
          .eq('id', disputeId)
          .eq('caixinha_id', caixinhaId);

        if (sbErr) throw sbErr;

        logger.info('Disputa atualizada no Supabase', { model: 'Dispute', disputeId });
      } catch (sbErr) {
        logger.warn('Supabase falhou ao atualizar disputa (continua para Firestore)', {
          model: 'Dispute', error: sbErr.message,
        });
      }
    }

    // Backup Firestore fire-and-forget
    try {
      this._getDisputesCollection(caixinhaId).doc(disputeId)
        .update(normalizedData).catch(() => {});
    } catch (_) {}

    logger.info('Disputa atualizada', { model: 'Dispute', disputeId });
    return await this.getById(caixinhaId, disputeId);
  }
}

module.exports = Dispute;
