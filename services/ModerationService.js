/**
 * @fileoverview Serviço de moderação de conteúdo da ElosCloud.
 *
 * Fluxo de denúncia (não-invasivo):
 *   1. Usuário denuncia post  →  classifyContent()
 *   2. DeepSeek classifica o conteúdo  →  categoria + confiança + raciocínio
 *   3. Ticket criado no sistema de suporte para revisão humana
 *   4. Moderador humano decide  →  applyModeration() com o multiplier correto
 *
 * A IA NUNCA bane automaticamente. Apenas reporta ao moderador humano.
 *
 * Escala canônica de visibility_multiplier:
 *   1.0  — Normal, sem restrições
 *   0.7  — 1ª denúncia confirmada (pós-revisão humana)
 *   0.4  — Histórico de infrações (≥2 confirmações)
 *   0.1  — Banido: posts ainda existem mas não aparecem no
 *           discover/trending para não-seguidores
 *
 * @module services/ModerationService
 */

const deepseekClient = require('../config/deepseek/deepseekClient');
const { getSupabaseClient } = require('../config/supabase');
const { logger } = require('../logger');

const AI_MODEL = process.env.DEEPSEEK_MODEL_NAME || 'deepseek-chat';

// Multipliers válidos — qualquer outro valor é rejeitado
const VALID_MULTIPLIERS = [1.0, 0.7, 0.4, 0.1];

// Categorias válidas de classificação da IA
const VALID_CATEGORIES = ['fake_news', 'hate_speech', 'spam', 'inappropriate', 'clean', 'outro'];

const SYSTEM_PROMPT = `Você é um moderador de conteúdo da ElosCloud, plataforma brasileira de economia colaborativa.
Analise o conteúdo denunciado e classifique em UMA das categorias:
- fake_news: informação deliberadamente falsa que pode causar dano
- hate_speech: discurso de ódio, preconceito, discriminação
- spam: conteúdo repetitivo, publicidade não solicitada, scam
- inappropriate: conteúdo inapropriado mas não se encaixa acima
- clean: conteúdo parece ok, denúncia pode ser equivocada

Responda SOMENTE com um JSON válido, sem markdown, sem texto extra:
{"category": "<categoria>", "confidence": <0.0 a 1.0>, "reasoning": "<1-2 frases explicando>"}`;

const FALLBACK_CLASSIFICATION = {
  category: 'outro',
  confidence: 0,
  reasoning: 'Classificação manual necessária (serviço de IA indisponível).',
};

class ModerationService {
  /**
   * Classifica o conteúdo de um post denunciado usando DeepSeek e
   * cria um ticket de suporte para revisão humana.
   *
   * @param {string} postId      - ID do post denunciado
   * @param {string} content     - Conteúdo textual do post
   * @param {string} reporterId  - Firebase UID de quem denunciou
   * @param {string} reportReason - Motivo descrito pelo usuário
   * @returns {Promise<{classification: object, ticketId: string|null}>}
   */
  async classifyContent(postId, content, reporterId, reportReason) {
    logger.info('ModerationService.classifyContent iniciado', {
      service: 'ModerationService',
      postId,
      reporterId,
    });

    // 1. Classificar com DeepSeek (fallback silencioso)
    const classification = await this._callDeepSeek(postId, content, reportReason);

    // 2. Criar ticket de suporte para revisão humana
    let ticketId = null;
    try {
      // Import dentro do método para evitar import circular
      const supportService = require('./SupportService');

      const result = await supportService.createTicket({
        userId: reporterId,
        category: 'security',
        module: 'moderation',
        issueType: 'content_report',
        title: `Denúncia de conteúdo: ${classification.category}`,
        description: [
          `Post ${postId} foi denunciado.`,
          `Classificação IA: ${classification.category}`,
          `Confiança: ${Math.round(classification.confidence * 100)}%`,
          `Raciocínio: ${classification.reasoning}`,
          `Motivo do usuário: ${reportReason || 'Não informado'}`,
        ].join('\n'),
        context: {
          postId,
          reporterId,
          reportReason,
          aiClassification: classification,
          requiresHumanReview: true,
        },
      });

      ticketId = result?.ticketId || null;

      logger.info('Ticket de moderação criado', {
        service: 'ModerationService',
        postId,
        ticketId,
        category: classification.category,
      });
    } catch (ticketError) {
      // Falha no ticket não bloqueia o fluxo — o report já foi registrado
      logger.error('Falha ao criar ticket de moderação', {
        service: 'ModerationService',
        postId,
        error: ticketError.message,
      });
    }

    return { classification, ticketId };
  }

  /**
   * Aplica penalidade de moderação a um usuário.
   * Somente moderadores humanos (via endpoint admin protegido) devem chamar isso.
   *
   * @param {string} userId   - Firebase UID do usuário a penalizar
   * @param {number} multiplier - Um de: 1.0, 0.7, 0.4, 0.1
   * @param {object} flags    - Ex: { fake_news: true, hate_speech: false }
   * @param {string} adminId  - Firebase UID do admin que aplicou (audit trail)
   * @returns {Promise<{userId, multiplier, flags, appliedBy}>}
   */
  async applyModeration(userId, multiplier, flags, adminId) {
    if (!VALID_MULTIPLIERS.includes(multiplier)) {
      throw new Error(
        `multiplier inválido: ${multiplier}. Use um de: ${VALID_MULTIPLIERS.join(', ')}`
      );
    }

    const supabase = getSupabaseClient();
    if (!supabase) throw new Error('Supabase indisponível');

    const normalizedFlags = {
      fake_news:   Boolean(flags?.fake_news),
      hate_speech: Boolean(flags?.hate_speech),
    };

    const { error } = await supabase
      .from('users')
      .update({
        visibility_multiplier: multiplier,
        moderation_flags:      normalizedFlags,
      })
      .eq('id', userId);

    if (error) throw new Error(`Falha ao aplicar moderação: ${error.message}`);

    logger.warn('Moderação aplicada por admin', {
      service:      'ModerationService',
      targetUserId: userId,
      adminId,
      multiplier,
      flags:        normalizedFlags,
    });

    // ─── Lastro do Padrinho: penalidade de reputação (SOCIAL-KYC-003) ────────
    // Se o usuário foi banido (multiplier = 0.1), aplicar -10% no social_score
    // do padrinho — mas SOMENTE se o vínculo ainda estiver 'active'.
    // Vínculo 'broken' = padrinho denunciou proativamente → isento.
    if (multiplier === 0.1) {
      try {
        const { data: bond } = await supabase
          .from('kyc_godfather_bonds')
          .select('id, godfather_id, bond_status')
          .eq('protege_id', userId)
          .eq('bond_status', 'active')
          .single();

        if (bond) {
          const { data: godfather } = await supabase
            .from('users')
            .select('social_score')
            .eq('id', bond.godfather_id)
            .single();

          const currentScore = godfather?.social_score || 0;
          const penalty      = currentScore * 0.10;
          const newScore     = Math.max(0, currentScore - penalty);

          await supabase
            .from('users')
            .update({ social_score: newScore })
            .eq('id', bond.godfather_id);

          await supabase
            .from('kyc_godfather_bonds')
            .update({ reputation_penalty_applied: penalty })
            .eq('id', bond.id);

          logger.warn('Lastro do Padrinho: penalidade de reputação aplicada', {
            service:      'ModerationService',
            bannedUserId: userId,
            godfatherId:  bond.godfather_id,
            penalty,
            newScore,
          });
        }
      } catch (bondErr) {
        // Penalidade falha silenciosamente — não bloqueia o banimento
        logger.error('ModerationService.applyModeration — falha ao aplicar penalidade do padrinho', {
          service: 'ModerationService',
          bannedUserId: userId,
          error: bondErr.message,
        });
      }
    }

    return { userId, multiplier, flags: normalizedFlags, appliedBy: adminId };
  }

  // ─── Métodos privados ────────────────────────────────────────────────────────

  async _callDeepSeek(postId, content, reportReason) {
    if (!deepseekClient) {
      logger.warn('DeepSeek indisponível — usando fallback de moderação', {
        service: 'ModerationService',
        postId,
      });
      return FALLBACK_CLASSIFICATION;
    }

    try {
      const userMessage = [
        `Post ID: ${postId}`,
        `Conteúdo: ${content || '(vazio)'}`,
        `Motivo da denúncia pelo usuário: ${reportReason || 'Não informado'}`,
      ].join('\n');

      const response = await deepseekClient.chat.completions.create({
        model: AI_MODEL,
        messages: [
          { role: 'system', content: SYSTEM_PROMPT },
          { role: 'user',   content: userMessage },
        ],
        temperature: 0.1, // baixa temperatura para respostas mais determinísticas
        max_tokens:  256,
      });

      const rawText = response.choices?.[0]?.message?.content?.trim() || '';
      return this._parseClassification(rawText, postId);
    } catch (aiError) {
      logger.error('Erro na chamada DeepSeek para moderação', {
        service: 'ModerationService',
        postId,
        error:   aiError.message,
      });
      return FALLBACK_CLASSIFICATION;
    }
  }

  _parseClassification(rawText, postId) {
    try {
      // Remove possível markdown ```json ... ``` ao redor
      const cleaned = rawText.replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/, '').trim();
      const parsed  = JSON.parse(cleaned);

      const category   = VALID_CATEGORIES.includes(parsed.category) ? parsed.category : 'outro';
      const confidence = typeof parsed.confidence === 'number'
        ? Math.min(1, Math.max(0, parsed.confidence))
        : 0;
      const reasoning  = typeof parsed.reasoning === 'string'
        ? parsed.reasoning.substring(0, 500)
        : 'Sem raciocínio fornecido.';

      return { category, confidence, reasoning };
    } catch (parseError) {
      logger.warn('Falha ao parsear resposta de moderação da IA', {
        service: 'ModerationService',
        postId,
        rawText: rawText.substring(0, 200),
        error:   parseError.message,
      });
      return FALLBACK_CLASSIFICATION;
    }
  }
}

module.exports = new ModerationService();
