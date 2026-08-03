// src/models/category.js
const { getSupabaseClient } = require('../config/supabase');
const { logger } = require('../logger');

class InterestsCategory {
  constructor(data) {
    this.id = data.id;
    this.name = data.name;
    this.description = data.description || '';
    this.icon = data.icon || null;
    this.order = data.order || 0;
    this.active = data.active !== undefined ? data.active : true;
    this.createdAt = data.createdAt || new Date();
    this.updatedAt = data.updatedAt || new Date();
  }

  /**
   * Mapeia retorno do Supabase para objeto interno
   */
  static fromSupabase(row) {
    if (!row) return null;
    return new InterestsCategory({
      id: row.id,
      name: row.name,
      description: row.description,
      icon: row.icon,
      order: row.sort_order || 0,
      active: row.active,
      createdAt: row.created_at,
      updatedAt: row.updated_at
    });
  }

  toPlainObject() {
    return {
      id: this.id,
      name: this.name,
      description: this.description,
      icon: this.icon,
      order: this.order,
      active: this.active,
      createdAt: this.createdAt,
      updatedAt: this.updatedAt
    };
  }

  static async getById(categoryId) {
    const supabase = getSupabaseClient();

    try {
      const { data, error } = await supabase
        .from('interest_categories')
        .select('*')
        .eq('id', categoryId)
        .single();

      if (error) throw error;
      if (data) return InterestsCategory.fromSupabase(data);
      return null;
    } catch (error) {
      logger.error('Erro ao buscar categoria', { categoryId, error: error.message });
      throw error;
    }
  }

  static async getAllCategories(includeInactive = false) {
    const supabase = getSupabaseClient();

    try {
      let query = supabase.from('interest_categories').select('*');
      if (!includeInactive) query = query.eq('active', true);

      const { data, error } = await query.order('sort_order');
      if (error) throw error;
      return (data || []).map(InterestsCategory.fromSupabase);
    } catch (error) {
      logger.error('Erro ao buscar categorias', { error: error.message });
      throw error;
    }
  }

  static async createCategory(categoryData) {
    const supabase = getSupabaseClient();

    try {
      const { data, error } = await supabase
        .from('interest_categories')
        .insert([{
          name: categoryData.name,
          description: categoryData.description || '',
          icon: categoryData.icon || null,
          sort_order: categoryData.order || 0,
          active: categoryData.active !== undefined ? categoryData.active : true
        }])
        .select()
        .single();

      if (error) throw error;
      logger.info('Categoria criada', { categoryId: data.id });
      return InterestsCategory.fromSupabase(data);
    } catch (error) {
      logger.error('Erro ao criar categoria', { error: error.message });
      throw error;
    }
  }

  static async updateCategory(categoryId, updateData) {
    const supabase = getSupabaseClient();

    try {
      const sbData = {
        name: updateData.name,
        description: updateData.description,
        icon: updateData.icon,
        sort_order: updateData.order,
        active: updateData.active,
        updated_at: new Date()
      };
      // Remover undefined
      Object.keys(sbData).forEach(key => sbData[key] === undefined && delete sbData[key]);

      const { data, error } = await supabase
        .from('interest_categories')
        .update(sbData)
        .eq('id', categoryId)
        .select()
        .single();

      if (error) throw error;
      return InterestsCategory.fromSupabase(data);
    } catch (error) {
      logger.error('Erro ao atualizar categoria', { categoryId, error: error.message });
      throw error;
    }
  }
}

module.exports = InterestsCategory;
