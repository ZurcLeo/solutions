const Post           = require('../models/Post');
const ModerationService = require('../services/ModerationService');
const { getSupabaseClient } = require('../config/supabase');
const { logger }     = require('../logger');

exports.reportPost = async (req, res) => {
  const { postId }    = req.params;
  const { reason }    = req.body;         // motivo descrito pelo usuário
  const reporterId    = req.user.uid;

  if (!reason) return res.status(400).json({ message: 'reason é obrigatório.' });

  try {
    const supabase = getSupabaseClient();

    // 1. Buscar conteúdo do post no Supabase
    const { data: post, error: postError } = await supabase
      .from('posts')
      .select('conteudo, usuario_id, reports_count')
      .eq('id', postId)
      .maybeSingle();

    if (postError || !post) {
      return res.status(404).json({ message: 'Post não encontrado.' });
    }

    // 2. Incrementar reports_count atomicamente
    await supabase
      .from('posts')
      .update({ reports_count: (post.reports_count || 0) + 1 })
      .eq('id', postId);

    // 3. Classificar com IA + criar ticket de suporte (fire-and-forget)
    ModerationService.classifyContent(
      postId,
      post.conteudo || '',
      reporterId,
      reason
    ).catch(err => logger.error('Falha na classificação de moderação', { postId, error: err.message }));

    res.status(202).json({
      message: 'Denúncia registrada. Nossa equipe irá revisar em breve.',
      postId,
    });
  } catch (error) {
    logger.error('Erro em reportController.reportPost', { postId, error: error.message });
    res.status(500).json({ message: error.message });
  }
};

exports.reportComment = async (req, res) => {
  const { postId, commentId } = req.params;
  const { reason }            = req.body;
  const reporterId            = req.user.uid;

  if (!reason) return res.status(400).json({ message: 'reason é obrigatório.' });

  try {
    const supabase = getSupabaseClient();

    const { data: comment, error: commentError } = await supabase
      .from('comments')
      .select('texto, usuario_id')
      .eq('id', commentId)
      .eq('post_id', postId)
      .maybeSingle();

    if (commentError || !comment) {
      return res.status(404).json({ message: 'Comentário não encontrado.' });
    }

    // Classificar com IA + criar ticket (fire-and-forget)
    ModerationService.classifyContent(
      commentId,
      comment.texto || '',
      reporterId,
      reason
    ).catch(err => logger.error('Falha na classificação de moderação (comentário)', { commentId, error: err.message }));

    res.status(202).json({
      message: 'Denúncia registrada. Nossa equipe irá revisar em breve.',
      commentId,
    });
  } catch (error) {
    logger.error('Erro em reportController.reportComment', { commentId: req.params.commentId, error: error.message });
    res.status(500).json({ message: error.message });
  }
};

exports.reportUser = async (req, res) => {
  const { userId }  = req.params;
  const { reason }  = req.body;
  const reporterId  = req.user.uid;

  if (!reason) return res.status(400).json({ message: 'reason é obrigatório.' });
  if (userId === reporterId) return res.status(400).json({ message: 'Você não pode denunciar a si mesmo.' });

  try {
    const supabase = getSupabaseClient();

    const { data: user, error: userError } = await supabase
      .from('users')
      .select('id, full_name')
      .eq('id', userId)
      .maybeSingle();

    if (userError || !user) {
      return res.status(404).json({ message: 'Usuário não encontrado.' });
    }

    // Criar ticket de suporte para revisão humana (sem classificação IA — não há conteúdo específico)
    try {
      const supportService = require('../services/SupportService');
      await supportService.createTicket({
        userId: reporterId,
        category: 'security',
        module: 'moderation',
        issueType: 'user_report',
        title: `Denúncia de usuário: ${user.full_name || userId}`,
        description: [
          `Usuário ${userId} (${user.full_name || 'sem nome'}) foi denunciado.`,
          `Motivo: ${reason}`,
          `Denunciado por: ${reporterId}`,
        ].join('\n'),
        context: {
          reportedUserId: userId,
          reporterId,
          reportReason: reason,
          requiresHumanReview: true,
        },
      });
    } catch (ticketErr) {
      logger.error('Falha ao criar ticket de denúncia de usuário', { userId, error: ticketErr.message });
    }

    res.status(202).json({
      message: 'Denúncia registrada. Nossa equipe irá revisar em breve.',
      userId,
    });
  } catch (error) {
    logger.error('Erro em reportController.reportUser', { userId, error: error.message });
    res.status(500).json({ message: error.message });
  }
};
