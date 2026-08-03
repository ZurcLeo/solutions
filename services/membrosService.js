// src/services/membrosService.js
const { logger } = require('../logger');
const { getSupabaseClient } = require('../config/supabase');
const { randomUUID } = require('crypto');
const Membro = require('../models/Membro');

// Firestore como backup fire-and-forget durante a transição
const { getFirestore } = require('../firebaseAdmin');

// Lazy Firestore proxy (usado apenas como fallback)
const db = new Proxy({}, { get(_, k) { const d = getFirestore(); return typeof d[k] === 'function' ? d[k].bind(d) : d[k]; } });

const sb = () => getSupabaseClient();

// ─── Validações ───────────────────────────────────────────────────────────────

exports.validarTransicaoStatus = (statusAtual, novoStatus) => {
  const transicoesValidas = {
    'ativo': ['suspenso', 'inativo'],
    'suspenso': ['ativo', 'inativo'],
    'inativo': ['ativo'],
    'pendente': ['ativo', 'inativo']
  };
  return transicoesValidas[statusAtual]?.includes(novoStatus) || false;
};

// ─── adicionarMembro ──────────────────────────────────────────────────────────

exports.adicionarMembro = async (caixinhaId, dados) => {
  logger.info('Adicionando novo membro à caixinha', {
    service: 'MembrosService', method: 'adicionarMembro', caixinhaId, userId: dados.userId
  });

  try {
    const supabase = sb();

    if (supabase) {
      // Verificar se já é membro
      const { data: existing } = await supabase
        .from('caixinha_members')
        .select('id')
        .eq('caixinha_id', caixinhaId)
        .eq('user_id', dados.userId)
        .maybeSingle();

      if (existing) throw new Error('Usuário já é membro desta caixinha');

      const membroId = randomUUID();
      const { error } = await supabase
        .from('caixinha_members')
        .insert({
          id: membroId,
          caixinha_id: caixinhaId,
          user_id: dados.userId,
          role: dados.role || 'membro',
          status: 'ativo',
          active: true,
          is_admin: dados.role === 'admin',
          joined_at: new Date().toISOString()
        });

      if (error) throw new Error(`Supabase caixinha_members insert: ${error.message}`);

      // Backup Firestore fire-and-forget
      try {
        const batch = db.batch();
        const membroRef = db.collection('caixinhas').doc(caixinhaId).collection('membros').doc(membroId);
        const caixinhaRef = db.collection('caixinhas').doc(caixinhaId);
        const { FieldValue } = require('../firebaseAdmin');
        batch.set(membroRef, { ...dados, dataEntrada: new Date(), status: 'ativo', contribuicoes: [], emprestimos: [] });
        batch.update(caixinhaRef, { totalMembros: FieldValue.increment(1), dataUltimaAtualizacao: new Date() });
        const usuarioRef = db.collection('usuario').doc(dados.userId);
        const usuarioDoc = await usuarioRef.get();
        if (usuarioDoc.exists) {
          const caixinhasArr = usuarioDoc.data().caixinhas || [];
          if (!caixinhasArr.includes(caixinhaId)) {
            batch.update(usuarioRef, { caixinhas: [...caixinhasArr, caixinhaId] });
          }
        }
        batch.commit().catch(() => {});
      } catch (_) {}

      logger.info('Membro adicionado com sucesso (Supabase)', { service: 'MembrosService', caixinhaId, membroId });
      return { success: true, membroId, message: 'Membro adicionado com sucesso' };
    }

    // Fallback Firestore completo
    const batch = db.batch();
    const membroExistente = await db.collection('caixinhas').doc(caixinhaId).collection('membros')
      .where('userId', '==', dados.userId).get();
    if (!membroExistente.empty) throw new Error('Usuário já é membro desta caixinha');

    const membroRef = db.collection('caixinhas').doc(caixinhaId).collection('membros').doc();
    const { FieldValue } = require('../firebaseAdmin');
    batch.set(membroRef, { ...dados, dataEntrada: new Date(), status: 'ativo', contribuicoes: [], emprestimos: [] });
    batch.update(db.collection('caixinhas').doc(caixinhaId), {
      totalMembros: FieldValue.increment(1), dataUltimaAtualizacao: new Date()
    });
    const usuarioRef = db.collection('usuario').doc(dados.userId);
    const usuarioDoc = await usuarioRef.get();
    if (!usuarioDoc.exists) throw new Error('Usuário não encontrado');
    const caixinhasArr = usuarioDoc.data().caixinhas || [];
    if (!caixinhasArr.includes(caixinhaId)) {
      batch.update(usuarioRef, { caixinhas: [...caixinhasArr, caixinhaId] });
    }
    await batch.commit();
    return { success: true, membroId: membroRef.id, message: 'Membro adicionado com sucesso' };

  } catch (error) {
    logger.error('Erro ao adicionar membro', { service: 'MembrosService', caixinhaId, userId: dados.userId, error: error.message });
    throw error;
  }
};

// ─── getMembros ───────────────────────────────────────────────────────────────

exports.getMembros = async (caixinhaId, filtros = {}) => {
  logger.info('Buscando membros da caixinha', {
    service: 'MembrosService', method: 'getMembros', caixinhaId, filtros
  });

  try {
    const supabase = sb();

    if (supabase) {
      let query = supabase
        .from('caixinha_members')
        .select('*')
        .eq('caixinha_id', caixinhaId);

      if (filtros.status) query = query.eq('status', filtros.status);
      if (filtros.role) query = query.eq('role', filtros.role);

      const { data, error } = await query;
      if (!error && data) {
        const membros = data.map(row => ({
          id: row.id,
          userId: row.user_id,
          caixinhaId: row.caixinha_id,
          role: row.role,
          status: row.status,
          active: row.active,
          isAdmin: row.is_admin,
          dataEntrada: row.joined_at,
          ...row
        }));
        logger.info('Membros recuperados (Supabase)', { service: 'MembrosService', count: membros.length });
        return membros;
      }
      logger.warn('Supabase getMembros erro, fallback Firestore', { error: error?.message });
    }

    // Fallback Firestore
    let query = db.collection('caixinhas').doc(caixinhaId).collection('membros');
    if (filtros.status) query = query.where('status', '==', filtros.status);
    if (filtros.role) query = query.where('role', '==', filtros.role);
    const snapshot = await query.get();
    return snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() }));

  } catch (error) {
    logger.error('Erro ao buscar membros', { service: 'MembrosService', caixinhaId, error: error.message });
    throw error;
  }
};

// ─── atualizarStatusMembro ────────────────────────────────────────────────────

exports.atualizarStatusMembro = async (caixinhaId, membroId, novoStatus, motivo) => {
  logger.info('Atualizando status do membro', {
    service: 'MembrosService', method: 'atualizarStatusMembro', caixinhaId, membroId, novoStatus
  });

  try {
    const supabase = sb();

    if (supabase) {
      const { data: membro, error: errBusca } = await supabase
        .from('caixinha_members')
        .select('status, user_id')
        .eq('id', membroId)
        .eq('caixinha_id', caixinhaId)
        .maybeSingle();

      if (errBusca || !membro) throw new Error('Membro não encontrado');

      if (!exports.validarTransicaoStatus(membro.status, novoStatus)) {
        throw new Error(`Transição de status inválida: ${membro.status} -> ${novoStatus}`);
      }

      const { error: errUpdate } = await supabase
        .from('caixinha_members')
        .update({
          status: novoStatus,
          active: novoStatus === 'ativo'
        })
        .eq('id', membroId);

      if (errUpdate) throw new Error(`Supabase status update: ${errUpdate.message}`);

      // Backup Firestore fire-and-forget
      try {
        const { FieldValue } = require('../firebaseAdmin');
        const membroRef = db.collection('caixinhas').doc(caixinhaId).collection('membros').doc(membroId);
        const membroDoc = await membroRef.get();
        if (membroDoc.exists) {
          const membroData = membroDoc.data();
          const batch = db.batch();
          batch.update(membroRef, {
            status: novoStatus, dataAtualizacao: new Date(), motivoMudancaStatus: motivo || null,
            historicoStatus: FieldValue.arrayUnion({ de: membroData.status, para: novoStatus, data: new Date(), motivo: motivo || null })
          });
          if (novoStatus === 'inativo') {
            const userRef = db.collection('usuario').doc(membro.user_id);
            const userDoc = await userRef.get();
            if (userDoc.exists) {
              const caixinhasArr = userDoc.data().caixinhas || [];
              if (caixinhasArr.includes(caixinhaId)) {
                batch.update(userRef, { caixinhas: caixinhasArr.filter(id => id !== caixinhaId) });
              }
            }
          }
          batch.commit().catch(() => {});
        }
      } catch (_) {}

      return { success: true, message: 'Status do membro atualizado com sucesso', novoStatus };
    }

    // Fallback Firestore completo
    const { FieldValue } = require('../firebaseAdmin');
    const batch = db.batch();
    const membroRef = db.collection('caixinhas').doc(caixinhaId).collection('membros').doc(membroId);
    const membroDoc = await membroRef.get();
    if (!membroDoc.exists) throw new Error('Membro não encontrado');
    const membroData = membroDoc.data();
    if (!exports.validarTransicaoStatus(membroData.status, novoStatus)) {
      throw new Error(`Transição de status inválida: ${membroData.status} -> ${novoStatus}`);
    }
    batch.update(membroRef, {
      status: novoStatus, dataAtualizacao: new Date(), motivoMudancaStatus: motivo || null,
      historicoStatus: FieldValue.arrayUnion({ de: membroData.status, para: novoStatus, data: new Date(), motivo: motivo || null })
    });
    if (novoStatus === 'inativo') {
      const userRef = db.collection('usuario').doc(membroData.userId);
      const userDoc = await userRef.get();
      if (userDoc.exists) {
        const caixinhasArr = userDoc.data().caixinhas || [];
        if (caixinhasArr.includes(caixinhaId)) {
          batch.update(userRef, { caixinhas: caixinhasArr.filter(id => id !== caixinhaId) });
        }
      }
    }
    await batch.commit();
    return { success: true, message: 'Status do membro atualizado com sucesso', novoStatus };

  } catch (error) {
    logger.error('Erro ao atualizar status do membro', { service: 'MembrosService', caixinhaId, membroId, error: error.message });
    throw error;
  }
};

// ─── verificarPendenciasMembro ────────────────────────────────────────────────

exports.verificarPendenciasMembro = async (caixinhaId, membroId) => {
  const pendencias = [];
  const supabase = sb();

  // Verifica empréstimos ativos via Supabase
  if (supabase) {
    const { data: membros } = await supabase
      .from('caixinha_members')
      .select('user_id')
      .eq('id', membroId)
      .eq('caixinha_id', caixinhaId)
      .maybeSingle();

    if (membros?.user_id) {
      const { data: emp } = await supabase
        .from('emprestimos')
        .select('id')
        .eq('caixinha_id', caixinhaId)
        .eq('user_id', membros.user_id)
        .in('status', ['aprovado', 'pendente'])
        .limit(1);
      if (emp && emp.length > 0) pendencias.push('empréstimos ativos');
    }
  } else {
    const emprestimos = await db.collection('caixinhas').doc(caixinhaId).collection('emprestimos')
      .where('membroId', '==', membroId).where('status', 'in', ['ativo', 'pendente']).get();
    if (!emprestimos.empty) pendencias.push('empréstimos ativos');
  }

  const contribCheck = await exports.verificarContribuicoesPendentes(caixinhaId, membroId);
  if (contribCheck.pendentes) pendencias.push('contribuições pendentes');

  return pendencias;
};

// ─── verificarContribuicoesPendentes ─────────────────────────────────────────

exports.verificarContribuicoesPendentes = async (caixinhaId, membroId) => {
  const hoje = new Date();
  const inicioMes = new Date(hoje.getFullYear(), hoje.getMonth(), 1);

  const supabase = sb();
  if (supabase) {
    // Resolve user_id do membroId (que pode ser o id da linha ou o user_id)
    const { data: memberRow } = await supabase
      .from('caixinha_members')
      .select('user_id')
      .or(`id.eq.${membroId},user_id.eq.${membroId}`)
      .eq('caixinha_id', caixinhaId)
      .maybeSingle();

    const userId = memberRow?.user_id || membroId;

    const { data: contribs } = await supabase
      .from('contribuicoes')
      .select('id, data_contribuicao')
      .eq('caixinha_id', caixinhaId)
      .eq('user_id', userId)
      .gte('data_contribuicao', inicioMes.toISOString())
      .neq('status', 'estornada')
      .limit(1);

    return {
      pendentes: !contribs || contribs.length === 0,
      ultimaContribuicao: contribs?.[0]?.data_contribuicao
    };
  }

  // Fallback Firestore
  const contribuicoes = await db.collection('caixinhas').doc(caixinhaId).collection('contribuicoes')
    .where('membroId', '==', membroId).where('dataContribuicao', '>=', inicioMes).get();
  return {
    pendentes: contribuicoes.empty,
    ultimaContribuicao: contribuicoes.docs[0]?.data().dataContribuicao
  };
};

// ─── removerMembro ────────────────────────────────────────────────────────────

exports.removerMembro = async (caixinhaId, membroId, motivo) => {
  logger.info('Iniciando remoção de membro', {
    service: 'MembrosService', method: 'removerMembro', caixinhaId, membroId, motivo
  });

  try {
    const pendencias = await exports.verificarPendenciasMembro(caixinhaId, membroId);
    if (pendencias.length > 0) throw new Error(`Membro possui pendências: ${pendencias.join(', ')}`);

    const supabase = sb();

    if (supabase) {
      const { data: membro, error: errBusca } = await supabase
        .from('caixinha_members')
        .select('user_id, status')
        .eq('id', membroId)
        .eq('caixinha_id', caixinhaId)
        .maybeSingle();

      if (errBusca || !membro) throw new Error('Membro não encontrado');

      const { error } = await supabase
        .from('caixinha_members')
        .update({ status: 'inativo', active: false })
        .eq('id', membroId);

      if (error) throw new Error(`Supabase removerMembro: ${error.message}`);

      // Backup Firestore fire-and-forget
      try {
        const { FieldValue } = require('../firebaseAdmin');
        const batch = db.batch();
        const membroRef = db.collection('caixinhas').doc(caixinhaId).collection('membros').doc(membroId);
        const membroDoc = await membroRef.get();
        if (membroDoc.exists) {
          const membroData = membroDoc.data();
          batch.update(membroRef, {
            status: 'inativo', dataSaida: new Date(), motivoSaida: motivo,
            historicoStatus: FieldValue.arrayUnion({ de: membroData.status, para: 'inativo', data: new Date(), motivo })
          });
          batch.update(db.collection('caixinhas').doc(caixinhaId), {
            totalMembros: FieldValue.increment(-1), membrosInativos: FieldValue.increment(1), dataUltimaAtualizacao: new Date()
          });
          const userRef = db.collection('usuario').doc(membro.user_id);
          const userDoc = await userRef.get();
          if (userDoc.exists) {
            const caixinhasArr = userDoc.data().caixinhas || [];
            if (caixinhasArr.includes(caixinhaId)) {
              batch.update(userRef, { caixinhas: caixinhasArr.filter(id => id !== caixinhaId) });
            }
          }
          batch.commit().catch(() => {});
        }
      } catch (_) {}

      return { success: true, message: 'Membro removido com sucesso' };
    }

    // Fallback Firestore completo
    const { FieldValue } = require('../firebaseAdmin');
    const batch = db.batch();
    const membroRef = db.collection('caixinhas').doc(caixinhaId).collection('membros').doc(membroId);
    const membroDoc = await membroRef.get();
    if (!membroDoc.exists) throw new Error('Membro não encontrado');
    const membroData = membroDoc.data();
    batch.update(membroRef, {
      status: 'inativo', dataSaida: new Date(), motivoSaida: motivo,
      historicoStatus: FieldValue.arrayUnion({ de: membroData.status, para: 'inativo', data: new Date(), motivo })
    });
    batch.update(db.collection('caixinhas').doc(caixinhaId), {
      totalMembros: FieldValue.increment(-1), membrosInativos: FieldValue.increment(1), dataUltimaAtualizacao: new Date()
    });
    const userRef = db.collection('usuario').doc(membroData.userId);
    const userDoc = await userRef.get();
    if (userDoc.exists) {
      const caixinhasArr = userDoc.data().caixinhas || [];
      if (caixinhasArr.includes(caixinhaId)) {
        batch.update(userRef, { caixinhas: caixinhasArr.filter(id => id !== caixinhaId) });
      }
    }
    await batch.commit();
    return { success: true, message: 'Membro removido com sucesso' };

  } catch (error) {
    logger.error('Erro ao remover membro', { service: 'MembrosService', caixinhaId, membroId, error: error.message });
    throw error;
  }
};

// ─── transferirAdministracao ──────────────────────────────────────────────────

exports.transferirAdministracao = async (caixinhaId, novoAdminId, motivoTransferencia) => {
  logger.info('Iniciando transferência de administração', {
    service: 'MembrosService', method: 'transferirAdministracao', caixinhaId, novoAdminId
  });

  try {
    const supabase = sb();

    if (supabase) {
      // Buscar caixinha e admin atual
      const { data: caixinha, error: errCaixinha } = await supabase
        .from('caixinhas')
        .select('admin_id')
        .eq('id', caixinhaId)
        .single();

      if (errCaixinha || !caixinha) throw new Error('Caixinha não encontrada');
      if (caixinha.admin_id === novoAdminId) {
        return { success: true, message: 'O usuário já é o administrador desta caixinha' };
      }

      // Verificar se novo admin é membro ativo
      const { data: novoAdmin } = await supabase
        .from('caixinha_members')
        .select('id')
        .eq('caixinha_id', caixinhaId)
        .eq('user_id', novoAdminId)
        .eq('status', 'ativo')
        .maybeSingle();

      if (!novoAdmin) throw new Error('O novo administrador deve ser um membro ativo da caixinha');

      // Atualizar caixinha
      await supabase.from('caixinhas').update({ admin_id: novoAdminId }).eq('id', caixinhaId);

      // Atualizar roles de membro
      await supabase.from('caixinha_members')
        .update({ role: 'admin', is_admin: true })
        .eq('caixinha_id', caixinhaId).eq('user_id', novoAdminId);

      await supabase.from('caixinha_members')
        .update({ role: 'membro', is_admin: false })
        .eq('caixinha_id', caixinhaId).eq('user_id', caixinha.admin_id);

      // Backup Firestore fire-and-forget
      try {
        const { FieldValue } = require('../firebaseAdmin');
        const batch = db.batch();
        const caixinhaRef = db.collection('caixinhas').doc(caixinhaId);
        batch.update(caixinhaRef, {
          adminId: novoAdminId, dataTransferenciaAdmin: new Date(),
          motivoTransferenciaAdmin: motivoTransferencia,
          historicoAdmin: FieldValue.arrayUnion({ de: caixinha.admin_id, para: novoAdminId, data: new Date(), motivo: motivoTransferencia })
        });
        batch.commit().catch(() => {});
      } catch (_) {}

      logger.info('Administração transferida com sucesso', {
        service: 'MembrosService', caixinhaId, novoAdminId, adminAnteriorId: caixinha.admin_id
      });
      return { success: true, message: 'Administração transferida com sucesso', adminAnteriorId: caixinha.admin_id };
    }

    // Fallback Firestore
    const { FieldValue } = require('../firebaseAdmin');
    const batch = db.batch();
    const caixinhaRef = db.collection('caixinhas').doc(caixinhaId);
    const caixinhaDoc = await caixinhaRef.get();
    if (!caixinhaDoc.exists) throw new Error('Caixinha não encontrada');
    const caixinhaData = caixinhaDoc.data();
    if (caixinhaData.adminId === novoAdminId) return { success: true, message: 'O usuário já é o administrador desta caixinha' };
    const novoAdminDocs = await db.collection('caixinhas').doc(caixinhaId).collection('membros')
      .where('userId', '==', novoAdminId).where('status', '==', 'ativo').limit(1).get();
    if (novoAdminDocs.empty) throw new Error('O novo administrador deve ser um membro ativo da caixinha');
    batch.update(caixinhaRef, {
      adminId: novoAdminId, dataTransferenciaAdmin: new Date(), motivoTransferenciaAdmin: motivoTransferencia,
      historicoAdmin: FieldValue.arrayUnion({ de: caixinhaData.adminId, para: novoAdminId, data: new Date(), motivo: motivoTransferencia })
    });
    batch.update(novoAdminDocs.docs[0].ref, { role: 'admin', dataPromocao: new Date() });
    const antigoAdminDocs = await db.collection('caixinhas').doc(caixinhaId).collection('membros')
      .where('userId', '==', caixinhaData.adminId).where('role', '==', 'admin').limit(1).get();
    if (!antigoAdminDocs.empty) {
      batch.update(antigoAdminDocs.docs[0].ref, { role: 'membro', dataAlteracaoRole: new Date() });
    }
    await batch.commit();
    return { success: true, message: 'Administração transferida com sucesso', adminAnteriorId: caixinhaData.adminId };

  } catch (error) {
    logger.error('Erro ao transferir administração', { service: 'MembrosService', caixinhaId, novoAdminId, error: error.message });
    throw error;
  }
};

// ─── alterarRoleMembro ────────────────────────────────────────────────────────

exports.alterarRoleMembro = async (caixinhaId, membroId, novaRole, requesterId) => {
  logger.info('Alterando role do membro', {
    service: 'MembrosService', method: 'alterarRoleMembro', caixinhaId, membroId, novaRole
  });

  if (!['gerente', 'membro'].includes(novaRole)) {
    throw new Error('Role inválida. Use "gerente" ou "membro".');
  }

  try {
    const supabase = sb();
    if (!supabase) throw new Error('Supabase indisponível');

    // Buscar membro alvo
    const { data: membro, error: errBusca } = await supabase
      .from('caixinha_members')
      .select('id, user_id, role, status')
      .eq('id', membroId)
      .eq('caixinha_id', caixinhaId)
      .maybeSingle();

    if (errBusca || !membro) throw new Error('Membro não encontrado');

    if (membro.role === 'admin') {
      throw new Error('Não é possível alterar a role do administrador. Use "transferir" para transferir a administração.');
    }

    if (membro.user_id === requesterId) {
      throw new Error('Você não pode alterar sua própria role.');
    }

    if (membro.status !== 'ativo') {
      throw new Error('Só é possível alterar a role de membros ativos.');
    }

    if (membro.role === novaRole) {
      return { success: true, message: `Membro já possui a role "${novaRole}"`, novaRole };
    }

    const { error: errUpdate } = await supabase
      .from('caixinha_members')
      .update({ role: novaRole, is_admin: false })
      .eq('id', membroId);

    if (errUpdate) throw new Error(`Supabase role update: ${errUpdate.message}`);

    logger.info('Role do membro alterada com sucesso', {
      service: 'MembrosService', caixinhaId, membroId, roleAnterior: membro.role, novaRole
    });

    return { success: true, message: `Role alterada para "${novaRole}" com sucesso`, novaRole, roleAnterior: membro.role };
  } catch (error) {
    logger.error('Erro ao alterar role do membro', { service: 'MembrosService', caixinhaId, membroId, error: error.message });
    throw error;
  }
};

// ─── getContribuicoesPeriodo ──────────────────────────────────────────────────
// (usado internamente; contribuicoes agora em Supabase via contribuicaoService)

exports.getContribuicoesPeriodo = async (caixinhaId, membroId, meses) => {
  const dataLimite = new Date();
  dataLimite.setMonth(dataLimite.getMonth() - meses);

  const supabase = sb();
  if (supabase) {
    const { data } = await supabase
      .from('contribuicoes')
      .select('*')
      .eq('caixinha_id', caixinhaId)
      .or(`user_id.eq.${membroId}`)
      .gte('data_contribuicao', dataLimite.toISOString())
      .neq('status', 'estornada');
    return data || [];
  }

  const snapshot = await db.collection('caixinhas').doc(caixinhaId).collection('contribuicoes')
    .where('membroId', '==', membroId).where('dataContribuicao', '>=', dataLimite).get();
  return snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() }));
};

// ─── getParticipacaoVotacoes ──────────────────────────────────────────────────
// [MIGR-005] CONCLUÍDO: Migrado de Firestore 'votacoes' → Supabase 'disputes' + 'dispute_votes'

exports.getParticipacaoVotacoes = async (caixinhaId, membroId, dias) => {
  logger.info('Buscando participação em votações (Supabase)', {
    service: 'MembrosService', method: 'getParticipacaoVotacoes', caixinhaId, membroId, dias
  });

  try {
    const dataLimite = new Date();
    dataLimite.setDate(dataLimite.getDate() - dias);
    dataLimite.setHours(0, 0, 0, 0);

    const supabase = sb();
    if (!supabase) {
      logger.warn('Supabase indisponível para getParticipacaoVotacoes', { service: 'MembrosService' });
      return { total: 0, participadas: 0, percentual: 0, periodoAnalisado: { inicio: dataLimite, fim: new Date() } };
    }

    // 1. Todas as disputas no período (exceto CANCELLED)
    const { data: disputes, error: errDisputes } = await supabase
      .from('disputes')
      .select('id')
      .eq('caixinha_id', caixinhaId)
      .gte('created_at', dataLimite.toISOString())
      .neq('status', 'CANCELLED');

    if (errDisputes) throw new Error(`Supabase disputes query: ${errDisputes.message}`);

    const totalVotacoes = disputes?.length || 0;

    if (totalVotacoes === 0) {
      return { total: 0, participadas: 0, percentual: 0, periodoAnalisado: { inicio: dataLimite, fim: new Date() } };
    }

    // 2. Disputas em que o membro votou
    const disputeIds = disputes.map(d => d.id);
    const { data: votes, error: errVotes } = await supabase
      .from('dispute_votes')
      .select('dispute_id')
      .in('dispute_id', disputeIds)
      .eq('user_id', membroId);

    if (errVotes) throw new Error(`Supabase dispute_votes query: ${errVotes.message}`);

    const totalParticipadas = votes?.length || 0;
    const percentual = Math.round((totalParticipadas / totalVotacoes) * 100);

    return {
      total: totalVotacoes, participadas: totalParticipadas, percentual,
      periodoAnalisado: { inicio: dataLimite, fim: new Date() }
    };
  } catch (error) {
    logger.error('Erro ao buscar participação em votações', { service: 'MembrosService', caixinhaId, membroId, error: error.message });
    throw new Error(`Erro ao buscar participação em votações: ${error.message}`);
  }
};

// ─── gerarRelatorioParticipacao ───────────────────────────────────────────────

exports.gerarRelatorioParticipacao = async (caixinhaId, periodo = {}) => {
  logger.info('Gerando relatório de participação dos membros', {
    service: 'MembrosService', method: 'gerarRelatorioParticipacao', caixinhaId, periodo
  });

  try {
    const membros = await exports.getMembros(caixinhaId);

    const relatorioMembros = await Promise.all(membros.map(async (membro) => {
      const supabase = sb();
      let totalContribuicoes = 0, valorTotalContribuido = 0, ultimaContribuicao = null;

      if (supabase) {
        const { data: contribs } = await supabase
          .from('contribuicoes').select('valor, data_contribuicao')
          .eq('caixinha_id', caixinhaId).eq('user_id', membro.userId || membro.user_id)
          .gte('data_contribuicao', new Date(periodo.inicio || 0).toISOString())
          .lte('data_contribuicao', new Date(periodo.fim || Date.now()).toISOString());
        totalContribuicoes = contribs?.length || 0;
        valorTotalContribuido = (contribs || []).reduce((s, c) => s + Number(c.valor || 0), 0);
        ultimaContribuicao = contribs?.[0]?.data_contribuicao;
      } else {
        const c = await db.collection('caixinhas').doc(caixinhaId).collection('contribuicoes')
          .where('membroId', '==', membro.userId)
          .where('dataContribuicao', '>=', new Date(periodo.inicio || 0))
          .where('dataContribuicao', '<=', new Date(periodo.fim || Date.now())).get();
        totalContribuicoes = c.size;
        valorTotalContribuido = c.docs.reduce((s, d) => s + d.data().valor, 0);
        ultimaContribuicao = c.docs[0]?.data().dataContribuicao;
      }

      const votacoes = await exports.getParticipacaoVotacoes(caixinhaId, membro.userId || membro.user_id, 30).catch(() => ({ total: 0, participadas: 0, percentual: 0 }));
      const tempo = exports.calcularTempoParticipacao(membro.dataEntrada || membro.joined_at);

      return {
        membro,
        estatisticas: {
          totalContribuicoes, valorTotalContribuido,
          participacaoVotacoes: votacoes.total,
          ultimaContribuicao,
          statusAtual: membro.status,
          tempoNaCaixinha: tempo
        }
      };
    }));

    const metricas = exports.calcularMetricasGerais(relatorioMembros);
    const analise = exports.analisarPadroesParticipacao(relatorioMembros, metricas);

    return {
      membros: relatorioMembros, metricas, analise,
      recomendacoes: exports.gerarRecomendacoesParticipacao(analise),
      periodo, dataGeracao: new Date()
    };
  } catch (error) {
    logger.error('Erro ao gerar relatório de participação', { service: 'MembrosService', caixinhaId, error: error.message });
    throw error;
  }
};

// ─── Helpers de análise (síncronos) ──────────────────────────────────────────

exports.calcularTempoParticipacao = (dataEntrada) => {
  const hoje = new Date();
  const entrada = new Date(dataEntrada);
  const diffTime = Math.abs(hoje - entrada);
  const diffDays = Math.ceil(diffTime / (1000 * 60 * 60 * 24));
  return { dias: diffDays, meses: Math.floor(diffDays / 30), anos: Math.floor(diffDays / 365) };
};

exports.calcularMetricasGerais = (relatorioMembros) => {
  const n = relatorioMembros.length || 1;
  return {
    membrosAtivos: relatorioMembros.filter(r => r.membro.status === 'ativo').length,
    membrosSuspensos: relatorioMembros.filter(r => r.membro.status === 'suspenso').length,
    membrosInativos: relatorioMembros.filter(r => r.membro.status === 'inativo').length,
    mediaContribuicoesPorMembro: relatorioMembros.reduce((s, r) => s + r.estatisticas.totalContribuicoes, 0) / n,
    mediaParticipacaoVotacoes: relatorioMembros.reduce((s, r) => s + r.estatisticas.participacaoVotacoes, 0) / n,
    mediaTempoParticipacao: relatorioMembros.reduce((s, r) => s + (r.estatisticas.tempoNaCaixinha?.dias || 0), 0) / n
  };
};

exports.analisarPadroesParticipacao = (relatorioMembros, metricas) => {
  const analise = {
    participacaoAtiva: [],
    riscosIdentificados: [],
    tendencias: { crescimento: false, estabilidade: false, reducao: false }
  };
  relatorioMembros.forEach(r => {
    const stats = r.estatisticas;
    if (stats.totalContribuicoes > metricas.mediaContribuicoesPorMembro * 1.5) {
      analise.participacaoAtiva.push({ membroId: r.membro.id, nivel: 'alto', indicadores: ['contribuições acima da média'] });
    }
    if (stats.totalContribuicoes < metricas.mediaContribuicoesPorMembro * 0.5) {
      analise.riscosIdentificados.push({ membroId: r.membro.id, tipo: 'baixa participação', indicadores: ['contribuições abaixo da média'] });
    }
  });
  const comContribuicoes = relatorioMembros.filter(r => r.estatisticas.ultimaContribuicao).length;
  const n = relatorioMembros.length || 1;
  analise.tendencias.crescimento = comContribuicoes > n * 0.7;
  analise.tendencias.estabilidade = comContribuicoes > n * 0.5;
  analise.tendencias.reducao = comContribuicoes < n * 0.3;
  return analise;
};

exports.gerarRecomendacoesParticipacao = (analise) => {
  const recomendacoes = [];
  if (analise.riscosIdentificados.length > 0) {
    recomendacoes.push({ tipo: 'preventiva', prioridade: 'alta', acao: 'Implementar programa de reengajamento',
      detalhes: 'Contatar membros com baixa participação', membrosAlvo: analise.riscosIdentificados.map(r => r.membroId) });
  }
  if (analise.tendencias.reducao) {
    recomendacoes.push({ tipo: 'corretiva', prioridade: 'alta', acao: 'Revisar modelo de participação',
      detalhes: 'Avaliar barreiras à participação e propor mudanças', impactoEsperado: 'Aumento na taxa de participação em 30 dias' });
  }
  if (analise.participacaoAtiva.length > 0) {
    recomendacoes.push({ tipo: 'incentivo', prioridade: 'média', acao: 'Programa de reconhecimento',
      detalhes: 'Implementar sistema de reconhecimento para membros mais participativos', membrosAlvo: analise.participacaoAtiva.map(p => p.membroId) });
  }
  return recomendacoes;
};

exports.verificarRegrasParticipacao = async (caixinhaId, membroId) => {
  logger.info('Verificando regras de participação', {
    service: 'MembrosService', method: 'verificarRegrasParticipacao', caixinhaId, membroId
  });

  try {
    const supabase = sb();
    let membroData;

    if (supabase) {
      const { data } = await supabase.from('caixinha_members').select('status, user_id')
        .eq('id', membroId).eq('caixinha_id', caixinhaId).maybeSingle();
      if (!data) throw new Error('Membro não encontrado');
      membroData = { status: data.status, userId: data.user_id };
    } else {
      const membroDoc = await db.collection('caixinhas').doc(caixinhaId).collection('membros').doc(membroId).get();
      if (!membroDoc.exists) throw new Error('Membro não encontrado');
      membroData = membroDoc.data();
    }

    const regrasVioladas = [];
    const contribuicoes = await exports.getContribuicoesPeriodo(caixinhaId, membroId, 3);
    if (contribuicoes.length < 3) {
      regrasVioladas.push({ tipo: 'contribuição', descricao: 'Mínimo de contribuições mensais não atingido',
        detalhe: `${contribuicoes.length}/3 contribuições realizadas` });
    }
    const participacaoVotacoes = await exports.getParticipacaoVotacoes(caixinhaId, membroId, 30)
      .catch(() => ({ percentual: 100 }));
    if (participacaoVotacoes.percentual < 50) {
      regrasVioladas.push({ tipo: 'votação', descricao: 'Participação mínima em votações não atingida',
        detalhe: `${participacaoVotacoes.percentual}% de participação` });
    }

    return { membroId, status: membroData.status, regrasVioladas, emConformidade: regrasVioladas.length === 0, dataVerificacao: new Date() };
  } catch (error) {
    logger.error('Erro ao verificar regras de participação', { service: 'MembrosService', caixinhaId, membroId, error: error.message });
    throw error;
  }
};
