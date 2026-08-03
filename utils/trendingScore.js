/**
 * @fileoverview Cálculo de trending score para posts do feed social.
 *
 * Fórmula:
 *   trending_score = (reactions_count * 2 + comments_count * 1) * EXP(-0.05 * hours_since_created)
 *
 * O decay exponencial (λ=0.05) faz com que um post perca ~40% do score em 10h,
 * ~70% em 24h e ~95% em 60h, garantindo rotatividade natural no trending.
 *
 * O score é recalculado no Node.js a cada nova reação ou comentário
 * (update incremental — sem varredura total da tabela).
 */

/**
 * Calcula o trending score de um post.
 *
 * @param {number} reactionsCount - Número de reações (tipo heart)
 * @param {number} commentsCount  - Número de comentários
 * @param {Date|string|number} createdAt - Data de criação do post
 * @returns {number} trending score (sempre >= 0)
 */
function calculateTrendingScore(reactionsCount, commentsCount, createdAt) {
  const created = new Date(createdAt);
  if (isNaN(created.getTime())) return 0;

  const hoursSinceCreated = (Date.now() - created.getTime()) / (1000 * 60 * 60);
  const engagement = (reactionsCount * 2) + (commentsCount * 1);
  const rawScore = engagement * Math.exp(-0.05 * hoursSinceCreated);

  return Math.max(0, rawScore);
}

module.exports = { calculateTrendingScore };
