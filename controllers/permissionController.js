// controllers/permissionController.js
const { logger } = require('../logger');
const { getSupabaseClient } = require('../config/supabase');

/**
 * Lista todas as permissões disponíveis na plataforma
 * GET /rbac/permissions
 */
const getAllPermissions = async (req, res) => {
  try {
    const supabase = getSupabaseClient();
    const { data, error } = await supabase
      .from('permissions')
      .select('*')
      .order('resource')
      .order('action');

    if (error) throw error;

    const permissions = (data || []).map(p => ({
      id: p.id,
      name: `${p.resource}:${p.action}`,
      resource: p.resource,
      action: p.action,
      description: p.description,
      createdAt: p.created_at,
    }));

    return res.status(200).json({ success: true, data: permissions });
  } catch (error) {
    logger.error('Erro ao listar permissões', { controller: 'permissionController', error: error.message });
    return res.status(500).json({ success: false, message: 'Erro ao listar permissões', error: error.message });
  }
};

module.exports = { getAllPermissions };
