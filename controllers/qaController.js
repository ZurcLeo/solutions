const QAOrchestratorService = require('../services/QAOrchestratorService');
const BugReporter            = require('../services/BugReporter');
const { logger }             = require('../logger');

/**
 * Dispara um novo run de QA.
 * POST /api/qa/run
 * Protegido por qaAuth middleware.
 */
async function triggerRun(req, res) {
  try {
    const orchestrator = new QAOrchestratorService({
      triggeredBy: req.body?.triggeredBy || 'manual',
      backendUrl:  req.body?.backendUrl  || '',
    });

    // Gera o runId aqui para poder retorná-lo na resposta 202
    const { v4: uuidv4 } = require('uuid');
    const runId = `run_${new Date().toISOString().replace(/[:.]/g, '-')}_${uuidv4().split('-')[0]}`;

    // Responde imediatamente com 202 Accepted — o run é assíncrono
    res.status(202).json({
      message: 'Run iniciado',
      runId,
      statusUrl: `/api/qa/runs/${runId}`,
    });

    // Executa o run em background, passando o runId já gerado
    orchestrator.runFullSuite(runId)
      .then(result => {
        logger.info('QA run concluído com sucesso', {
          service:     'qaController',
          runId:       result.runId,
          healthScore: result.report.healthScore,
        });
      })
      .catch(err => {
        logger.error('QA run falhou', {
          service: 'qaController',
          error:   err.message,
        });
      });

  } catch (err) {
    logger.error('qaController.triggerRun: erro ao iniciar run', {
      service: 'qaController', error: err.message,
    });
    res.status(500).json({ error: 'Falha ao iniciar run de QA' });
  }
}

/**
 * Lista os runs mais recentes.
 * GET /api/qa/runs
 * Protegido por qaAuth middleware.
 */
async function listRuns(req, res) {
  try {
    const limit = Math.min(parseInt(req.query.limit) || 20, 100);
    const runs  = await BugReporter.listRecent(limit);
    res.json({ runs, total: runs.length });
  } catch (err) {
    logger.error('qaController.listRuns', { service: 'qaController', error: err.message });
    res.status(500).json({ error: 'Falha ao listar runs' });
  }
}

/**
 * Retorna detalhes completos de um run (incluindo bugs e steps).
 * GET /api/qa/runs/:runId
 * Protegido por qaAuth middleware.
 */
async function getRunDetail(req, res) {
  try {
    const { runId } = req.params;
    const run       = await BugReporter.getRunDetail(runId);

    if (!run) {
      return res.status(404).json({ error: 'Run não encontrado' });
    }

    res.json(run);
  } catch (err) {
    logger.error('qaController.getRunDetail', { service: 'qaController', error: err.message });
    res.status(500).json({ error: 'Falha ao buscar detalhes do run' });
  }
}

/**
 * Retorna o healthScore atual da plataforma (endpoint público — para status page).
 * GET /api/qa/health
 */
async function getHealth(req, res) {
  try {
    const latest = await BugReporter.getLatestHealthScore();

    if (!latest) {
      return res.json({
        healthScore:  null,
        status:       'no_data',
        message:      'Nenhum run de QA executado ainda',
      });
    }

    const status = latest.healthScore >= 90 ? 'healthy'
      : latest.healthScore >= 70          ? 'degraded'
      : 'critical';

    res.json({ ...latest, status });
  } catch (err) {
    logger.error('qaController.getHealth', { service: 'qaController', error: err.message });
    res.status(500).json({ error: 'Falha ao buscar health score' });
  }
}

/**
 * Lista pendências de autofix que exigem revisão humana.
 * GET /api/qa/autofix-pending
 */
async function listAutofixPending(req, res) {
  try {
    const { getSupabaseClient } = require('../config/supabase');
    const supabase = getSupabaseClient();
    if (!supabase) return res.json([]);

    const { data, error } = await supabase
      .from('qa_autofix_pending')
      .select('*')
      .eq('status', 'awaiting_review')
      .order('created_at', { ascending: false });
    
    if (error) throw error;
    res.json(data || []);
  } catch (err) {
    logger.warn('qaController.listAutofixPending: erro ao buscar pendências', { error: err.message });
    res.json([]);
  }
}

/**
 * Aprova e aplica um autofix pendente.
 * POST /api/qa/autofix-pending/:id/approve
 */
async function approveAutofix(req, res) {
  try {
    const { id } = req.params;
    const { getSupabaseClient } = require('../config/supabase');
    const supabase = getSupabaseClient();
    if (!supabase) return res.status(500).json({ error: 'Supabase não disponível' });

    const { data, error: fetchError } = await supabase
      .from('qa_autofix_pending')
      .select('*')
      .eq('id', id)
      .single();

    if (fetchError || !data) return res.status(404).json({ error: 'Pendência não encontrada' });
    
    if (data.status !== 'awaiting_review') {
      return res.status(400).json({ error: 'Este fix já foi processado' });
    }

    await supabase
      .from('qa_autofix_pending')
      .update({ status: 'approved', processed_at: new Date().toISOString() })
      .eq('id', id);
    
    res.json({ success: true, message: 'Fix aprovado. Integração com GitHubService em andamento.' });
  } catch (err) {
    logger.error('qaController.approveAutofix', { service: 'qaController', error: err.message });
    res.status(500).json({ error: 'Falha ao aprovar fix' });
  }
}

/**
 * Rejeita um autofix pendente.
 * DELETE /api/qa/autofix-pending/:id
 */
async function rejectAutofix(req, res) {
  try {
    const { id } = req.params;
    const { getSupabaseClient } = require('../config/supabase');
    const supabase = getSupabaseClient();
    if (!supabase) return res.status(500).json({ error: 'Supabase não disponível' });

    await supabase
      .from('qa_autofix_pending')
      .update({ 
        status: 'rejected', 
        processed_at: new Date().toISOString() 
      })
      .eq('id', id);

    res.json({ success: true });
  } catch (err) {
    logger.error('qaController.rejectAutofix', { service: 'qaController', error: err.message });
    res.status(500).json({ error: 'Falha ao rejeitar fix' });
  }
}

/**
 * Busca uma interpretação do cache do Claude.
 * GET /api/qa/interpretation-cache/:hash
 */
async function getInterpretationCache(req, res) {
  try {
    const { hash } = req.params;
    const { getSupabaseClient } = require('../config/supabase');
    const supabase = getSupabaseClient();
    if (!supabase) return res.status(404).json({ error: 'Supabase não disponível' });

    const { data, error } = await supabase
      .from('qa_interpretation_cache')
      .select('*')
      .eq('hash', hash)
      .single();
    
    if (error || !data) return res.status(404).json({ error: 'Cache não encontrado' });
    res.json(data.report);
  } catch (err) {
    logger.error('qaController.getInterpretationCache', { service: 'qaController', error: err.message });
    res.status(500).json({ error: 'Falha ao buscar cache' });
  }
}

/**
 * Lista os últimos jobs de notificação (para auditoria no dashboard).
 * GET /api/qa/notification-jobs
 */
async function listNotificationJobs(req, res) {
  try {
    const db = require('../firebaseAdmin').getFirestore();
    const limit = parseInt(req.query.limit) || 20;
    
    const snap = await db.collection('notification_jobs')
      .orderBy('createdAt', 'desc')
      .limit(limit)
      .get();
    
    const jobs = snap.docs.map(d => ({ id: d.id, ...d.data() }));
    res.json(jobs);
  } catch (err) {
    logger.error('qaController.listNotificationJobs', { service: 'qaController', error: err.message });
    res.status(500).json({ error: 'Falha ao listar jobs de notificação' });
  }
}

/**
 * Lista logs de SRE e telemetria (Protocolo Zero-Data).
 * GET /api/qa/sre-logs
 */
async function getSreLogs(req, res) {
  try {
    const SreRepository = require('../services/SreRepository');
    const limit = parseInt(req.query.limit) || 50;
    const severity = req.query.severity; // Opcional: filtrar por severidade
    
    const logs = await SreRepository.getRecentLogs({ limit, severity });
    res.json(logs);
  } catch (err) {
    logger.error('qaController.getSreLogs', { service: 'qaController', error: err.message });
    res.status(500).json({ error: 'Falha ao buscar logs de telemetria SRE' });
  }
}

const ledgerService = require('../services/ledgerService');

/**
 * Injeta saldo em uma caixinha para propósitos de teste de QA.
 * POST /api/qa/seed-balance
 * Protegido por qaAuth middleware.
 */
async function seedBalance(req, res) {
  try {
    const { caixinhaId, userId, amount, description } = req.body;

    if (!caixinhaId || !userId || !amount) {
      return res.status(400).json({ error: 'caixinhaId, userId e amount são obrigatórios' });
    }

    const result = await ledgerService.creditMember({
      caixinhaId,
      userId,
      amount,
      paymentId: `qa_seed_${Date.now()}_${Math.random().toString(36).substr(2, 5)}`,
      description: description || 'Depósito de QA'
    });

    res.json({ success: true, result });
  } catch (err) {
    logger.error('qaController.seedBalance', { service: 'qaController', error: err.message });
    res.status(500).json({ error: err.message });
  }
}

module.exports = { 
  triggerRun, 
  listRuns, 
  getRunDetail, 
  getHealth, 
  seedBalance,
  listAutofixPending,
  approveAutofix,
  rejectAutofix,
  getInterpretationCache,
  listNotificationJobs,
  getSreLogs
};
