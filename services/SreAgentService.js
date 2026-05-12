const { logger } = require('../logger');
const SreRepository = require('./SreRepository');
const AutofixGuard = require('./AutofixGuard');
const GitHubService = require('./GitHubService');
const anthropicClient = require('../config/anthropic/anthropicClient');
const healthHistoryService = require('./healthHistoryService');
const { minConfidenceForAutoDiagnosis } = require('../config/health/serviceWeights');

/**
 * SreAgentService - Especializado em análise de incidentes e diagnósticos de sistema via IA.
 */
class SreAgentService {
  constructor() {
    this.anthropic = anthropicClient;
    
    // Fallback para OpenAI se necessário
    if (!this.anthropic) {
      try {
        const OpenAI = require('openai');
        this.openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });
      } catch (e) {
        logger.debug('SreAgentService: OpenAI fallback not available');
      }
    }
  }

  /**
   * Analisa um incidente específico baseado no seu log de contexto.
   */
  async diagnoseIncident(logEntry) {
    if (!this.anthropic && !this.openai) {
      logger.warn('SreAgentService: No AI client available (Anthropic/OpenAI missing)');
      return null;
    }

    // Confidence check
    try {
      const { history } = await healthHistoryService.getTrend(5);
      if (history && history.length > 0) {
        const latestConfidence = history[0].confidence_level;
        if (latestConfidence < (minConfidenceForAutoDiagnosis || 0.7)) {
          logger.warn('SreAgentService: Auto-diagnosis skipped — health confidence too low', {
            correlation_id: logEntry.correlation_id,
            confidence: latestConfidence
          });
          return null;
        }
      }
    } catch (e) {
      logger.debug('SreAgentService: Health check skipped');
    }

    const { correlation_id, metadata_snapshot, severity, severity_reason, method, path, status_code } = logEntry;
    
    const systemPrompt = `Você é o Engenheiro de Confiabilidade de Site (SRE) Sênior da ElosCloud.
Sua tarefa é analisar logs técnicos de erro (Node.js/Express) e fornecer um diagnóstico preciso em JSON.

Estrutura JSON esperada:
{
  "classification": "INFRA | AUTH | DATABASE | VALIDATION | EXTERNAL_API",
  "rca": "Causa Raiz detalhada",
  "suggested_fix": "Sugestão objetiva de correção",
  "proposed_patch": {
    "filePath": "caminho/do/arquivo.js",
    "oldCode": "codigo antigo",
    "newCode": "codigo novo"
  }
}`;

    const userPrompt = `Analise este incidente:
Endpoint: ${method || 'N/A'} ${path || 'N/A'}
Status: ${status_code || 'N/A'}
Severidade: ${severity}
Motivo: ${severity_reason}
Snapshot técnico: ${JSON.stringify(metadata_snapshot)}

Forneça o diagnóstico técnico em JSON.`;

    try {
      let diagnosis;

      if (this.anthropic) {
        logger.info('SreAgentService: Diagnosing via Claude (Anthropic)', { correlation_id });
        const response = await this.anthropic.messages.create({
          model: process.env.AI_MODEL_NAME || 'claude-3-5-sonnet-20240620',
          max_tokens: 1500,
          system: systemPrompt,
          messages: [{ role: 'user', content: userPrompt }]
        });
        
        const rawContent = response.content[0].text.trim();
        diagnosis = JSON.parse(rawContent.replace(/^```json\s*/i, '').replace(/\s*```$/i, '').trim());
      } else {
        logger.info('SreAgentService: Diagnosing via GPT (OpenAI Fallback)', { correlation_id });
        const response = await this.openai.chat.completions.create({
          model: 'gpt-4o-mini',
          messages: [
            { role: 'system', content: systemPrompt },
            { role: 'user', content: userPrompt }
          ],
          response_format: { type: 'json_object' }
        });
        diagnosis = JSON.parse(response.choices[0].message.content);
      }

      const diagnosisResult = {
        ai_diagnosis: diagnosis,
        diagnosed_at: new Date().toISOString()
      };

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
      const canOpen = await AutofixGuard.canOpenPR(filePath);
      if (!canOpen) return;

      const isValid = await AutofixGuard.validatePatch(filePath, oldCode, newCode);
      if (!isValid) return;

      const flowId = filePath.includes('payment') ? 'payment' : (filePath.includes('auth') ? 'auth' : 'general');
      
      if (AutofixGuard.requiresHumanApproval(flowId)) {
        await AutofixGuard.recordHumanApprovalNeeded({
          correlation_id,
          filePath,
          patch,
          diagnosis
        }, `Flow ${flowId} requires manual review.`);
        return;
      }

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

        await AutofixGuard.recordPROpened(filePath, prUrl, fix);
        await SreRepository.updateDiagnosis(correlation_id, {
          ai_diagnosis: { ...diagnosis, pr_url: prUrl }
        });
        
        logger.info('SreAgentService: Shadow PR created', { correlation_id, prUrl });
      }
    } catch (error) {
      logger.error('SreAgentService: Failed to handle Shadow PR', { correlation_id, error: error.message });
    }
  }

  /**
   * Processa um lote de incidentes pendentes de diagnóstico.
   */
  async processPendingIncidents(limit = 5) {
    const pendingLogs = await SreRepository.getPendingDiagnostics(limit);
    if (pendingLogs.length === 0) return 0;

    for (const log of pendingLogs) {
      const diagnosisResult = await this.diagnoseIncident(log);
      if (diagnosisResult) {
        await SreRepository.updateDiagnosis(log.correlation_id, diagnosisResult);
      }
    }
    return pendingLogs.length;
  }
}

module.exports = new SreAgentService();
