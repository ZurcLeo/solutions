// src/models/interest.js
const { getSupabaseClient } = require('../config/supabase');
const { logger } = require('../logger');

class Interest {
  constructor(data) {
    this.id = data.id;
    this.label = data.label;
    this.categoryId = data.categoryId;
    this.description = data.description || '';
    this.active = data.active !== undefined ? data.active : true;
    this.order = data.order || 0;
    this.createdAt = data.createdAt || new Date();
    this.updatedAt = data.updatedAt || new Date();
  }

  /**
   * Mapeia retorno do Supabase para objeto interno
   */
  static fromSupabase(row) {
    if (!row) return null;
    return new Interest({
      id: row.id,
      label: row.label,
      categoryId: row.category_id,
      description: row.description,
      active: row.active,
      order: row.sort_order || 0,
      createdAt: row.created_at,
      updatedAt: row.updated_at
    });
  }

  toPlainObject() {
    return {
      id: this.id,
      label: this.label,
      categoryId: this.categoryId,
      description: this.description,
      active: this.active,
      order: this.order,
      createdAt: this.createdAt,
      updatedAt: this.updatedAt
    };
  }

  static async getById(interestId) {
    const supabase = getSupabaseClient();

    try {
      const { data, error } = await supabase
        .from('interests')
        .select('*')
        .eq('id', interestId)
        .single();

      if (error) throw error;
      if (data) return Interest.fromSupabase(data);
      return null;
    } catch (error) {
      logger.error('Erro ao buscar interesse', { interestId, error: error.message });
      return null;
    }
  }

  static async getInterestsByCategory(categoryId, includeInactive = false) {
    const supabase = getSupabaseClient();

    try {
      let query = supabase
        .from('interests')
        .select('*')
        .eq('category_id', categoryId);

      if (!includeInactive) query = query.eq('active', true);

      const { data, error } = await query.order('label');
      if (error) throw error;
      return (data || []).map(Interest.fromSupabase);
    } catch (error) {
      logger.error('Erro ao buscar interesses por categoria', { categoryId, error: error.message });
      throw error;
    }
  }

  static async getUserInterests(userId) {
    const supabase = getSupabaseClient();

    try {
      const { data, error } = await supabase
        .from('user_interests')
        .select('interest_id, interests (*, category:interest_categories(*))')
        .eq('user_id', userId);

      if (error) throw error;
      if (!data || data.length === 0) return [];

      // Agrupar por categoria para manter compatibilidade com o formato esperado pelo frontend
      const categoriesMap = {};

      data.forEach(item => {
        const interest = item.interests;
        const category = interest.category;

        if (!categoriesMap[category.id]) {
          categoriesMap[category.id] = {
            id: category.id,
            categoryId: category.id,
            name: category.name,
            icon: category.icon,
            interests: []
          };
        }

        categoriesMap[category.id].interests.push({
          id: interest.id,
          label: interest.label,
          description: interest.description,
          active: interest.active
        });
      });

      return Object.values(categoriesMap);
    } catch (error) {
      logger.error('Erro ao buscar interesses do usuário', { userId, error: error.message });
      return [];
    }
  }

  static async updateUserInterests(userId, interestIds) {
    const supabase = getSupabaseClient();

    try {
      // Deletar associações antigas
      await supabase.from('user_interests').delete().eq('user_id', userId);

      // Inserir novas associações
      if (interestIds.length > 0) {
        const inserts = interestIds.map(id => ({ user_id: userId, interest_id: id }));
        const { error } = await supabase.from('user_interests').insert(inserts);
        if (error) throw error;
        logger.info('Interesses do usuário atualizados', { userId, count: interestIds.length });
      }

      return { success: true, interestIds };
    } catch (error) {
      logger.error('Erro ao atualizar interesses do usuário', { userId, error: error.message });
      throw error;
    }
  }
}

module.exports = Interest;
