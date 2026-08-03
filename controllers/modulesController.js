// MOD-CORE Sprint 1 — Controller de módulos da plataforma
const modulesService = require('../services/modulesService');
const { logger } = require('../logger');

// GET /api/modules — catálogo com preferências do usuário autenticado
const getModules = async (req, res) => {
  try {
    const userId = req.user?.uid || null;
    const data = await modulesService.getCatalogWithPreferences(userId);
    res.json({ success: true, data });
  } catch (err) {
    logger.error('getModules error', { error: err.message });
    res.status(500).json({ success: false, message: err.message });
  }
};

// PATCH /api/modules/:moduleId/preference — toggle individual do usuário
const updatePreference = async (req, res) => {
  try {
    const userId = req.user.uid;
    const { moduleId } = req.params;
    const { enabled, config } = req.body;
    const data = await modulesService.updatePreference(userId, moduleId, { enabled, config });
    res.json({ success: true, data });
  } catch (err) {
    logger.error('updatePreference error', { error: err.message });
    res.status(err.status || 500).json({ success: false, message: err.message });
  }
};

// GET /api/modules/admin/all — catálogo completo sem filtro de usuário (admin)
const adminGetModules = async (req, res) => {
  try {
    const data = await modulesService.getCatalogWithPreferences(null);
    res.json({ success: true, data });
  } catch (err) {
    logger.error('adminGetModules error', { error: err.message });
    res.status(500).json({ success: false, message: err.message });
  }
};

// PATCH /api/modules/admin/:moduleId — altera status do módulo na plataforma (admin)
const adminUpdateModule = async (req, res) => {
  try {
    const { moduleId } = req.params;
    const { status } = req.body;
    const data = await modulesService.updateModuleStatus(moduleId, status);
    res.json({ success: true, data });
  } catch (err) {
    logger.error('adminUpdateModule error', { error: err.message });
    res.status(err.status || 500).json({ success: false, message: err.message });
  }
};

module.exports = { getModules, updatePreference, adminGetModules, adminUpdateModule };
