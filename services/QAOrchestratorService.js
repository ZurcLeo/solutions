const crypto        = require('crypto');
const { v4: uuidv4 } = require('uuid');
const { getSupabaseClient } = require('../config/supabase');
const anthropicClient  = require('../config/anthropic/anthropicClient');
const TestUserFactory  = require('./TestUserFactory');
const BugReporter      = require('./BugReporter');
const AutofixGuard     = require('./AutofixGuard');
const GitHubService    = require('./GitHubService');
const AuthFlow         = require('./FlowSimulator/AuthFlow');
const InviteFlow       = require('./FlowSimulator/InviteFlow');
const CaixinhaFlow     = require('./FlowSimulator/CaixinhaFlow');
const FinancialFlow    = require('./FlowSimulator/FinancialFlow');
const LoanFlow         = require('./FlowSimulator/LoanFlow');
const WebhookFlow      = require('./FlowSimulator/WebhookFlow');
const HealthFlow       = require('./FlowSimulator/HealthFlow');
const SocialFlow       = require('./FlowSimulator/SocialFlow');
const NotificationFlow = require('./FlowSimulator/NotificationFlow');
const { logger }       = require('../logger');

const CACHE_TTL_MS     = 60 * 60 * 1000; // 1 hora

/**
 * Orquestrador principal do sistema de QA com IA.
 */
class QAOrchestratorService {
  constructor(options = {}) {
    this.backendUrl   = options.backendUrl   || process.env.QA_BACKEND_URL || '';
    this.triggeredBy  = options.triggeredBy  || 'manual';
  }

  /**
   * Executa o suite completo de QA.
   * Cria um usuário isolado, roda os flows, interpreta com Claude e persiste.
   *
   * @returns {Promise<{ runId, report, rawResults }>}
   */
  async runFullSuite(runId) {
    if (!runId) runId = `run_${new Date().toISOString().replace(/[:.]/g, '-')}_${uuidv4().split('-')[0]}`;
    const startedAt = new Date();
    let testUser    = null;
    let secondUser  = null;
    let rawResults  = [];

    try {
      // Limpeza preventiva de usuários de teste obsoletos
      await TestUserFactory.cleanupStale(24).catch(err =>
        logger.warn('QAOrchestrator: cleanupStale falhou (não crítico)', {
          service: 'QAOrchestratorService', error: err.message,
        })
      );

      logger.info('QAOrchestrator: iniciando run', {
        service: 'QAOrchestratorService', runId, triggeredBy: this.triggeredBy,
      });

      logger.info('QAOrchestrator: Criando usuários de teste isolados...', { runId });
      testUser   = await TestUserFactory.createIsolated(runId);
      logger.info('QAOrchestrator: Usuário 1 criado', { uid: testUser.uid });

      secondUser = await TestUserFactory.createIsolated(runId);
      logger.info('QAOrchestrator: Usuário 2 criado', { uid: secondUser.uid });

      logger.info('QAOrchestrator: Iniciando execução de flows...', { runId });
      rawResults = await this._runFlows(testUser, secondUser, runId);
      logger.info('QAOrchestrator: Execução de flows concluída', { runId, flowsCount: rawResults.length });

      // Interpreta com Claude (com cache)
      logger.info('QAOrchestrator: Solicitando interpretação da IA...', { runId });
      const claudeReport = await this._interpretWithClaude(rawResults);

      // Persiste no Firestore
      await BugReporter.saveRun({
        runId,
        triggeredBy: this.triggeredBy,
        startedAt,
        claudeReport,
        rawResults,
      });

      logger.info('QAOrchestrator: run concluído', {
        service:     'QAOrchestratorService',
        runId,
        healthScore: claudeReport.healthScore,
        fromCache:   claudeReport.fromCache,
      });

      // Fase 3 — tenta propor fixes para bugs recorrentes (fire-and-forget)
      this._proposeFixesForRecurringBugs(claudeReport).catch(err =>
        logger.warn('QAOrchestrator: proposeFixesForRecurringBugs falhou (não crítico)', {
          service: 'QAOrchestratorService', error: err.message,
        })
      );

      return { runId, report: claudeReport, rawResults };

    } catch (criticalError) {
      logger.error('QAOrchestrator: falha crítica no run suite', {
        service: 'QAOrchestratorService', runId, error: criticalError.message
      });

      // Salva o erro como um run falho para não "sumir" do histórico
      try {
        await BugReporter.saveRun({
          runId,
          triggeredBy: this.triggeredBy,
          startedAt,
          claudeReport: {
            summary: `Falha crítica na inicialização: ${criticalError.message}`,
            healthScore: 0,
            criticalBugs: [{ flow: 'setup', step: 'initialization', error: criticalError.message }]
          },
          rawResults: rawResults.length ? rawResults : [{ flowId: 'setup', passed: false, steps: [] }]
        });
      } catch (err) {
        logger.error('BugReporter: falha ao salvar run com erro crítico', { error: err.message });
      }

      throw criticalError;

    } finally {
      // Cleanup garantido mesmo em caso de erro
      const toClean = [testUser, secondUser].filter(Boolean);
      await Promise.allSettled(
        toClean.map(u =>
          TestUserFactory.cleanup(u).catch(err =>
            logger.error('QAOrchestrator: cleanup falhou', {
              service: 'QAOrchestratorService', uid: u.uid, error: err.message,
            })
          )
        )
      );
    }
  }

  /**
   * Executa cada flow em sequência.
   * O AuthFlow enriquece testUser com accessToken/refreshToken.
   * CaixinhaFlow recebe secondUser para o ciclo de convite de membro.
   */
  async _runFlows(testUser, secondUser, runId) {
    // Definição dos flows com seus runners
    const flowDefs = [
      {
        flow:   new HealthFlow(runId, this.backendUrl),
        runner: (f) => f.run(),
      },
      {
        flow:   new AuthFlow(runId, this.backendUrl),
        runner: (f) => f.run(testUser),
      },
      {
        flow:   new InviteFlow(runId, this.backendUrl),
        runner: (f) => f.run(testUser),
      },
      {
        flow:   new CaixinhaFlow(runId, this.backendUrl),
        runner: (f) => f.run(testUser, secondUser),
      },
      {
        flow:   new FinancialFlow(runId, this.backendUrl),
        runner: (f) => f.run(testUser),
      },
      {
        flow:   new LoanFlow(runId, this.backendUrl),
        runner: (f) => f.run(testUser, secondUser),
      },
      {
        flow:   new WebhookFlow(runId, this.backendUrl),
        runner: (f) => f.run(testUser),
      },
      {
        flow:   new SocialFlow(runId, this.backendUrl),
        runner: (f) => f.run(testUser, secondUser),
      },
      {
        flow:   new NotificationFlow(runId, this.backendUrl),
        runner: (f) => f.run(testUser, secondUser),
      },
    ];

    // Troca de token para ambos os usuários
    for (const user of [testUser, secondUser].filter(Boolean)) {
      if (user.accessToken) continue;
      try {
        const customToken = await TestUserFactory.createCustomToken(user.uid);
        const { idToken } = await TestUserFactory.exchangeCustomTokenForIdToken(customToken);

        const axios = require('axios');
        const url   = `${this.backendUrl || 'http://localhost:8080'}/api/auth/token`;
        const res   = await axios.post(url, { firebaseToken: idToken }, { timeout: 15000 });

        user.accessToken  = res.data.tokens?.accessToken  || res.data.accessToken;
        user.refreshToken = res.data.tokens?.refreshToken || res.data.refreshToken;
      } catch (err) {
        logger.warn('QAOrchestrator: falha ao obter token para usuário de teste', {
          service: 'QAOrchestratorService', uid: user.uid, error: err.message,
        });
      }
    }

    const results = [];
    for (const { flow, runner } of flowDefs) {
      try {
        logger.info(`QAOrchestrator: Executando flow "${flow.flowId}"`, { runId });
        const result = await runner(flow);
        results.push(result);
      } catch (err) {
        logger.error(`QAOrchestrator: flow "${flow.flowId}" lançou exceção não tratada`, {
          service: 'QAOrchestratorService', flowId: flow.flowId, error: err.message,
        });
        results.push({
          flowId:    flow.flowId,
          layer:     flow.layer,
          passed:    false,
          steps:     [],
          failedSteps: ['FLOW_EXCEPTION'],
          error:     err.message,
        });
      }
    }
    return results;
  }

  /**
   * Envia os resultados brutos para o Claude (Haiku) para interpretação.
   * Usa cache SHA-256 para evitar chamadas repetidas quando os resultados não mudaram.
   */
  async _interpretWithClaude(rawResults) {
    const hash = crypto
      .createHash('sha256')
      .update(JSON.stringify(rawResults))
      .digest('hex');

    const cached = await this._checkCache(hash);
    if (cached) return { ...cached, fromCache: true };

    if (!anthropicClient) {
      const fallback = this._fallbackInterpretation(rawResults);
      await this._saveCache(hash, fallback);
      return fallback;
    }

    try {
      const report = await this._callClaude(rawResults);
      await this._saveCache(hash, report);
      return { ...report, fromCache: false };
    } catch (err) {
      logger.error('QAOrchestrator: chamada ao Claude falhou, usando fallback', {
        service: 'QAOrchestratorService', error: err.message,
      });
      const fallback = this._fallbackInterpretation(rawResults);
      return fallback;
    }
  }

  async _callClaude(rawResults) {
    const message = await anthropicClient.messages.create({
      model:      process.env.AI_MODEL_NAME || 'claude-haiku-4-5-20251001',
      max_tokens: 1500,
      system: `Você é um engenheiro de QA sênior analisando resultados de testes automatizados
da plataforma ElosCloud (aplicação financeira colaborativa brasileira — "caixinhas").

Analise os resultados dos flows e retorne APENAS um objeto JSON válido, sem markdown,
sem texto adicional antes ou depois. O JSON deve seguir exatamente esta estrutura:

{
  "summary": "string — resumo executivo em português, max 200 caracteres",
  "healthScore": number — 0 a 100 (100 = tudo passou),
  "criticalBugs": [
    {
      "flow": "string",
      "step": "string",
      "error": "string — descrição do erro",
      "affectedUsers": "string — quem é impactado",
      "suggestedFix": "string — sugestão objetiva de correção"
    }
  ],
  "minorBugs": [
    {
      "flow": "string",
      "step": "string",
      "error": "string",
      "suggestedFix": "string"
    }
  ],
  "suggestions": ["string — melhorias proativas"]
}

Critérios de severidade:
- critical: step falhou E impede o usuário de usar a plataforma
- minor: step falhou mas existe workaround OU é degradação de UX
- healthScore: comece em 100, -20 por critical, -5 por minor`,

      messages: [{
        role:    'user',
        content: `Resultados dos flows de QA:\n\n${JSON.stringify(rawResults, null, 2)}`,
      }],
    });

    const raw  = message.content[0].text.trim();
    const text = raw.replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/i, '').trim();
    return JSON.parse(text);
  }

  _fallbackInterpretation(rawResults) {
    const failedFlows = rawResults.filter(r => !r.passed);
    const allSteps    = rawResults.flatMap(r => r.steps || []);
    const failedSteps = allSteps.filter(s => !s.success);

    const healthScore = rawResults.length === 0
      ? 100
      : Math.round((rawResults.filter(r => r.passed).length / rawResults.length) * 100);

    const criticalBugs = failedSteps.map(s => ({
      flow:          rawResults.find(r => r.steps?.some(st => st.name === s.name))?.flowId || 'unknown',
      step:          s.name,
      error:         s.error || 'Erro desconhecido',
      affectedUsers: 'Todos os usuários',
      suggestedFix:  'Verificar logs com correlationId: ' + (s.correlationId || 'N/A'),
    }));

    return {
      summary:      failedSteps.length === 0
        ? `Todos os ${allSteps.length} steps passaram com sucesso.`
        : `${failedSteps.length} step(s) falharam em ${failedFlows.length} flow(s).`,
      healthScore,
      criticalBugs,
      minorBugs:    [],
      suggestions:  ['Ative o ANTHROPIC_API_KEY para interpretação detalhada com IA'],
      fromCache:    false,
    };
  }

  async _checkCache(hash) {
    try {
      const supabase = getSupabaseClient();
      if (!supabase) return null;

      const { data, error } = await supabase
        .from('qa_interpretation_cache')
        .select('*')
        .eq('hash', hash)
        .single();

      if (error || !data) return null;

      const cachedAt = new Date(data.cached_at).getTime();
      const age = Date.now() - cachedAt;
      if (age > CACHE_TTL_MS) return null;

      logger.info('QAOrchestrator: cache hit para interpretação Claude', {
        service: 'QAOrchestratorService',
        hash:    hash.slice(0, 8),
        ageMins: Math.round(age / 60000),
      });
      return data.report;
    } catch {
      return null;
    }
  }

  async _saveCache(hash, report) {
    try {
      const supabase = getSupabaseClient();
      if (!supabase) return;

      await supabase
        .from('qa_interpretation_cache')
        .upsert([{
          hash,
          report,
          cached_at: new Date().toISOString(),
        }]);
    } catch (err) {
      logger.warn('QAOrchestrator: falha ao salvar cache', {
        service: 'QAOrchestratorService', error: err.message,
      });
    }
  }

  async _proposeFixesForRecurringBugs(claudeReport) {
    // Precisa de IA para gerar propostas de fix; GitHub é necessário apenas para PRs automáticos.
    if (!anthropicClient) {
      logger.info('QAOrchestrator: anthropicClient não disponível — propostas de fix desabilitadas', {
        service: 'QAOrchestratorService',
      });
      return;
    }

    const currentBugs = claudeReport.criticalBugs || [];
    if (currentBugs.length === 0) return;

    const recentBugs = await BugReporter.getRecentBugs(7);

    for (const bug of currentBugs) {
      const occurrences = recentBugs.filter(
        b => b.flow === bug.flow && b.step === bug.step
      );

      const isRecurring = occurrences.length >= 2;

      if (isRecurring && GitHubService._isConfigured()) {
        // Bug recorrente + GitHub configurado → tenta PR automático
        logger.info('QAOrchestrator: bug recorrente detectado — iniciando análise de autofix', {
          service: 'QAOrchestratorService', flow: bug.flow, step: bug.step,
          occurrences: occurrences.length,
        });
        await this._handleAutofixForBug(bug).catch(err =>
          logger.error('QAOrchestrator: _handleAutofixForBug falhou', {
            service: 'QAOrchestratorService', flow: bug.flow, step: bug.step,
            error: err.message,
          })
        );
      } else {
        // Primeira ocorrência OU GitHub não configurado:
        // gera proposta de fix e registra em qa_autofix_pending para revisão humana.
        logger.info('QAOrchestrator: bug crítico detectado — gerando proposta para revisão humana', {
          service: 'QAOrchestratorService', flow: bug.flow, step: bug.step,
          isRecurring, githubConfigured: GitHubService._isConfigured(),
        });
        await this._proposeAndRecordForReview(bug).catch(err =>
          logger.warn('QAOrchestrator: _proposeAndRecordForReview falhou', {
            service: 'QAOrchestratorService', flow: bug.flow, step: bug.step,
            error: err.message,
          })
        );
      }
    }
  }

  /**
   * Gera uma proposta de fix via IA e registra em qa_autofix_pending para revisão humana.
   * Chamado na primeira ocorrência de um bug crítico (antes de tentar PR automático).
   */
  async _proposeAndRecordForReview(bug) {
    let fix = null;

    try {
      fix = await this._generateFixProposal(bug);
      logger.info('QAOrchestrator: proposta de fix gerada com sucesso', {
        service: 'QAOrchestratorService',
        flow: bug.flow, step: bug.step, filePath: fix.filePath,
      });
    } catch (err) {
      logger.warn('QAOrchestrator: não foi possível gerar proposta de fix — registrando bug sem patch', {
        service: 'QAOrchestratorService', flow: bug.flow, step: bug.step,
        error: err.message,
      });
    }

    const reason = fix
      ? `Bug crítico em ${bug.flow}/${bug.step}. Patch proposto pela IA aguarda revisão.`
      : `Bug crítico em ${bug.flow}/${bug.step}. Geração de patch indisponível — registrado para acompanhamento.`;

    await AutofixGuard.recordHumanApprovalNeeded(
      { ...bug, proposedFix: fix || null },
      reason
    );

    logger.info('QAOrchestrator: proposta registrada em qa_autofix_pending', {
      service:   'QAOrchestratorService',
      flow:      bug.flow,
      step:      bug.step,
      hasPatch:  !!fix,
      filePath:  fix?.filePath || null,
    });
  }

  async _handleAutofixForBug(bug) {
    if (AutofixGuard.requiresHumanApproval(bug.flow)) {
      logger.info('QAOrchestrator: flow crítico — bloqueando autofix e registrando para revisão', {
        service: 'QAOrchestratorService', flow: bug.flow,
      });
      await AutofixGuard.recordHumanApprovalNeeded(bug,
        `Flow '${bug.flow}' requer aprovação humana antes de qualquer autofix`
      );
      return;
    }

    let fix;
    try {
      fix = await this._generateFixProposal(bug);
    } catch (err) {
      logger.warn('QAOrchestrator: geração de fix falhou — registrando para revisão humana', {
        service: 'QAOrchestratorService', flow: bug.flow, step: bug.step,
        error: err.message,
      });
      await AutofixGuard.recordHumanApprovalNeeded(
        { ...bug, proposedFix: null },
        `Bug recorrente em ${bug.flow}/${bug.step}. Patch automático indisponível: ${err.message}`
      );
      return;
    }

    const allowed = await AutofixGuard.canOpenPR(fix.filePath);
    if (!allowed) return;

    const patchOk = await AutofixGuard.validatePatch(
      fix.filePath, fix.patch.oldCode, fix.patch.newCode
    );
    if (!patchOk) return;

    let branchName;
    try {
      branchName = await GitHubService.createBranchWithFix(fix);
      const prUrl = await GitHubService.openPR(branchName, fix);
      await AutofixGuard.recordPROpened(fix.filePath, prUrl, fix);

      logger.info('QAOrchestrator: PR de autofix aberto com sucesso', {
        service: 'QAOrchestratorService', prUrl, branchName,
      });
    } catch (err) {
      logger.error('QAOrchestrator: falha ao criar branch/PR', {
        service: 'QAOrchestratorService', error: err.message,
      });
      if (branchName) {
        await GitHubService.deleteBranch(branchName).catch(() => {});
      }
    }
  }

  /**
   * Re-gera proposta de fix com a direção explícita do desenvolvedor.
   * Idêntico a _generateFixProposal mas injeta o `developerGuidance` nos prompts
   * como instrução de prioridade máxima — sobrepondo a sugestão original da IA.
   *
   * @param {object} bug               — bug object do qa_autofix_pending
   * @param {string} developerGuidance — instrução do desenvolvedor
   * @returns {Promise<object>} fix { flowId, stepId, filePath, description, explanation, patch }
   */
  async _generateFixWithGuidance(bug, developerGuidance) {
    if (!anthropicClient) throw new Error('Anthropic client não disponível');

    const step1 = await anthropicClient.messages.create({
      model:      process.env.AI_MODEL_NAME || 'claude-haiku-4-5-20251001',
      max_tokens: 300,
      system: `Você é um engenheiro sênior do projeto ElosCloud (Node.js/Express + Firebase).
O repositório GitHub é ZurcLeo/solutions. Os arquivos estão na RAIZ do repositório (sem prefixo de pasta).
Exemplos de paths corretos: "services/contribuicaoService.js", "models/Membro.js", "controllers/caixinhaController.js"
NÃO use prefixos como "backend/", "eloscloudapp/", "src/" — o arquivo deve estar acessível em:
https://github.com/ZurcLeo/solutions/blob/main/{filePath}

DIREÇÃO DO DESENVOLVEDOR (prioridade máxima): "${developerGuidance}"
Use essa direção específica para identificar o arquivo EXATO que precisa ser modificado para implementá-la.

Dado o bug e a direção, retorne APENAS JSON válido, sem markdown:
{
  "filePath": "services/NomeDoService.js",
  "confidence": "high|medium|low",
  "reason": "1 frase explicando por que esse arquivo"
}`,
      messages: [{
        role:    'user',
        content: `Bug recorrente:
Flow: ${bug.flow}
Step: ${bug.step}
Erro: ${bug.error}
IA sugeriu: ${bug.suggestedFix}

O DESENVOLVEDOR QUER (implementar exatamente isso): ${developerGuidance}

Qual arquivo do repositório ZurcLeo/solutions contém o código que precisa ser modificado?`,
      }],
    });

    let fileIdentification;
    try {
      const raw1 = step1.content[0].text.trim();
      const txt1 = raw1.replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/i, '').trim();
      fileIdentification = JSON.parse(txt1);
    } catch {
      throw new Error('Claude retornou JSON inválido na etapa 1 (guided)');
    }

    if (fileIdentification.confidence === 'low') {
      throw new Error(`Confiança baixa: ${fileIdentification.reason}`);
    }

    const rawPath = fileIdentification.filePath || '';
    fileIdentification.filePath = rawPath
      .replace(/^backend\/eloscloudapp\//, '')
      .replace(/^eloscloudapp\//, '')
      .replace(/^backend\//, '')
      .replace(/^\.\//, '');

    let fileContent;
    try {
      const result = await GitHubService.getFileContent(fileIdentification.filePath);
      fileContent  = result.content;
    } catch (err) {
      throw new Error(`Arquivo não encontrado no repo ZurcLeo/solutions: ${fileIdentification.filePath}`);
    }

    const step2 = await anthropicClient.messages.create({
      model:      process.env.AI_MODEL_NAME || 'claude-haiku-4-5-20251001',
      max_tokens: 1000,
      system: `Você é um engenheiro sênior do projeto ElosCloud.
Receba um bug, a direção do desenvolvedor e o conteúdo do arquivo onde ele ocorre.
Retorne APENAS JSON válido, sem markdown:
{
  "description": "título curto do fix (max 60 chars)",
  "explanation": "explicação detalhada para o PR body (2-3 parágrafos)",
  "patch": {
    "oldCode": "string exata que EXISTE no arquivo e deve ser substituída",
    "newCode": "string de substituição"
  }
}

DIREÇÃO OBRIGATÓRIA DO DESENVOLVEDOR (implementar EXATAMENTE isso, NÃO a sugestão da IA):
"${developerGuidance}"

IMPORTANTE:
- oldCode deve ser uma string EXATA encontrada no arquivo
- O patch DEVE implementar a direção do desenvolvedor, não a sugestão automática
- Se não houver implementação segura possível, retorne {"error": "motivo"}`,
      messages: [{
        role:    'user',
        content: `Bug: ${bug.error}
IA sugeriu originalmente: ${bug.suggestedFix}
O DESENVOLVEDOR QUER: ${developerGuidance}

Conteúdo atual do arquivo ${fileIdentification.filePath}:
\`\`\`javascript
${fileContent.slice(0, 4000)}${fileContent.length > 4000 ? '\n... (truncado)' : ''}
\`\`\`

Crie um patch que implementa EXATAMENTE a direção do desenvolvedor.`,
      }],
    });

    let patchResult;
    try {
      const raw2 = step2.content[0].text.trim();
      const txt2 = raw2.replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/i, '').trim();
      patchResult = JSON.parse(txt2);
    } catch {
      throw new Error('Claude retornou JSON inválido na etapa 2 (guided)');
    }

    if (patchResult.error) {
      throw new Error(`Claude recusou gerar patch: ${patchResult.error}`);
    }

    return {
      flowId:      bug.flow,
      stepId:      bug.step,
      filePath:    fileIdentification.filePath,
      description: patchResult.description,
      explanation: patchResult.explanation,
      patch:       patchResult.patch,
    };
  }

  async _generateFixProposal(bug) {
    if (!anthropicClient) {
      throw new Error('Anthropic client não disponível para geração de fix');
    }

    const step1 = await anthropicClient.messages.create({
      model:      process.env.AI_MODEL_NAME || 'claude-haiku-4-5-20251001',
      max_tokens: 300,
      system: `Você é um engenheiro sênior do projeto ElosCloud (Node.js/Express + Firebase).
O repositório GitHub é ZurcLeo/solutions. Os arquivos estão na RAIZ do repositório (sem prefixo de pasta).
Exemplos de paths corretos: "services/contribuicaoService.js", "models/Membro.js", "controllers/caixinhaController.js"
NÃO use prefixos como "backend/", "eloscloudapp/", "src/" — o arquivo deve estar acessível em:
https://github.com/ZurcLeo/solutions/blob/main/{filePath}

Dado um bug, retorne APENAS JSON válido, sem markdown:
{
  "filePath": "services/NomeDoService.js",
  "confidence": "high|medium|low",
  "reason": "1 frase explicando por que esse arquivo"
}`,
      messages: [{
        role:    'user',
        content: `Bug recorrente:
Flow: ${bug.flow}
Step: ${bug.step}
Erro: ${bug.error}
Impacto: ${bug.affectedUsers}
Sugestão de fix: ${bug.suggestedFix}

Qual arquivo do repositório contém o código que precisa ser modificado?`,
      }],
    });

    let fileIdentification;
    try {
      const raw1 = step1.content[0].text.trim();
      const txt1 = raw1.replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/i, '').trim();
      fileIdentification = JSON.parse(txt1);
    } catch {
      throw new Error('Claude retornou JSON inválido na etapa 1');
    }

    if (fileIdentification.confidence === 'low') {
      throw new Error(`Confiança baixa: ${fileIdentification.reason}`);
    }

    // Normaliza o path: remove prefixos locais que não existem no GitHub repo
    const rawPath = fileIdentification.filePath || '';
    const normalizedPath = rawPath
      .replace(/^backend\/eloscloudapp\//, '')
      .replace(/^eloscloudapp\//, '')
      .replace(/^backend\//, '')
      .replace(/^\.\//, '');
    fileIdentification.filePath = normalizedPath;

    let fileContent;
    try {
      const result = await GitHubService.getFileContent(fileIdentification.filePath);
      fileContent  = result.content;
    } catch (err) {
      throw new Error(`Arquivo não encontrado no repo ZurcLeo/solutions: ${fileIdentification.filePath}`);
    }

    const step2 = await anthropicClient.messages.create({
      model:      process.env.AI_MODEL_NAME || 'claude-haiku-4-5-20251001',
      max_tokens: 1000,
      system: `Você é um engenheiro sênior do projeto ElosCloud.
Receba um bug e o conteúdo do arquivo onde ele ocorre.
Retorne APENAS JSON válido, sem markdown:
{
  "description": "título curto do fix (max 60 chars)",
  "explanation": "explicação detalhada para o PR body (2-3 parágrafos)",
  "patch": {
    "oldCode": "string exata que EXISTE no arquivo e deve ser substituída",
    "newCode": "string de substituição"
  }
}

IMPORTANTE:
- oldCode deve ser uma string EXATA encontrada no arquivo
- Se não houver fix seguro possível, retorne {"error": "motivo"}`,
      messages: [{
        role:    'user',
        content: `Bug: ${bug.error}
Sugestão: ${bug.suggestedFix}

Conteúdo atual do arquivo ${fileIdentification.filePath}:
\`\`\`javascript
${fileContent.slice(0, 4000)}${fileContent.length > 4000 ? '\n... (truncado)' : ''}
\`\`\``,
      }],
    });

    let patchResult;
    try {
      const raw2 = step2.content[0].text.trim();
      const txt2 = raw2.replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/i, '').trim();
      patchResult = JSON.parse(txt2);
    } catch {
      throw new Error('Claude retornou JSON inválido na etapa 2');
    }

    if (patchResult.error) {
      throw new Error(`Claude recusou gerar patch: ${patchResult.error}`);
    }

    return {
      flowId:      bug.flow,
      stepId:      bug.step,
      filePath:    fileIdentification.filePath,
      description: patchResult.description,
      explanation: patchResult.explanation,
      patch:       patchResult.patch,
    };
  }
}

module.exports = QAOrchestratorService;
