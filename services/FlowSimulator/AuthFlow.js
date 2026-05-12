const BaseFlow = require('./BaseFlow');
const TestUserFactory = require('../TestUserFactory');
const { getAuth } = require('../../firebaseAdmin');
const axios = require('axios');
const { logger } = require('../../logger');

/**
 * Simula o fluxo de autenticação via API.
 *
 * Estratégia:
 * 1. TestUserFactory cria o usuário via Firebase Admin (sem passar pelos middlewares de segurança)
 * 2. Gera um custom token e o troca por JWT customizado via /api/auth/token
 * 3. Testa os endpoints autenticados: /api/auth/me e /api/auth/session
 * 4. Testa renovação de token via /api/auth/refresh-token
 *
 * Por que não testa /api/auth/register diretamente:
 * - O endpoint tem deviceCheck + velocityCheck que bloqueiam runs automáticos frequentes.
 * - A criação via Firebase Admin SDK é equivalente para fins de QA da lógica de negócio.
 * - O registro via UI será coberto pelo UIFlowSimulator (Playwright) na Fase 2.
 */
class AuthFlow extends BaseFlow {
  constructor(runId, backendUrl) {
    super('auth', 'api', runId, backendUrl);
  }

  async run(testUser) {
    // Passo 1: Obter token de acesso via custom token Firebase
    await this.step('exchange_custom_token', async ({ axios: ax }) => {
      // Admin SDK gera custom token → Firebase REST API converte em ID token → backend emite JWT
      const customToken = await TestUserFactory.createCustomToken(testUser.uid);
      const { idToken } = await TestUserFactory.exchangeCustomTokenForIdToken(customToken);

      // Troca o ID token (Firebase) pelo JWT da aplicação
      const res = await ax.post('/api/auth/token', { firebaseToken: idToken });

      // Backend /api/auth/token retorna { tokens: { accessToken, refreshToken } }
      const tokens = res.data.tokens || res.data;
      testUser.accessToken  = tokens.accessToken;
      testUser.refreshToken = tokens.refreshToken;

      return {
        hasAccessToken:  !!tokens.accessToken,
        hasRefreshToken: !!tokens.refreshToken,
        expiresIn:       tokens.expiresIn || res.data.expiresIn,
      };
    });

    // Se o exchange falhou, os demais steps não têm token — continuamos mas vão falhar
    const authHeader = testUser.accessToken
      ? { Authorization: `Bearer ${testUser.accessToken}` }
      : {};

    // Passo 2: Verificar dados do usuário autenticado
    await this.step('get_current_user', async ({ axios: ax }) => {
      const res = await ax.get('/api/auth/me', { headers: authHeader });
      return {
        hasUid:          !!res.data.uid,
        hasEmail:        !!res.data.email,
        emailMatchesUser: res.data.email === testUser.email,
      };
    });

    // Passo 3: Verificar estado da sessão
    await this.step('check_session', async ({ axios: ax }) => {
      const res = await ax.get('/api/auth/session', { headers: authHeader });
      return {
        isAuthenticated: res.data.isAuthenticated === true,
      };
    });

    // Passo 4: Renovar token (só se temos refresh token)
    if (testUser.refreshToken) {
      await this.step('refresh_token', async ({ axios: ax }) => {
        const res = await ax.post(
          '/api/auth/refresh-token',
          { refreshToken: testUser.refreshToken },
          { headers: authHeader }
        );

        // Atualiza tokens para uso nos flows subsequentes
        if (res.data.accessToken) {
          testUser.accessToken  = res.data.accessToken;
          testUser.refreshToken = res.data.refreshToken || testUser.refreshToken;
        }

        return {
          tokenRenewed:   !!res.data.accessToken,
          newTokenDiffers: res.data.accessToken !== testUser.accessToken,
        };
      });
    }

    return this.result();
  }
}

module.exports = AuthFlow;
