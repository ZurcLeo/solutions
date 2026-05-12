const BaseFlow = require('./BaseFlow');

/**
 * Simula o fluxo de convites de plataforma (amigos).
 *
 * Testa o ciclo completo:
 *   generate → view → check (público) → list sent → cancel
 *
 * Detecta automaticamente o BUG-001 (senderName null → 400).
 * Como o TestUserFactory cria usuários com displayName definido,
 * o bug aparece apenas se o `usuario` doc estiver sem `nome`.
 */
class InviteFlow extends BaseFlow {
  constructor(runId, backendUrl) {
    super('invite', 'api', runId, backendUrl);
  }

  async run(testUser) {
    const authHeader    = { Authorization: `Bearer ${testUser.accessToken}` };
    // Email que definitivamente não existe — domínio fictício de testes
    const targetEmail   = `qa_ext_${Date.now()}@external-qa.example.com`;
    const targetName    = 'QA External Friend';
    let   generatedInviteId = null;

    // ── Passo 1: Gerar convite ──────────────────────────────────────────────
    await this.step('generate_invite', async ({ axios: ax }) => {
      const res = await ax.post('/api/invite/generate', {
        email:      targetEmail,
        friendName: targetName,
      }, { headers: authHeader });

      generatedInviteId = res.data?.inviteId || res.data?.id || null;

      return {
        statusCode:          res.status,
        hasInviteId:         !!generatedInviteId,
        inviteId:            generatedInviteId,
        // Se senderName chegou nulo — detecta BUG-001
        senderNamePresent:   !!res.data?.senderName,
      };
    });

    // ── Passo 2: Listar convites enviados ──────────────────────────────────
    await this.step('list_sent_invites', async ({ axios: ax }) => {
      const res = await ax.get(
        `/api/invite/sent/${testUser.uid}`,
        { headers: authHeader }
      );

      const invites = Array.isArray(res.data) ? res.data
        : (res.data?.invites || res.data?.data || []);

      return {
        statusCode:    res.status,
        count:         invites.length,
        // O convite gerado no passo anterior deve aparecer aqui
        hasNewInvite:  generatedInviteId
          ? invites.some(i => i.inviteId === generatedInviteId || i.id === generatedInviteId)
          : null,
      };
    });

    // ── Passo 3: Ver detalhes do convite (autenticado) ────────────────────
    if (generatedInviteId) {
      await this.step('view_invite', async ({ axios: ax }) => {
        const res = await ax.get(
          `/api/invite/view/${generatedInviteId}`,
          { headers: authHeader }
        );
        return {
          statusCode:     res.status,
          hasEmail:       !!(res.data?.email || res.data?.invite?.email),
          statusPending:  (res.data?.status || res.data?.invite?.status) === 'pending',
        };
      });
    }

    // ── Passo 4: Verificar convite (endpoint público, sem auth) ───────────
    if (generatedInviteId) {
      await this.step('check_invite_public', async ({ axios: ax }) => {
        const res = await ax.get(`/api/invite/check/${generatedInviteId}`);
        return {
          statusCode:  res.status,
          // checkInvite sempre retorna 200 (nunca vaza existência)
          isValid:     res.data?.valid !== false,
        };
      });
    }

    // ── Passo 5: Cancelar convite ─────────────────────────────────────────
    if (generatedInviteId) {
      await this.step('cancel_invite', async ({ axios: ax }) => {
        const res = await ax.put(
          `/api/invite/cancel/${generatedInviteId}`,
          {},
          { headers: authHeader }
        );
        return {
          statusCode: res.status,
          cancelled:  res.data?.success === true || res.status === 200,
        };
      });
    }

    return this.result();
  }
}

module.exports = InviteFlow;
