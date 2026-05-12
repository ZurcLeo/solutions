const BaseFlow = require('./BaseFlow');

/**
 * Valida o monitoramento de Saúde Real (Health Check).
 * 
 * Testa se o endpoint /api/health/public:
 *   1. Retorna status 200 e 'healthy' em condições normais.
 *   2. Realiza pings reais ao Firestore, OpenAI e Asaas.
 *   3. Detecta falhas de infraestrutura (simuladas via análise de response).
 */
class HealthFlow extends BaseFlow {
  constructor(runId, backendUrl) {
    super('health', 'api', runId, backendUrl);
  }

  async run() {
    // 1. Verificar Saúde Pública (Sem Auth)
    await this.step('check_public_health', async ({ axios }) => {
      const res = await axios.get('/api/health/public');
      
      const { status, dependencies } = res.data;
      
      return {
        overallStatus: status,
        dbStatus: dependencies?.database?.status,
        openaiStatus: dependencies?.openai?.status,
        asaasStatus: dependencies?.asaas?.status,
        isHealthy: status === 'healthy'
      };
    });

    // 2. Validar Detalhes de Dependências
    await this.step('validate_dependency_pings', async ({ axios }) => {
      const res = await axios.get('/api/health/public');
      const { dependencies } = res.data;

      if (!dependencies.database || !dependencies.openai || !dependencies.asaas) {
        throw new Error('Endpoint de saúde não retornou todas as dependências obrigatórias');
      }

      return {
        dbResponseTime: dependencies.database.responseTime,
        openaiResponseTime: dependencies.openai.responseTime,
        asaasResponseTime: dependencies.asaas.responseTime
      };
    });

    // 3. Verificar Saúde Completa (Simulando análise de erro se necessário)
    // Nota: Em um run real, se o status for 'error', o Claude reportará como bug crítico.
    // O objetivo deste flow no Orchestrator é garantir que o monitoramento ESTÁ ATIVO.
    await this.step('verify_monitoring_active', async ({ axios }) => {
      const res = await axios.get('/api/health/public');
      return {
        timestamp: res.data.timestamp,
        version: res.data.version,
        uptime: res.data.uptime
      };
    });

    return this.result();
  }
}

module.exports = HealthFlow;
