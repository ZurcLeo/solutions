// controllers/roleController.js
const { logger } = require('../logger');
const { getSupabaseClient } = require('../config/supabase');

/**
 * Lista todas as roles disponíveis na plataforma
 * GET /rbac/roles
 */
const getAllRoles = async (req, res) => {
  try {
    const supabase = getSupabaseClient();
    const { data, error } = await supabase
      .from('roles')
      .select('*')
      .order('name');

    if (error) throw error;

    const roles = (data || []).map(r => ({
      id: r.id,
      name: r.name,
      description: r.description,
      isSystemRole: r.is_system_role,
      createdAt: r.created_at,
    }));

    return res.status(200).json({ success: true, data: roles });
  } catch (error) {
    logger.error('Erro ao listar roles', { controller: 'roleController', error: error.message });
    return res.status(500).json({ success: false, message: 'Erro ao listar roles', error: error.message });
  }
};

/**
 * Cria uma nova role
 * POST /rbac/roles
 * Body: { name, description, isSystemRole }
 */
const createRole = async (req, res) => {
  try {
    const { name, description, isSystemRole = false } = req.body;

    if (!name) {
      return res.status(400).json({ success: false, message: 'Nome da role é obrigatório' });
    }

    const supabase = getSupabaseClient();

    // Verificar unicidade
    const { data: existing } = await supabase
      .from('roles')
      .select('id')
      .eq('name', name)
      .maybeSingle();

    if (existing) {
      return res.status(409).json({ success: false, message: `Role com nome '${name}' já existe` });
    }

    const { data, error } = await supabase
      .from('roles')
      .insert({ name, description, is_system_role: isSystemRole })
      .select()
      .single();

    if (error) throw error;

    return res.status(201).json({
      success: true,
      data: {
        id: data.id,
        name: data.name,
        description: data.description,
        isSystemRole: data.is_system_role,
        createdAt: data.created_at,
      },
    });
  } catch (error) {
    logger.error('Erro ao criar role', { controller: 'roleController', error: error.message });
    return res.status(500).json({ success: false, message: 'Erro ao criar role', error: error.message });
  }
};

module.exports = { getAllRoles, createRole };
