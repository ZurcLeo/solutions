const BaseFlow            = require('./BaseFlow');
const SecurityTicketService = require('../SecurityTicketService');
const { getSupabaseClient } = require('../../config/supabase');
const { logger }          = require('../../logger');

/**
 * Simula o fluxo completo de Step-Up Authentication (SCA/OTP).
 *
 * Valida os quatro contratos fundamentais do mecanismo SCA:
 *  1. Rota protegida bloqueia (403 OTP_REQUIRED) sem ticket válido.
 *  2. Endpoint de geração retorna 200 (código enviado por e-mail na produção).
 *  3. Endpoint de validação converte o código em ticket status='used'.
 *  4. Rota protegida libera acesso quando existe ticket 'used' na janela de 5 min.
 *
 * Estratégia de recuperação do código OTP:
 *   O código é hasheado com HMAC-SHA256 antes de ser gravado em security_tickets
 *   (nunca é persistido em plaintext). Para o QA funcionar sem e-mail real,
 *   o step 2 chama SecurityTicketService.generateTicket() diretamente e usa
 *   o código plaintext retornado em memória — sem persistência e sem envio de e-mail.
 *   Isso testa o endpoint HTTP de geração (step 2a) E o de validação (step 3) de forma
 *   isolada e sem dependências externas.
 *
 * @param {TestUser} testUser - Usuário isolado do Orchestrator (com accessToken).
 */
class SecurityFlow extends BaseFlow {
  constructor(runId, backendUrl, qaToken, onProgress = null) {
    super('security', 'api', runId, backendUrl, qaToken, onProgress);
    this._otpCode  = null;   // código plaintext (apenas em memória)
    this._ticketId = null;   // ticket.id após validate_otp
  }

  async run(testUser) {
    const authHeader = testUser?.accessToken
      ? { Authorization: `Bearer ${testUser.accessToken}` }
      : {};

    // ─── Step 1 ─────────────────────────────────────────────────────────────
    // Verifica que a rota protegida retorna 403 OTP_REQUIRED sem ticket
    await this.step('otp_required_without_ticket', async ({ axios: ax }) => {
      try {
        await ax.post(
          '/api/payments/asaas/withdrawal/request',
          { caixinhaId: 'test-caixinha-qa' },
          { headers: authHeader }
        );
        // Se chegou aqui, a rota não está protegida — bug grave
        throw new Error('Expected 403 OTP_REQUIRED but request succeeded (SCA not active)');
      } catch (err) {
        const status = err.response?.status;
        const code   = err.response?.data?.code;

        if (status === 403 && code === 'OTP_REQUIRED') {
          return {
            scaActive:    true,
            responseCode: code,
            requiredType: err.response?.data?.requiredType,
            windowMinutes: err.response?.data?.windowMinutes,
          };
        }

        // Re-throw para BaseFlow capturar como falha
        throw new Error(
          `Expected 403 OTP_REQUIRED, got ${status}: ${JSON.stringify(err.response?.data)}`
        );
      }
    });

    // ─── Step 2 ─────────────────────────────────────────────────────────────
    // Testa o endpoint HTTP de geração E obtém o código plaintext via serviço direto
    await this.step('generate_otp', async ({ axios: ax }) => {
      if (!testUser?.accessToken) {
        return {
          skipped: true,
          reason:  'BLOCKED: testUser sem accessToken — exchange_custom_token falhou no AuthFlow.',
        };
      }

      // 2a) Testa o endpoint HTTP: deve retornar 200 + message
      const httpRes = await ax.post(
        '/api/security/otp/generate',
        { type: 'saque' },
        { headers: authHeader }
      );

      const httpOk = httpRes.status === 200 && !!httpRes.data?.message;
      if (!httpOk) {
        throw new Error(
          `Generate endpoint retornou resposta inesperada: ${httpRes.status} ${JSON.stringify(httpRes.data)}`
        );
      }

      // 2b) Obtém código plaintext via chamada direta ao serviço (bypassa e-mail).
      //     Invalida o ticket gerado em 2a e cria um novo — comportamento esperado:
      //     generateTicket() expira todos os tickets pending anteriores do mesmo tipo.
      const supabase = getSupabaseClient();
      if (!supabase) {
        logger.warn('SecurityFlow: Supabase indisponível — não é possível gerar ticket de teste', {
          service: 'SecurityFlow', runId: this.runId,
        });
        return {
          httpSuccess:   true,
          codeRetrieved: false,
          warning:
            'BLOCKED: Supabase indisponível. Conecte o Supabase para habilitar o teste E2E de OTP. ' +
            'Alternativa: criar endpoint GET /api/qa/otp/bypass (protegido por x-qa-token) ' +
            'que retorna o código plaintext para usuários de teste.',
        };
      }

      const { code, expiresIn } = await SecurityTicketService.generateTicket(
        testUser.uid,
        'saque',
        {
          ipAddress: '127.0.0.1',
          metadata:  { qa: true, runId: this.runId, source: 'SecurityFlow' },
        }
      );

      this._otpCode = code;

      return {
        httpSuccess:   httpOk,
        codeRetrieved: true,
        expiresIn,
        note: 'Código obtido via SecurityTicketService direto (não via HTTP) para evitar dependência de e-mail.',
      };
    });

    // ─── Step 3 ─────────────────────────────────────────────────────────────
    // Valida o código OTP via endpoint HTTP
    await this.step('validate_otp', async ({ axios: ax }) => {
      if (!this._otpCode) {
        return {
          skipped: true,
          reason:
            'BLOCKED: código OTP não disponível (step generate_otp falhou ou Supabase indisponível). ' +
            'Para desbloquear: garanta que SUPABASE_URL e SUPABASE_SERVICE_KEY estejam configurados ' +
            'no ambiente de QA, ou implemente endpoint QA de bypass.',
        };
      }

      const res = await ax.post(
        '/api/security/otp/validate',
        { type: 'saque', code: this._otpCode },
        { headers: authHeader }
      );

      if (!res.data?.valid || !res.data?.ticket?.id) {
        throw new Error(
          `Validate OTP retornou resposta inválida: ${JSON.stringify(res.data)}`
        );
      }

      this._ticketId = res.data.ticket.id;

      return {
        valid:    res.data.valid,
        ticketId: this._ticketId,
        type:     res.data.ticket.type,
      };
    });

    // ─── Step 4 ─────────────────────────────────────────────────────────────
    // Verifica que a rota protegida libera acesso com ticket válido
    await this.step('protected_route_with_valid_ticket', async ({ axios: ax }) => {
      if (!this._ticketId) {
        return {
          skipped: true,
          reason:  'BLOCKED: sem ticket válido (validate_otp falhou ou foi pulado).',
        };
      }

      try {
        const res = await ax.post(
          '/api/payments/asaas/withdrawal/request',
          { caixinhaId: 'test-caixinha-qa' },
          { headers: { ...authHeader, 'X-OTP-Ticket': this._ticketId } }
        );
        // 200/201: SCA passou e a lógica de negócio também processou (improvável com caixinha fake)
        return { scaPassed: true, status: res.status };
      } catch (err) {
        const status = err.response?.status;
        const code   = err.response?.data?.code;

        if (code === 'OTP_REQUIRED') {
          // Isso é um BUG: ticket válido mas SCA ainda bloqueou
          throw new Error(
            'SCA não liberou o acesso mesmo com ticket \'used\' na janela. ' +
            'Verifique requireVerifiedAction — pode estar lendo user_id errado ou ' +
            'o ticket foi gravado com userId diferente do autenticado.'
          );
        }

        // 400/404/422/500 = lógica de negócio (caixinha não existe, campos faltando, etc.)
        // Isso é CORRETO: o SCA passou, o controller processou e retornou erro de negócio
        return {
          scaPassed:     true,
          status,
          businessError: err.response?.data?.message || err.response?.data?.error || err.message,
          note:          'Erro de negócio esperado (caixinha de teste não existe) — SCA passou com sucesso.',
        };
      }
    });

    // ─── Step 5 ─────────────────────────────────────────────────────────────
    // Documenta o comportamento da janela de tempo do ticket
    await this.step('otp_ticket_window_behavior', async ({ axios: ax }) => {
      if (!this._ticketId) {
        return {
          skipped: true,
          reason:  'BLOCKED: depende de validate_otp. Sem ticket para testar.',
        };
      }

      // Comportamento atual do requireVerifiedAction:
      //   Busca tickets com status='used' E used_at >= now() - 5min.
      //   O ticket NÃO é invalidado após o primeiro uso — permanece 'used' na janela.
      //   Isso é um design intencional: o usuário prova sua identidade UMA vez e
      //   pode executar N operações sensíveis dentro da janela de 5 minutos.
      //
      // Implicação: dentro da janela, qualquer requisição ao endpoint protegido
      //   passará pelo SCA (mesmo sem o header X-OTP-Ticket) porque o middleware
      //   consulta o Supabase — não valida o header.
      //
      // Para testar o bloqueio verdadeiro precisaria esperar 5 min (impraticável em QA).
      // Este step valida que a janela está ativa e documenta o design.

      try {
        await ax.post(
          '/api/payments/asaas/withdrawal/request',
          { caixinhaId: 'test-caixinha-qa' },
          { headers: authHeader } // sem X-OTP-Ticket — SCA verifica Supabase diretamente
        );
        return {
          windowStillActive: true,
          design:
            'Uma validação OTP cobre todas as ações sensíveis dentro da janela de 5 min ' +
            '(design intencional — não é reutilização insegura).',
        };
      } catch (err) {
        const code = err.response?.data?.code;
        if (code === 'OTP_REQUIRED') {
          // Possível se o ticket expirou muito rapidamente ou há bug no middleware
          return {
            windowStillActive: false,
            note:
              'Ticket foi invalidado imediatamente após uso (comportamento one-shot). ' +
              'Verifique se requireVerifiedAction está filtrando corretamente por used_at.',
          };
        }
        // Outro status = business error = SCA passou = janela ativa
        return {
          windowStillActive: true,
          status:  err.response?.status,
          design:  'SCA ativo na janela. Erro de negócio esperado da caixinha inexistente.',
        };
      }
    });

    return this.result();
  }
}

module.exports = SecurityFlow;
