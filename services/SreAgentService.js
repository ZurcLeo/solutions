const { logger } = require('../logger');
const SreRepository = require('./SreRepository');
const AutofixGuard = require('./AutofixGuard');
const GitHubService = require('./GitHubService');
const anthropicClient = require('../config/anthropic/anthropicClient');

/**
 * SreAgentService - Especializado em análise de incidentes e diagnósticos de sistema via IA.
 */
class SreAgentService {
  /**
   * Analisa um incidente específico baseado no seu log de contexto.
   */
  async diagnoseIncident(logEntry) {
    if (!anthropicClient) {
      logger.warn('SreAgentService: AI diagnostics skipped (Anthropic not available)');
      return null;
    }

    const { correlation_id, metadata_snapshot, severity, severity_reason, method, path, status_code } = logEntry;
    logger.info('SreAgentService: Starting diagnosis via Claude', { correlation_id });

    const systemPrompt = `Você é o Engenheiro de Confiabilidade de Site (SRE) Sênior da ElosCloud.
Sua tarefa é analisar logs técnicos de erro (Node.js/Express) e fornecer um diagnóstico preciso.

Responda APENAS com um objeto JSON válido, seguindo esta estrutura:
{
  "classification": "Categoria (ex: INFRA, AUTH, DATABASE, EXTERNAL_API)",
  "rca": "Causa Raiz detalhada",
  "suggested_fix": "Sugestão objetiva de correção",
  "proposed_patch": {
    "filePath": "caminho/do/arquivo.js",
    "oldCode": "codigo antigo",
    "newCode": "codigo novo"
  }
}`;

    const userPrompt = `Analise este incidente:
Endpoint: ${method} ${path}
Status: ${status_code}
Severidade: ${severity}
Motivo: ${severity_reason}
Snapshot técnico: ${JSON.stringify(metadata_snapshot)}

Forneça o diagnóstico técnico em JSON.`;

    try {
      const response = await anthropicClient.messages.create({
        model: 'claude-3-haiku-20240307',
        max_tokens: 1000,
        system: systemPrompt,
        messages: [{ role: 'user', content: userPrompt }]
      });

      const rawContent = response.content[0].text.trim();
      const jsonContent = rawContent.replace(/^```json\s*/i, '').replace(/\s*```$/i, '').trim();
      const diagnosis = JSON.parse(jsonContent);

      logger.info('SreAgentService: Diagnosis complete', { correlation_id, classification: diagnosis.classification });

      const diagnosisResult = {
        ai_diagnosis: diagnosis,
        diagnosed_at: new Date().toISOString()
      };

      // Se houver um patch proposto, tentamos o Shadow PR (HITL)
      if (diagnosis.proposed_patch && diagnosis.proposed_patch.filePath) {
        await this.handleShadowPR(correlation_id, diagnosis.proposed_patch, diagnosis);
      }

      return diagnosisResult;
    } catch (error) {
      logger.error('SreAgentService: Diagnosis failed', { correlation_id, error: error.message });
      return null;
    }
  }

  /**
   * Gerencia a criação de um Shadow PR (PR Automático) com base no diagnóstico da IA.
   */
  async handleShadowPR(correlation_id, patch, diagnosis) {
    const { filePath, oldCode, newCode } = patch;

    try {
      // 1. Verifica segurança via AutofixGuard
      const canOpen = await AutofixGuard.canOpenPR(filePath);
      if (!canOpen) return;

      // 2. Valida o patch (sintaxe e aplicabilidade)
      const isValid = await AutofixGuard.validatePatch(filePath, oldCode, newCode);
      if (!isValid) return;

      // 3. Verifica se exige aprovação humana (HITL)
      // Extraímos o "flow" do path ou do diagnóstico se possível
      const flowId = filePath.includes('payment') ? 'payment' : (filePath.includes('auth') ? 'auth' : 'general');
      
      if (AutofixGuard.requiresHumanApproval(flowId)) {
        logger.info('SreAgentService: Shadow PR requires human approval', { correlation_id, flowId });
        await AutofixGuard.recordHumanApprovalNeeded({
          correlation_id,
          filePath,
          patch,
          diagnosis
        }, `Flow ${flowId} requires manual review.`);
        return;
      }

      // 4. Executa a criação do PR no GitHub
      if (GitHubService._isConfigured()) {
        const fix = {
          flowId,
          stepId: 'sre-autofix',
          filePath,
          description: diagnosis.classification,
          explanation: `RCA: ${diagnosis.rca}\n\nFix sugerido pela IA SRE para o incidente ${correlation_id}.`,
          patch: { oldCode, newCode }
        };

        const branchName = await GitHubService.createBranchWithFix(fix);
        const prUrl = await GitHubService.openPR(branchName, fix);

        // 5. Registra o sucesso
        await AutofixGuard.recordPROpened(filePath, prUrl, fix);
        
        // Atualiza o log no SRE Repository com o link do PR
        await SreRepository.updateDiagnosis(correlation_id, {
          ai_diagnosis: { ...diagnosis, pr_url: prUrl }
        });
        
        logger.info('SreAgentService: Shadow PR created successfully', { correlation_id, prUrl });
      }
    } catch (error) {
      logger.error('SreAgentService: Failed to handle Shadow PR', { correlation_id, error: error.message });
    }
  }

  /**
   * Processa um lote de incidentes pendentes de diagnóstico com deduplicação.
   */
  async processPendingIncidents(limit = 5) {
    const pendingLogs = await SreRepository.getPendingDiagnostics(limit);
    if (pendingLogs.length === 0) {
      logger.debug('SreAgentService: No pending incidents found for diagnosis');
      return 0;
    }

    logger.info(`SreAgentService: Processing ${pendingLogs.length} pending incidents`, { limit });

    // Buscar diagnósticos recentes para deduplicação
    const recentLogs = await SreRepository.getRecentLogs({ limit: 100 });
    const analyzedFingerprints = new Set(
      recentLogs
        .filter(l => l.ai_diagnosis && l.ai_diagnosis.classification !== 'DUPLICATE')
        .map(l => `${l.method}:${l.path}:${l.status_code}`)
    );

    let processed = 0;
    for (const log of pendingLogs) {
      const fingerprint = `${log.method}:${log.path}:${log.status_code}`;
      
      // 1. Ignorar 429 (Rate Limits) para evitar loops de diagnóstico
      if (log.status_code === 429) {
        await SreRepository.updateDiagnosis(log.correlation_id, {
          ai_diagnosis: { classification: 'RATE_LIMIT', rca: 'Requisição bloqueada por excesso de tráfego.' },
          diagnosed_at: new Date().toISOString()
        });
        continue;
      }

      // 2. Ignorar endpoints de telemetria/SRE para evitar recursão
      if (log.path.includes('/api/qa') || log.path.includes('/api/sre')) {
        await SreRepository.updateDiagnosis(log.correlation_id, {
          ai_diagnosis: { classification: 'SYSTEM', rca: 'Log de sistema ignorado para evitar recursão.' },
          diagnosed_at: new Date().toISOString()
        });
        continue;
      }
      
      if (analyzedFingerprints.has(fingerprint)) {
        logger.info('SreAgentService: Incident skipped (fingerprint recently analyzed)', { 
          correlation_id: log.correlation_id, 
          fingerprint 
        });
        
        await SreRepository.updateDiagnosis(log.correlation_id, {
          ai_diagnosis: { 
            classification: 'DUPLICATE', 
            rca: 'Este incidente é uma recorrência de um erro já analisado. Verifique os diagnósticos anteriores para este endpoint.' 
          },
          diagnosed_at: new Date().toISOString()
        });
        continue;
      }

      logger.info('SreAgentService: Diagnosing unique incident', { correlation_id: log.correlation_id, fingerprint });
      const diagnosisResult = await this.diagnoseIncident(log);
      
      if (diagnosisResult) {
        await SreRepository.updateDiagnosis(log.correlation_id, diagnosisResult);
        analyzedFingerprints.add(fingerprint);
        processed++;
      }
    }
    
    if (processed > 0) {
        logger.info(`SreAgentService: Successfully diagnosed ${processed} unique incidents`);
    }
    return processed;
  }
}

module.exports = new SreAgentService();
