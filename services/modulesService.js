// MOD-CORE Sprint 1 — Serviço de módulos da plataforma
const { getSupabaseClient } = require('../config/supabase');
const { logger } = require('../logger');

class ModulesService {
  // Retorna catálogo completo com preferências do usuário mergeadas
  async getCatalogWithPreferences(userId) {
    const supabase = getSupabaseClient();

    const [modulesRes, prefsRes] = await Promise.all([
      supabase.from('platform_modules').select('*').order('pillar').order('id'),
      userId
        ? supabase
            .from('user_module_preferences')
            .select('module_id, enabled, config')
            .eq('user_id', userId)
        : Promise.resolve({ data: [], error: null })
    ]);

    if (modulesRes.error) {
      logger.error('Erro ao buscar catálogo de módulos', { error: modulesRes.error.message });
      throw modulesRes.error;
    }

    const prefsMap = Object.fromEntries(
      (prefsRes.data || []).map(p => [p.module_id, p])
    );

    return modulesRes.data.map(mod => ({
      ...mod,
      user_enabled: prefsMap[mod.id]?.enabled ?? true,
      user_config:  prefsMap[mod.id]?.config  ?? {}
    }));
  }

  // Salva (upsert) preferência do usuário para um módulo
  async updatePreference(userId, moduleId, { enabled, config }) {
    const supabase = getSupabaseClient();

    const { data: mod, error: modErr } = await supabase
      .from('platform_modules')
      .select('is_toggleable, status')
      .eq('id', moduleId)
      .single();

    if (modErr || !mod) {
      const err = new Error('Módulo não encontrado');
      err.status = 404;
      throw err;
    }
    if (!mod.is_toggleable) {
      const err = new Error('Este módulo não pode ser desativado');
      err.status = 400;
      throw err;
    }
    if (mod.status === 'visao') {
      const err = new Error('Módulo ainda não disponível');
      err.status = 400;
      throw err;
    }

    const payload = {
      user_id:   userId,
      module_id: moduleId,
      updated_at: new Date().toISOString()
    };
    if (enabled !== undefined) payload.enabled = enabled;
    if (config  !== undefined) payload.config  = config;

    const { data, error } = await supabase
      .from('user_module_preferences')
      .upsert(payload, { onConflict: 'user_id,module_id' })
      .select()
      .single();

    if (error) {
      logger.error('Erro ao salvar preferência de módulo', { userId, moduleId, error: error.message });
      throw error;
    }
    return data;
  }

  // Admin: altera o status de visibilidade de um módulo
  async updateModuleStatus(moduleId, status) {
    const validStatuses = ['ativo', 'beta', 'em_breve', 'visao'];
    if (!validStatuses.includes(status)) {
      const err = new Error(`Status inválido. Use: ${validStatuses.join(', ')}`);
      err.status = 400;
      throw err;
    }

    const supabase = getSupabaseClient();
    const { data, error } = await supabase
      .from('platform_modules')
      .update({ status })
      .eq('id', moduleId)
      .select()
      .single();

    if (error) {
      logger.error('Erro ao atualizar status do módulo', { moduleId, status, error: error.message });
      throw error;
    }
    return data;
  }
}

module.exports = new ModulesService();
