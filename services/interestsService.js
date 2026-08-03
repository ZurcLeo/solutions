/**
 * @fileoverview InterestsService — ElosCloud
 * Gerencia categorias de interesses, catálogo de interesses e
 * vínculos de interesses com usuários (tabela M:N user_interests).
 *
 * Tabelas: interest_categories, interests, user_interests
 * Migration: 20260515000006_interests_schema.sql
 */

const { getSupabaseClient } = require('../config/supabase');
const { logger } = require('../logger');

const SERVICE = 'interestsService';

// ──────────────────────────────────────────────
// Helpers
// ──────────────────────────────────────────────

function sb() {
  const client = getSupabaseClient();
  if (!client) throw new Error('Supabase client indisponivel');
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

const UUID_REGEX = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

// ──────────────────────────────────────────────
// 1. Categories
// ──────────────────────────────────────────────

/**
 * Cria uma nova categoria de interesses.
 * @param {Object} data - { name, description, icon, order, active }
 * @returns {Object} Categoria criada
 */
async function createCategory(data) {
  const fn = 'createCategory';
  log(fn, 'Criando categoria', { name: data.name });

  const { data: category, error } = await sb()
    .from('interest_categories')
    .insert([{
      name: data.name,
      description: data.description || '',
      icon: data.icon || null,
      sort_order: data.order || 0,
      active: data.active !== undefined ? data.active : true,
    }])
    .select()
    .single();

  if (error) {
    logError(fn, error, { name: data.name });
    if (error.code === '23505') {
      throw new Error(`Categoria "${data.name}" ja existe`);
    }
    throw error;
  }

  log(fn, 'Categoria criada', { categoryId: category.id });
  return category;
}

/**
 * Atualiza uma categoria existente.
 * @param {string} categoryId - UUID da categoria
 * @param {Object} data - campos a atualizar
 * @returns {Object} Categoria atualizada
 */
async function updateCategory(categoryId, data) {
  const fn = 'updateCategory';
  log(fn, 'Atualizando categoria', { categoryId });

  const updatePayload = {};
  if (data.name !== undefined) updatePayload.name = data.name;
  if (data.description !== undefined) updatePayload.description = data.description;
  if (data.icon !== undefined) updatePayload.icon = data.icon;
  if (data.order !== undefined) updatePayload.sort_order = data.order;
  if (data.active !== undefined) updatePayload.active = data.active;

  const { data: category, error } = await sb()
    .from('interest_categories')
    .update(updatePayload)
    .eq('id', categoryId)
    .select()
    .single();

  if (error) {
    logError(fn, error, { categoryId });
    if (error.code === 'PGRST116') {
      throw new Error('Categoria nao encontrada');
    }
    if (error.code === '23505') {
      throw new Error(`Categoria "${data.name}" ja existe`);
    }
    throw error;
  }

  log(fn, 'Categoria atualizada', { categoryId });
  return category;
}

// ──────────────────────────────────────────────
// 2. Interests
// ──────────────────────────────────────────────

/**
 * Cria um novo interesse dentro de uma categoria.
 * @param {Object} data - { label, categoryId, description, order, active }
 * @returns {Object} Interesse criado
 */
async function createInterest(data) {
  const fn = 'createInterest';
  log(fn, 'Criando interesse', { label: data.label, categoryId: data.categoryId });

  // Verificar se a categoria existe
  const { data: cat, error: catErr } = await sb()
    .from('interest_categories')
    .select('id')
    .eq('id', data.categoryId)
    .single();

  if (catErr || !cat) {
    throw new Error('Categoria nao encontrada');
  }

  const { data: interest, error } = await sb()
    .from('interests')
    .insert([{
      label: data.label,
      category_id: data.categoryId,
      description: data.description || '',
      active: data.active !== undefined ? data.active : true,
    }])
    .select()
    .single();

  if (error) {
    logError(fn, error, { label: data.label });
    if (error.code === '23505') {
      throw new Error(`Interesse "${data.label}" ja existe nesta categoria`);
    }
    throw error;
  }

  log(fn, 'Interesse criado', { interestId: interest.id });
  return interest;
}

/**
 * Atualiza um interesse existente.
 * @param {string} interestId - UUID do interesse
 * @param {Object} data - campos a atualizar
 * @returns {Object} Interesse atualizado
 */
async function updateInterest(interestId, data) {
  const fn = 'updateInterest';
  log(fn, 'Atualizando interesse', { interestId });

  const updatePayload = {};
  if (data.label !== undefined) updatePayload.label = data.label;
  if (data.categoryId !== undefined) updatePayload.category_id = data.categoryId;
  if (data.description !== undefined) updatePayload.description = data.description;
  if (data.order !== undefined) updatePayload.sort_order = data.order;
  if (data.active !== undefined) updatePayload.active = data.active;

  const { data: interest, error } = await sb()
    .from('interests')
    .update(updatePayload)
    .eq('id', interestId)
    .select()
    .single();

  if (error) {
    logError(fn, error, { interestId });
    if (error.code === 'PGRST116') {
      throw new Error('Interesse nao encontrado');
    }
    throw error;
  }

  log(fn, 'Interesse atualizado', { interestId });
  return interest;
}

// ──────────────────────────────────────────────
// 3. Available interests (categories + interests)
// ──────────────────────────────────────────────

/**
 * Retorna todas as categorias ativas com seus interesses.
 * @returns {Array} Categorias com array de interesses aninhado
 */
async function getAvailableInterests() {
  const fn = 'getAvailableInterests';
  log(fn, 'Buscando interesses disponiveis');

  const { data: categories, error: catErr } = await sb()
    .from('interest_categories')
    .select('*')
    .eq('active', true)
    .order('sort_order');

  if (catErr) {
    logError(fn, catErr);
    throw catErr;
  }

  const result = await Promise.all(
    categories.map(async (cat) => {
      const { data: interests, error: intErr } = await sb()
        .from('interests')
        .select('*')
        .eq('category_id', cat.id)
        .eq('active', true)
        .order('label');

      if (intErr) {
        logError(fn, intErr, { categoryId: cat.id });
        throw intErr;
      }

      return { ...cat, interests: interests || [] };
    })
  );

  return result;
}

// ──────────────────────────────────────────────
// 4. User interests
// ──────────────────────────────────────────────

/**
 * Retorna os interesses selecionados de um usuario,
 * agrupados por categoria.
 * @param {string} userId - ID do usuario (TEXT)
 * @returns {Array} Categorias com interesses do usuario
 */
async function getUserInterests(userId) {
  const fn = 'getUserInterests';
  log(fn, 'Buscando interesses do usuario', { userId });

  const { data, error } = await sb()
    .from('user_interests')
    .select('interest_id, interests (*, category:interest_categories(*))')
    .eq('user_id', userId);

  if (error) {
    logError(fn, error, { userId });
    throw error;
  }

  if (!data || data.length === 0) return [];

  // Agrupar por categoria
  const categoriesMap = {};

  data.forEach((item) => {
    const interest = item.interests;
    const category = interest.category;

    if (!categoriesMap[category.id]) {
      categoriesMap[category.id] = {
        id: category.id,
        categoryId: category.id,
        name: category.name,
        icon: category.icon,
        interests: [],
      };
    }

    categoriesMap[category.id].interests.push({
      id: interest.id,
      label: interest.label,
      description: interest.description,
      active: interest.active,
    });
  });

  return Object.values(categoriesMap);
}

/**
 * Atualiza os interesses de um usuario (delete + insert atomico).
 * @param {string} userId - ID do usuario (TEXT)
 * @param {Array<string>} interestIds - UUIDs dos interesses selecionados
 * @returns {Object} Resultado da operacao
 */
async function updateUserInterests(userId, interestIds) {
  const fn = 'updateUserInterests';
  log(fn, 'Atualizando interesses do usuario', { userId, count: interestIds.length });

  // Filtrar apenas IDs validos (UUID)
  const validIds = interestIds.filter((id) => UUID_REGEX.test(id));
  const invalidIds = interestIds.filter((id) => !UUID_REGEX.test(id));

  if (invalidIds.length > 0) {
    log(fn, 'IDs de interesse invalidos filtrados (nao-UUID)', {
      userId, invalidCount: invalidIds.length, invalidIds: invalidIds.slice(0, 5),
    });
  }

  if (validIds.length === 0 && interestIds.length > 0) {
    throw new Error('Nenhum ID de interesse valido fornecido. Atualize a pagina para recarregar os interesses.');
  }

  // Verificar quais IDs realmente existem na tabela interests (filtra category IDs misturados)
  const { data: existingInterests, error: checkErr } = await sb()
    .from('interests')
    .select('id')
    .in('id', validIds);

  if (checkErr) {
    logError(fn, checkErr, { userId });
    throw checkErr;
  }

  const existingIds = new Set((existingInterests || []).map((r) => r.id));
  const verifiedIds = validIds.filter((id) => existingIds.has(id));
  const phantomIds = validIds.filter((id) => !existingIds.has(id));

  if (phantomIds.length > 0) {
    log(fn, 'IDs filtrados por nao existirem na tabela interests (possiveis category IDs)', {
      userId, phantomCount: phantomIds.length, phantomIds: phantomIds.slice(0, 5),
    });
  }

  if (verifiedIds.length === 0 && validIds.length > 0) {
    throw new Error('Nenhum dos IDs fornecidos corresponde a um interesse valido. Atualize a pagina.');
  }

  // Deletar associacoes anteriores
  const { error: delErr } = await sb()
    .from('user_interests')
    .delete()
    .eq('user_id', userId);

  if (delErr) {
    logError(fn, delErr, { userId });
    throw delErr;
  }

  // Inserir novas associacoes
  if (verifiedIds.length > 0) {
    const inserts = verifiedIds.map((id) => ({
      user_id: userId,
      interest_id: id,
    }));

    const { error: insErr } = await sb()
      .from('user_interests')
      .insert(inserts);

    if (insErr) {
      logError(fn, insErr, { userId });
      throw insErr;
    }
  }

  log(fn, 'Interesses do usuario atualizados', { userId, count: verifiedIds.length, filteredCount: invalidIds.length + phantomIds.length });
  return { success: true, interestIds: verifiedIds, filteredCount: invalidIds.length + phantomIds.length };
}

// ──────────────────────────────────────────────
// 5. Statistics
// ──────────────────────────────────────────────

/**
 * Calcula estatisticas de uso dos interesses (admin).
 * Retorna contagem de usuarios por interesse e por categoria.
 * @returns {Object} { interestStats, categoryStats, totalUsers }
 */
async function calculateInterestStatistics() {
  const fn = 'calculateInterestStatistics';
  log(fn, 'Calculando estatisticas de interesses');

  // Contagem por interesse
  const { data: interestStats, error: intErr } = await sb()
    .from('interests')
    .select(`
      id,
      label,
      category_id,
      active,
      interest_categories ( name ),
      user_interests ( count )
    `)
    .order('label');

  if (intErr) {
    logError(fn, intErr);
    throw intErr;
  }

  // Total de usuarios com ao menos 1 interesse
  const { count: totalUsers, error: countErr } = await sb()
    .from('user_interests')
    .select('user_id', { count: 'exact', head: true });

  if (countErr) {
    logError(fn, countErr);
    throw countErr;
  }

  // Formatar resultado
  const stats = (interestStats || []).map((row) => ({
    id: row.id,
    label: row.label,
    categoryId: row.category_id,
    categoryName: row.interest_categories?.name || '',
    active: row.active,
    userCount: row.user_interests?.[0]?.count || 0,
  }));

  // Agregar por categoria
  const categoryMap = {};
  stats.forEach((s) => {
    if (!categoryMap[s.categoryId]) {
      categoryMap[s.categoryId] = {
        categoryId: s.categoryId,
        categoryName: s.categoryName,
        totalInterests: 0,
        totalUsers: 0,
      };
    }
    categoryMap[s.categoryId].totalInterests++;
    categoryMap[s.categoryId].totalUsers += s.userCount;
  });

  return {
    interestStats: stats,
    categoryStats: Object.values(categoryMap),
    totalUsersWithInterests: totalUsers || 0,
  };
}

// ──────────────────────────────────────────────
// Exports
// ──────────────────────────────────────────────

module.exports = {
  createCategory,
  updateCategory,
  createInterest,
  updateInterest,
  getAvailableInterests,
  getUserInterests,
  updateUserInterests,
  calculateInterestStatistics,
};
