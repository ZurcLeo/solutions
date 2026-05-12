const BaseFlow     = require('./BaseFlow');
const TestUserFactory = require('../TestUserFactory');
const { logger }   = require('../../logger');

/**
 * Simula o fluxo central de caixinhas.
 *
 * Ciclo testado:
 *   criar → buscar → listar (user) → contribuição → convidar membro →
 *   aceitar convite (2º usuário) → listar membros → deletar
 *
 * Detecta automaticamente:
 *  - Erros de criação de caixinha (riskLevel, Firestore, usuario doc ausente)
 *  - Bug de contribuição: Membro sem campo `status` → 'Membro com status
 *    undefined não pode realizar contribuições'
 *  - Falhas no ciclo de convite de membro existente
 *
 * @param {TestUser} testUser  - Usuário admin (do Orchestrator)
 * @param {TestUser} [secondUser] - Usuário convidado. Se omitido, cria internamente.
 */
class CaixinhaFlow extends BaseFlow {
  constructor(runId, backendUrl) {
    super('caixinha', 'api', runId, backendUrl);
    this._secondUserCreatedInternally = false;
  }

  async run(testUser, secondUser = null) {
    // Cria segundo usuário internamente se não foi fornecido
    if (!secondUser) {
      try {
        secondUser = await TestUserFactory.createIsolated(this.runId);
        this._secondUserCreatedInternally = true;

        // Obtém token para o segundo usuário
        const customToken  = await TestUserFactory.createCustomToken(secondUser.uid);
        const tokenResult  = await this._exchangeToken(customToken);
        secondUser.accessToken  = tokenResult.accessToken;
        secondUser.refreshToken = tokenResult.refreshToken;
      } catch (err) {
        logger.error('CaixinhaFlow: falha ao criar segundo usuário', {
          service: 'CaixinhaFlow', error: err.message,
        });
        // Registra como step falho e continua sem segundo usuário
        this.steps.push({
          name:    'setup_second_user',
          success: false,
          duration: 0,
          correlationId: `qa_${this.runId}_caixinha_setup_second_user`,
          error:   err.message,
          artifacts: [],
        });
      }
    }

    const auth1 = { Authorization: `Bearer ${testUser.accessToken}` };
    const auth2 = secondUser?.accessToken
      ? { Authorization: `Bearer ${secondUser.accessToken}` }
      : null;

    let caixinhaId   = null;
    let caixinhaInviteId = null;

    // ── Passo 1: Criar caixinha ───────────────────────────────────────────
    await this.step('create_caixinha', async ({ axios: ax }) => {
      const res = await ax.post('/api/caixinha/', {
        name:               `QA Caixinha ${Date.now()}`,
        description:        'Caixinha criada por QA Orchestrator',
        adminId:            testUser.uid,
        contribuicaoMensal: 100,
        duracaoMeses:       12,
        distribuicaoTipo:   'MENSAL',
        dataCriacao:        new Date().toISOString(),
        permiteEmprestimos: false,
        diaVencimento:      10,
      }, { headers: auth1 });

      caixinhaId = res.data?.id || res.data?.caixinhaId || null;

      return {
        statusCode:   res.status,
        hasCaixinhaId: !!caixinhaId,
        caixinhaId,
      };
    });

    if (!caixinhaId) {
      // Sem caixinha criada, todos os próximos steps são skipped
      return this._skipRemaining('create_caixinha falhou — caixinhaId não retornado');
    }

    // ── Passo 2: Buscar caixinha por ID ───────────────────────────────────
    await this.step('get_caixinha_by_id', async ({ axios: ax }) => {
      const res = await ax.get(`/api/caixinha/id/${caixinhaId}`, { headers: auth1 });
      return {
        statusCode:        res.status,
        nameMatches:       res.data?.name?.startsWith('QA Caixinha'),
        adminIdMatches:    res.data?.adminId === testUser.uid,
        contribuicaoValue: res.data?.contribuicaoMensal,
      };
    });

    // ── Passo 3: Listar caixinhas do usuário ──────────────────────────────
    await this.step('list_user_caixinhas', async ({ axios: ax }) => {
      const res = await ax.get(
        `/api/caixinha/user/${testUser.uid}`,
        { headers: auth1 }
      );
      const list = res.data?.data || res.data || [];
      return {
        statusCode:    res.status,
        count:         Array.isArray(list) ? list.length : null,
        containsNew:   Array.isArray(list) && list.some(c => c.id === caixinhaId),
      };
    });

    // ── Passo 4: Registrar contribuição ──────────────────────────────────
    // NOTA: pode falhar com "Membro com status 'undefined' não pode realizar
    // contribuições" — isso é o Bug de status do Membro que o QA deve detectar.
    await this.step('add_contribuicao', async ({ axios: ax }) => {
      const res = await ax.post(
        `/api/caixinha/${caixinhaId}/contribuicao`,
        { valor: 100, metodo: 'pix' },
        { headers: auth1 }
      );
      return {
        statusCode:      res.status,
        hasContribuicao: !!(res.data?.id || res.data?.contribuicaoId),
      };
    });

    // ── Passo 5: Listar contribuições ─────────────────────────────────────
    await this.step('list_contribuicoes', async ({ axios: ax }) => {
      const res = await ax.get(
        `/api/caixinha/${caixinhaId}/contribuicoes`,
        { headers: auth1 }
      );
      const list = res.data?.contribuicoes || res.data?.data || res.data || [];
      return {
        statusCode: res.status,
        count:      Array.isArray(list) ? list.length : null,
      };
    });

    // ── Passo 6: Convidar segundo usuário para a caixinha ─────────────────
    if (secondUser) {
      await this.step('invite_caixinha_member', async ({ axios: ax }) => {
        const res = await ax.post(
          `/api/caixinha/membros/${caixinhaId}/convite`,
          {
            caixinhaId,
            targetId:   secondUser.uid,
            targetName: secondUser.displayName,
            senderId:   testUser.uid,
            senderName: testUser.displayName,
            type:       'caixinha_invite',
            message:    'Convite de teste QA',
          },
          { headers: auth1 }
        );

        caixinhaInviteId = res.data?.inviteId || res.data?.id || null;

        return {
          statusCode:     res.status,
          hasInviteId:    !!caixinhaInviteId,
          inviteId:       caixinhaInviteId,
        };
      });
    }

    // ── Passo 7: Segundo usuário aceita o convite ─────────────────────────
    if (secondUser && auth2 && caixinhaInviteId) {
      await this.step('accept_caixinha_invite', async ({ axios: ax }) => {
        const res = await ax.post(
          `/api/caixinha/membros/convite/${caixinhaInviteId}/aceitar`,
          { userId: secondUser.uid },
          { headers: auth2 }
        );
        return {
          statusCode: res.status,
          accepted:   res.data?.success === true || res.status === 200,
        };
      });
    }

    // ── Passo 8: Listar membros ────────────────────────────────────────────
    await this.step('list_members', async ({ axios: ax }) => {
      const res = await ax.get(
        `/api/caixinha/membros/${caixinhaId}`,
        { headers: auth1 }
      );
      const membros = res.data?.membros || res.data?.members || res.data || [];
      const hasSecond = secondUser
        ? Array.isArray(membros) && membros.some(m =>
            m.userId === secondUser.uid || m.uid === secondUser.uid
          )
        : null;

      return {
        statusCode:       res.status,
        memberCount:      Array.isArray(membros) ? membros.length : null,
        secondUserJoined: hasSecond,
      };
    });

    // ── Passo 9: Gerar relatório geral ────────────────────────────────────
    await this.step('generate_report', async ({ axios: ax }) => {
      const res = await ax.get(
        `/api/caixinha/${caixinhaId}/relatorio?tipo=geral`,
        { headers: auth1 }
      );
      return {
        statusCode: res.status,
        hasReport:  !!res.data,
      };
    });

    // ── Passo 10: Deletar caixinha (cleanup) ──────────────────────────────
    await this.step('delete_caixinha', async ({ axios: ax }) => {
      const res = await ax.delete(
        `/api/caixinha/${caixinhaId}`,
        { headers: auth1 }
      );
      return {
        statusCode: res.status,
        deleted:    res.data?.success === true || res.status === 200,
      };
    });

    // Cleanup do segundo usuário criado internamente
    if (this._secondUserCreatedInternally && secondUser) {
      await TestUserFactory.cleanup(secondUser).catch(err =>
        logger.warn('CaixinhaFlow: falha no cleanup do segundo usuário', {
          service: 'CaixinhaFlow', error: err.message,
        })
      );
    }

    return this.result();
  }

  /**
   * Troca um custom token Firebase por JWT da aplicação.
   * Reutiliza o mesmo endpoint que o AuthFlow usa.
   */
  async _exchangeToken(customToken) {
    const axios = require('axios');
    try {
      // Custom token → ID token (Firebase REST API) → JWT da aplicação
      const { idToken } = await TestUserFactory.exchangeCustomTokenForIdToken(customToken);

      const res = await axios.post(
        `${this.backendUrl}/api/auth/token`,
        { firebaseToken: idToken },
        {
          headers: {
            'x-correlation-id': `qa_${this.runId}_caixinha_token_exchange`,
            'x-qa-internal':    'true',
          },
          timeout: 15000,
        }
      );
      // Backend retorna { tokens: { accessToken, refreshToken } }
      const tokens = res.data.tokens || res.data;
      return {
        accessToken:  tokens.accessToken  || null,
        refreshToken: tokens.refreshToken || null,
      };
    } catch (err) {
      logger.warn('CaixinhaFlow: falha ao trocar token para segundo usuário', {
        service: 'CaixinhaFlow', error: err.message,
      });
      return { accessToken: null, refreshToken: null };
    }
  }

  /**
   * Adiciona um step de skip para todos os steps restantes quando
   * um step crítico falha (ex: create_caixinha).
   */
  _skipRemaining(reason) {
    this.steps.push({
      name:          'remaining_steps_skipped',
      success:       false,
      duration:      0,
      correlationId: `qa_${this.runId}_caixinha_skip`,
      error:         reason,
      artifacts:     [],
    });
    return this.result();
  }
}

module.exports = CaixinhaFlow;
