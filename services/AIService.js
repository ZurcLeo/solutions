// /Users/leocruz/Documents/Projects/eloscloud/backend/eloscloudapp/services/AIService.js
const { logger } = require('../logger');
const anthropicClient = require('../config/anthropic/anthropicClient');
const deepseekClient = require('../config/deepseek/deepseekClient');

const CLAUDE_MODEL = process.env.CLAUDE_SUPPORT_MODEL || 'claude-sonnet-4-6';
const DEEPSEEK_MODEL = process.env.DEEPSEEK_MODEL_NAME || 'deepseek-chat';
const AI_ENABLED = process.env.AI_ENABLED !== 'false';

// Claude primário, DeepSeek fallback
if (AI_ENABLED && anthropicClient) {
  logger.info('Anthropic client used as primary for AIService', { service: 'AIService', model: CLAUDE_MODEL });
} else if (AI_ENABLED && deepseekClient) {
  logger.info('DeepSeek client used as fallback for AIService (Anthropic unavailable)', { service: 'AIService', model: DEEPSEEK_MODEL });
} else if (AI_ENABLED) {
  logger.warn('AI Service running in fallback mode (no AI client available)', { service: 'AIService' });
}

// System prompt base — campos {{}} interpolados em runtime com contexto do usuário
const BASE_SYSTEM_PROMPT = `Você é a Claud, assistente de suporte da ElosCloud — plataforma brasileira
de economia hiperlocal onde vizinhos verificados compram, vendem, entregam,
se hospedam, poupam juntos e têm voz na comunidade.

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
CONTEXTO DO USUÁRIO (use para personalizar — nunca cite esses dados literalmente)
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

Nome: {{firstName}}
Saldo ElosCoins: {{elosCoinsBalance}}
Caixinhas ativas: {{caixinhasCount}} ({{caixinhasNames}})
Empréstimos ativos: {{loansCount}} — valor total: {{loansValue}}
Papéis na plataforma: {{roles}}

Passaporte de Confiança:
- Nível atual: {{trustLevel}} — {{trustLevelName}}
- Verticais ativas: {{activeDomains}}
- Progresso para próximo nível: {{progressPct}}%
- Próximas ações recomendadas: {{nextLevelActions}}
- Validadores conquistados: {{validators}}

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
O QUE A ELOSCLOUD OFERECE (conheça bem para explicar com naturalidade)
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

A ElosCloud tem 8 verticais integradas:

1. CONTA — identidade verificada por CPF, perfil de confiança, acesso por convite
2. SOCIAL — feed de posts do bairro, presentes em ElosCoins, stickers, conexões
3. FINANCEIRO — caixinhas coletivas com votação, empréstimos do grupo, contribuições mensais, saldo custodiado pelo Asaas (IP regulada pelo Banco Central)
4. ESTADIAS — aluguel de imóveis por dia ou semana (estilo Airbnb), calendário de disponibilidade, avaliação bidirecional, pagamento com proteção por escrow
5. ENTREGAS — entregadores autônomos do bairro que definem o próprio preço por km; comprador vê nota, histórico e preço antes de escolher; rastreamento em tempo real
6. MARKETPLACE — produtos, serviços e alimentação de vendedores locais verificados; pague com PIX ou use ElosCoins para desconto
7. MODERAÇÃO — sistema de disputas, Passaporte de Confiança, reputação construída por ações
8. CIDADANIA — Ágora Digital: relatos de infraestrutura para o poder público, enquetes comunitárias, informativos sobre votações no Congresso

MODULOS ATIVAVEIS
A plataforma tem 5 modulos que podem ser ativados ou desativados:
- Caixinhas (financeiro): poupanca coletiva, contribuicoes e emprestimos
- Mobilidade: carona solidaria e gestao de veiculos
- Jogos e Concursos: rifas, bolao, amigo secreto
- Cidadania: Agora Digital com relatos, enquetes e informativos
- Juridico: transparencia fiscal, contratos e governanca

O admin pode habilitar/desabilitar modulos globalmente. O usuario pode ativar ou
desativar modulos para si em Configuracoes > Central de Modulos.
Se um modulo esta desativado, as funcionalidades dele nao aparecem no menu e as
APIs retornam erro. Isso e normal — o usuario pode reativar a qualquer momento.

INTEGRAÇÃO ICONCHAT (pedidos via WhatsApp)
O IconChat é uma integração oficial da ElosCloud que permite que lojistas recebam
pedidos diretamente pelo WhatsApp. Funciona assim:

O que é: O IconChat conecta a loja do marketplace ao WhatsApp do lojista. Clientes
enviam pedidos por WhatsApp e eles aparecem automaticamente no painel de pedidos
da ElosCloud, com pagamento via PIX integrado.

Pré-requisitos para ativar:
1. Ter Passaporte de Confiança nível 2 ou superior
2. Ter um telefone/WhatsApp cadastrado no perfil (em Configurações > Perfil)
3. Ter um plano Brasileirinho T1 ou superior (assinatura ativa)

Como ativar: O lojista acessa Configurações da Loja (engrenagem no painel do
vendedor) e abre a seção "Integração IconChat". Se todos os pré-requisitos
estiverem atendidos, basta clicar em "Conectar IconChat". O sistema gera as
credenciais automaticamente.

Após a ativação, o lojista recebe um HMAC Secret (chave de segurança) que é
exibido UMA ÚNICA VEZ. Ele deve copiar e guardar em local seguro. Também recebe
a URL de callback e o ID do tenant para configurar no lado do IconChat.

Funcionalidades disponíveis após ativação:
- Receber pedidos via WhatsApp que aparecem no painel de pedidos
- Pagamento PIX integrado (cliente recebe QR code pelo WhatsApp)
- Catálogo da loja sincronizado automaticamente
- Pausar/reativar a integração a qualquer momento
- Rotacionar o secret de segurança quando necessário

A integração NÃO substitui o marketplace — funciona como um canal adicional de
vendas. O lojista continua recebendo pedidos normalmente pelo site.

Se o cliente perguntar sobre o IconChat mas não for lojista, explique que é uma
funcionalidade para vendedores e sugira que ele abra sua loja primeiro.

PLANOS E PREÇOS (Sistema Brasileirinho)
A ElosCloud tem 4 planos para lojistas e 2 para entregadores:

Lojistas:
- Modelo Básico: R$ 0/mês, comissão de 5% por venda. Sem selo de pagamento protegido.
- Brasileirinho T1 (Inicial): R$ 39,90/mês (ou R$ 399/ano com ~16% de desconto).
  Zero comissão. 2 membros na equipe. Boost 1.5x. Selo de pagamento protegido.
  Ideal para faturamento até R$ 1.500/mês.
- Brasileirinho T2 (Pro): R$ 69,90/mês (ou R$ 699/ano). Zero comissão.
  3 membros. Boost 2.0x. Subconta financeira e split de pagamento.
  Ideal para faturamento entre R$ 1.500 e R$ 6.000/mês.
- Brasileirinho T3 (Premium): R$ 99,90/mês (ou R$ 999/ano). Zero comissão até
  R$ 10.000/mês, 1,5% sobre o excedente. 5 membros. Boost 2.0x.
  Ideal para faturamento acima de R$ 6.000/mês.

Entregadores:
- Entregador Básico: R$ 0/mês, comissão de 8% por entrega.
- Entregador Ativo: R$ 19,90/mês, zero comissão. Requer 10 entregas como básico.
  Selo "Entregador Verificado".

Todos os planos pagos podem ser adquiridos em Configurações > Plano. Aceitamos
PIX e cartão de crédito. Sem fidelidade — cancele quando quiser.

O breakeven do T1 ocorre com faturamento de ~R$ 800/mês (a partir desse valor,
o plano fixo sai mais barato que a comissão de 5%).

Membros extras na equipe: R$ 9,90/mês (T1/T2) ou R$ 14,90/mês (T3).

VENDAS PARA VISITANTES (Guest Checkout)
Lojistas podem permitir que clientes sem conta no ElosCloud façam pedidos pela
loja pública. O link público da loja é eloscloud.com/s/{handle-da-loja}.
Visitantes podem navegar o catálogo e fazer pedidos com PIX sem precisar criar conta.
Essa funcionalidade pode ser ativada/desativada em Configurações da Loja > Vendas
para Visitantes.

ElosCoins: moeda exclusiva de engajamento e reputação. NÃO se compra com dinheiro
real. Você ganha ao completar tarefas diárias, manter streaks de engajamento,
atingir metas e participar ativamente da comunidade. Use para presenteiar vizinhos,
impulsionar publicações e participar de previsões. Não são dinheiro — são
reputação que gera benefícios reais.

Passaporte de Confiança: reputação unificada que vale em todas as verticais.
5 níveis (Novato → Guardião). Quanto mais verticais você usa, mais rápido sobe.
Cada nível desbloqueia limites maiores de transação, custódia de caixinhas e
capacidade de validar a identidade de outros membros.

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
COMO RESPONDER — REGRAS OBRIGATÓRIAS
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

PERSONALIZAÇÃO OBRIGATÓRIA
Toda resposta deve partir do estado atual do usuário, não de informações genéricas.
- Se o usuário pergunta sobre o Passaporte → diga o nível dele, o progresso, e a
  ação MAIS RÁPIDA que ele pode fazer agora, dado o que já tem ativo.
- Se o usuário pergunta "o que posso fazer" → mencione o que ele ainda NÃO usou
  como oportunidade, não liste tudo como se fosse novidade igual.
- Se o usuário tem caixinhas → reconheça isso ao falar de finanças.
- Se o usuário é seller → adapte a linguagem de quem vende, não de quem compra.

PROFUNDIDADE ADEQUADA
Nunca responda com lista genérica quando você tem o contexto do usuário.
Errado: "Para subir de nível você pode: fazer vendas, participar de caixinhas..."
Certo: "Você está no nível 2 com Social e Conta ativos. Para o nível 3 você
precisa ativar mais uma vertical. A mais rápida para você agora seria o
Marketplace — basta fazer uma compra ou avaliação."

SEMPRE INDIQUE O QUE UMA AÇÃO DESBLOQUEIA
Não diga só O QUE fazer — diga O QUE ACONTECE quando fizer.
Errado: "Participar de caixinhas gera pontos no Passaporte."
Certo: "Participar de uma caixinha ativa a vertical Financeiro — isso te coloca
a um passo do nível 3, que libera transações até R$5.000 e destaque no marketplace."

PRÓXIMO PASSO SEMPRE CONCRETO
Termine respostas sobre ações com uma sugestão específica e acionável.
Não: "Explore as funcionalidades da plataforma."
Sim: "Quer que eu te mostre como criar sua primeira caixinha? Leva 2 minutos."

TOM E FORMATO
- Linguagem natural, brasileira, sem jargão técnico
- Use o primeiro nome do usuário na primeira mensagem, depois economize
- Respostas curtas para perguntas simples, mais detalhadas para perguntas complexas
- Nunca use bullet points com traço (–) — prefira frases corridas ou numeração
- Nunca diga "ativo virtual", "trust level", "vertical", "escrow" — use sempre a
  linguagem do produto: "Passaporte de Confiança", "nível", "área", "proteção do pagamento"
- Emojis com moderação — só quando reforçam o tom, nunca decorativos
- NÃO use markdown: sem asteriscos para negrito, sem hashtags, sem underline
- Use quebras de linha duplas para separar parágrafos
- Escreva como conversa de WhatsApp: natural, parágrafos curtos
- Máximo de 3 a 4 parágrafos por resposta; seja direto

LIMITES
- Não tome ações em nome do usuário (transferências, pagamentos, cancelamentos)
- Para problemas técnicos graves (pagamento preso, conta bloqueada), encaminhe
  para suporte humano com a mensagem: "Esse caso precisa de um atendimento humano.
  Abri um ticket para você — alguém do time vai responder em até 2 horas."
- Não invente funcionalidades que não existem
- Não faça promessas sobre prazos de resolução além dos SLAs definidos

CONTATO DE SUPORTE
- O email oficial de suporte é suporte@eloscloud.com (domínio .com, NÃO .com.br)
- Sempre que precisar indicar um email de contato, use suporte@eloscloud.com
- O site da plataforma é https://eloscloud.com`;

class AIService {
  constructor() {
    // Initialize AI SDK client if needed
    logger.info('AIService initialized', { service: 'AIService' });
  }

  /**
   * Processes a user's message with the AI model.
   * @param {string} userId - The ID of the user sending the message.
   * @param {string} conversationId - The ID of the current conversation.
   * @param {string} messageContent - The content of the user's message.
   * @param {Array<Object>} history - Optional: recent conversation history for context.
   * @param {Object} userContext - Optional: user's data for contextual responses.
   * @returns {Promise<string>} The AI's response text.
   */
  async processMessage(userId, conversationId, messageContent, history = [], userContext = null) {
    const SupportService = require('./SupportService');
    logger.info(`Processing message for AI: convId=${conversationId}, userId=${userId}`, {
      service: 'AIService',
      method: 'processMessage',
      messageContent: messageContent.substring(0, 50) + '...'
    });

    try {
      // Check if message should be escalated to human support
      if (SupportService.shouldEscalateToHuman(messageContent, userContext)) {
        logger.info('Message requires human escalation', {
          service: 'AIService',
          method: 'processMessage',
          conversationId,
          userId
        });
        
        const firstName = userContext?.firstName ? `, ${userContext.firstName}` : '';
        const isCrisis = this._isCrisisMessage(messageContent);

        try {
          await SupportService.requestEscalation(conversationId, userId);
        } catch (escalationError) {
          logger.warn('Failed to create escalation ticket', {
            error: escalationError.message,
            conversationId,
            userId
          });
        }

        if (isCrisis) {
          return `Que situação difícil${firstName} — imagino o quanto isso deve estar te preocupando agora.\n\nVou chamar um atendente humano imediatamente pra estar com você nisso. Nossa equipe tem acesso completo à sua conta e vai conseguir investigar o que aconteceu.\n\nRespira — a gente resolve juntos. Um atendente entra em contato em breve.`;
        }
        return `Faz sentido precisar de uma ajuda mais especializada aqui${firstName}.\n\nVou te conectar com nossa equipe agora — eles têm acesso completo à sua conta e vão conseguir te ajudar melhor do que eu nesse ponto.\n\nUm atendente entra em contato em breve!`;
      }

      // Check if any AI client is available
      if (!anthropicClient && !deepseekClient) {
        logger.info('No AI client available, using fallback response', {
          service: 'AIService',
          method: 'processMessage',
          conversationId
        });
        return this._getFallbackResponse(messageContent, userId, userContext);
      }

      // Enrich user context with live data (wallet, caixinhas, loans, trust passport)
      const richContext = await this._enrichUserContext(userId, userContext);

      // Build interpolated system prompt
      const systemPrompt = this._buildSystemPrompt(richContext);

      const conversationMessages = history.map(msg => ({
        role: msg.sender === userId ? 'user' : 'assistant',
        content: msg.content
      }));
      conversationMessages.push({ role: 'user', content: messageContent });

      // Try Claude (primary), then DeepSeek (fallback)
      let aiResponse = null;

      if (anthropicClient) {
        try {
          aiResponse = await this._callClaude(systemPrompt, conversationMessages);
        } catch (claudeError) {
          logger.warn('Claude primary call failed, trying DeepSeek fallback', {
            service: 'AIService',
            method: 'processMessage',
            conversationId,
            error: claudeError.message
          });
        }
      }

      if (!aiResponse && deepseekClient) {
        try {
          aiResponse = await this._callDeepSeek(systemPrompt, conversationMessages);
        } catch (deepseekError) {
          logger.error('DeepSeek fallback also failed', {
            service: 'AIService',
            method: 'processMessage',
            conversationId,
            error: deepseekError.message
          });
        }
      }

      if (!aiResponse) {
        logger.warn('All AI providers failed, using static fallback', {
          service: 'AIService',
          method: 'processMessage',
          conversationId
        });
        return this._getFallbackResponse(messageContent, userId, userContext);
      }

      logger.info('AI response generated successfully', {
        service: 'AIService',
        method: 'processMessage',
        conversationId
      });
      return aiResponse;

    } catch (error) {
      logger.error('Error in processMessage', {
        service: 'AIService',
        method: 'processMessage',
        conversationId,
        error: error.message,
        stack: error.stack
      });
      return this._getFallbackResponse(messageContent, userId, userContext);
    }
  }

  /**
   * Interpola o system prompt base com dados do contexto enriquecido do usuário.
   */
  _buildSystemPrompt(richContext) {
    if (!richContext) return BASE_SYSTEM_PROMPT;

    const caixinhasCount = richContext.caixinhas?.length || 0;
    const caixinhasNames = richContext.caixinhas
      ?.slice(0, 3).map(c => c.nome || c.name).filter(Boolean).join(', ') || 'nenhuma';
    const walletBalance = richContext.wallet?.saldo || richContext.wallet?.balance || 0;

    const ativos = (richContext.loans || []).filter(l => ['active', 'pending', 'approved'].includes(l.status));
    const loansCount = ativos.length;
    const loansValue = `R$${ativos.reduce((s, l) => s + Number(l.valor_solicitado || l.valor_total || 0), 0).toFixed(2)}`;

    const passport = richContext.trustPassport;

    return BASE_SYSTEM_PROMPT
      .replace('{{firstName}}', richContext.firstName || 'usuário')
      .replace('{{elosCoinsBalance}}', Number(walletBalance).toFixed(2))
      .replace('{{caixinhasCount}}', String(caixinhasCount))
      .replace('{{caixinhasNames}}', caixinhasNames)
      .replace('{{loansCount}}', String(loansCount))
      .replace('{{loansValue}}', loansValue)
      .replace('{{roles}}', (richContext.roles || []).join(', ') || 'membro')
      .replace('{{trustLevel}}', String(passport?.nivel || 1))
      .replace('{{trustLevelName}}', passport?.nome_nivel || 'Novato')
      .replace('{{activeDomains}}', passport?.verticais_ativas?.join(', ') || 'nenhuma ainda')
      .replace('{{progressPct}}', String(passport?.progresso_proximo_nivel || 0))
      .replace('{{nextLevelActions}}', passport?.proximas_acoes?.map(a => a.description || a).join('; ') || 'explore as áreas da plataforma')
      .replace('{{validators}}', passport?.validadores?.join(', ') || 'nenhum ainda');
  }

  /**
   * Chama Claude (Anthropic SDK) como provedor primário.
   */
  async _callClaude(systemPrompt, messages) {
    const response = await anthropicClient.messages.create({
      model: CLAUDE_MODEL,
      max_tokens: 1000,
      system: [
        {
          type: 'text',
          text: systemPrompt,
          cache_control: { type: 'ephemeral' },
        },
      ],
      messages: messages,
      temperature: 0.7,
    });

    logger.info('[AIService] Claude cache metrics', {
      service: 'AIService',
      method: '_callClaude',
      cache_read: response.usage?.cache_read_input_tokens || 0,
      cache_creation: response.usage?.cache_creation_input_tokens || 0,
      input_tokens: response.usage?.input_tokens || 0,
    });

    const text = response.content?.[0]?.text?.trim();
    if (!text) throw new Error('Claude returned empty response');
    return text;
  }

  /**
   * Chama DeepSeek (OpenAI-compatible SDK) como provedor fallback.
   */
  async _callDeepSeek(systemPrompt, messages) {
    const deepseekMessages = [
      { role: 'system', content: systemPrompt },
      ...messages
    ];

    const completion = await deepseekClient.chat.completions.create({
      model: DEEPSEEK_MODEL,
      messages: deepseekMessages,
      max_tokens: 1000,
      temperature: 0.7,
    });

    const text = completion.choices?.[0]?.message?.content?.trim();
    if (!text) throw new Error('DeepSeek returned empty response');
    return text;
  }

  /**
   * Sugere @usernames alternativos quando o desejado está indisponível.
   * @param {string} desiredUsername - O username que o usuário tentou
   * @param {string} emailHint - Email do convidado (inferência de nome)
   * @returns {Promise<string[]>} Array de usernames sugeridos (não verificados contra o banco)
   */
  async suggestUsernames(desiredUsername, emailHint = '') {
    const emailName = emailHint
      ? emailHint.split('@')[0].replace(/[0-9.]/g, '').replace(/_+/g, '_').replace(/^_|_$/g, '').substring(0, 15)
      : '';
    const context = emailName && emailName !== desiredUsername ? `Nome inferido do email: "${emailName}". ` : '';

    const prompt = `${context}O usuário quer o @${desiredUsername} mas está indisponível na plataforma ElosCloud (plataforma financeira social brasileira).

Sugira exatamente 8 @usernames alternativos criativos. Regras obrigatórias:
- APENAS letras minúsculas (a-z) e números (0-9) — zero caracteres especiais, zero underscore
- Entre 3 e 20 caracteres
- Legíveis e memoráveis, não aleatórios
- Variações do nome desejado (prefixo, sufixo numérico, abreviação)
- 1 ou 2 com sufixo temático: elos, br, fc, app (sem separador)
- Sem o símbolo @
- Um por linha, sem numeração, sem explicação

Retorne apenas os 8 usernames, um por linha.`;

    try {
      let raw = '';

      if (anthropicClient) {
        const response = await anthropicClient.messages.create({
          model: CLAUDE_MODEL,
          max_tokens: 120,
          messages: [{ role: 'user', content: prompt }],
          temperature: 0.85,
        });
        logger.info('[AIService] Claude cache metrics (suggestUsernames)', {
          service: 'AIService',
          method: 'suggestUsernames',
          cache_read: response.usage?.cache_read_input_tokens || 0,
          cache_creation: response.usage?.cache_creation_input_tokens || 0,
          input_tokens: response.usage?.input_tokens || 0,
        });
        raw = response.content?.[0]?.text?.trim() || '';
      } else if (deepseekClient) {
        const completion = await deepseekClient.chat.completions.create({
          model: DEEPSEEK_MODEL,
          messages: [{ role: 'user', content: prompt }],
          max_tokens: 120,
          temperature: 0.85,
        });
        raw = completion.choices?.[0]?.message?.content?.trim() || '';
      }
      /** [HANDLE-003] Regex com hifen (AIService usa 3-20 para sugestoes curtas) */
      const USERNAME_REGEX = /^[a-z0-9][a-z0-9-]{1,18}[a-z0-9]$/;
      return raw
        .split('\n')
        .map(line => line.trim().replace(/^@/, '').toLowerCase().replace(/[^a-z0-9-]/g, '').replace(/^-+|-+$/g, '').replace(/-{2,}/g, '-'))
        .filter(u => USERNAME_REGEX.test(u))
        .slice(0, 8);
    } catch (error) {
      logger.warn('Falha ao gerar sugestões de username via IA, usando fallback', {
        service: 'AIService', method: 'suggestUsernames', error: error.message,
      });
      const base = desiredUsername.replace(/[^a-z0-9-]/g, '').replace(/^-+|-+$/g, '').replace(/-{2,}/g, '-').substring(0, 12);
      return [`${base}elos`, `${base}br`, `${base}2026`, `${base}app`]
        .filter(u => /^[a-z0-9][a-z0-9-]{1,18}[a-z0-9]$/.test(u));
    }
  }

  /**
   * Generates a comprehensive fallback response when AI is unavailable
   * @param {string} messageContent - User's message
   * @param {string} userId - User ID
   * @param {Object} userContext - User's data for contextual responses
   * @returns {string} Contextual fallback response
   */
  _getFallbackResponse(messageContent, userId, userContext = null) {
    const lowerContent = messageContent.toLowerCase();
    
    // Context-aware response for balance questions
    if (lowerContent.includes('saldo') && lowerContent.includes('caixinha')) {
      if (userContext && userContext.caixinhas) {
        const totalBalance = userContext.caixinhas.reduce((sum, c) => sum + (c.balance || 0), 0);
        return `Pelo que vejo no seu dashboard, você tem R$ ${totalBalance.toFixed(2)} nas suas caixinhas.\n\nEsse valor representa o **saldo total acumulado** em todas as caixinhas que você participa - é o dinheiro que já está "guardado" no sistema.\n\n**Importante entender:**\n• Não é necessariamente o valor que você vai receber\n• É o total que já foi contribuído por todos os membros\n• Quando for sorteado, você receberá o valor da contemplação daquela caixinha específica\n\nQuer que eu explique melhor como funcionam os sorteios ou tem dúvidas sobre alguma caixinha específica?`;
      }
      return "Sobre o saldo das caixinhas:\n\nO valor que aparece no dashboard representa o **saldo total acumulado** em todas as suas caixinhas - é todo o dinheiro que já foi contribuído pelos membros.\n\n**Não é o valor que você vai receber**, mas sim o total disponível no 'fundo' das caixinhas.\n\nQuando você for contemplado em um sorteio, receberá o valor específico daquela caixinha (número de membros × valor da cota).\n\nPara ver detalhes específicos das suas caixinhas, preciso acessar os dados da sua conta. Posso te conectar com o suporte para uma análise mais detalhada?";
    }
    
    // Greetings with context
    if (lowerContent.includes('oi') || lowerContent.includes('olá') || lowerContent.includes('bom dia') || 
        lowerContent.includes('boa tarde') || lowerContent.includes('boa noite')) {
      let greeting = "Olá! ";
      if (userContext && userContext.firstName) {
        greeting += `${userContext.firstName}! `;
      }
      greeting += "Como posso te ajudar hoje?";
      
      if (userContext && userContext.caixinhas && userContext.caixinhas.length > 0) {
        greeting += `\n\nVejo que você participa de ${userContext.caixinhas.length} caixinha${userContext.caixinhas.length > 1 ? 's' : ''}. Tem alguma dúvida sobre elas?`;
      }
      
      return greeting;
    }

    // How the app works
    if (lowerContent.includes('como funciona') || lowerContent.includes('como usar') || lowerContent.includes('aplicação') || 
        lowerContent.includes('plataforma') || lowerContent.includes('sistema')) {
      return `A ElosCloud é uma plataforma completa de economia colaborativa que oferece:

🏦 **Caixinhas Comunitárias**
• Grupos de economia colaborativa
• Sistema de sorteios mensais
• Gestão transparente de fundos
• Empréstimos entre membros

🛒 **Marketplace Digital**
• Compra e venda de produtos
• Sistema de avaliações
• Integração com pagamentos

💰 **Sistema Financeiro**
• ElosCoins (moeda virtual da plataforma)
• Múltiplas formas de pagamento (PIX, cartão, boleto)
• Trava bancária para segurança (a trava é realizada a partir da validação da chave pix vs conta vinculada, apenas após validação de uma trava bancária uma caixinha passa a estar ativa)

👥 **Rede Social**
• Convites e conexões
• Sistema de mensagens
• Perfis públicos e privados

Você pode navegar pela plataforma através do menu principal. Cada funcionalidade tem suas próprias configurações e opções.

Há alguma área específica que gostaria de explorar primeiro?`;
    }

    // Caixinhas
    if (lowerContent.includes('caixinha')) {
      return `🏦 **Caixinhas da ElosCloud**

As caixinhas são grupos de economia colaborativa onde os participantes:

**Como funciona:**
• Cada membro contribui mensalmente
• Um membro é sorteado para receber o valor total
• O processo continua até todos receberem

**Tipos de participação:**
• **Administrador**: Cria e gerencia a caixinha
• **Moderador**: Ajuda na gestão e pode gerenciar membros
• **Membro**: Participa das contribuições e sorteios

**Recursos disponíveis:**
• Relatórios financeiros detalhados
• Sistema de empréstimos entre membros
• Gestão transparente de fundos
• Notificações automáticas

**Como começar:**
1. Criar uma nova caixinha como administrador
2. Ou ser convidado para uma caixinha existente
3. Definir valor e data de contribuição
4. Aguardar o sorteio mensal

Precisa de ajuda com alguma caixinha específica?`;
    }

    // Payments
    if (lowerContent.includes('pagamento') || lowerContent.includes('pagar') || lowerContent.includes('pix') || 
        lowerContent.includes('cartão') || lowerContent.includes('boleto') || lowerContent.includes('eloscoins')) {
      return `💰 **Sistema de Pagamentos ElosCloud**

**Métodos aceitos:**
• **PIX**: Transferência instantânea
• **Cartão de Crédito/Débito**: Via Stripe/MercadoPago
• **Boleto Bancário**: Compensação em até 3 dias úteis
• **ElosCoins**: Moeda virtual da plataforma

**ElosCoins:**
• Moeda virtual para transações internas
• Ganha ao completar ações na plataforma
• Pode ser usada no marketplace
• Sistema de conversão transparente

**Trava Bancária:**
• Sistema de segurança para todas as transações
• Usuário fornece chave pix e dados da conta bancária
• Validação verifica chave pix, conta bancária e dados do usuário.
• Validação adicional em pagamentos
• Proteção contra fraudes

**Para problemas de pagamento:**
• Verifique os dados bancários
• Confirme se há saldo suficiente
• Aguarde o processamento (pode levar alguns minutos)

Está com alguma dificuldade específica em um pagamento?`;
    }

    // Marketplace — loja bloqueada / desbloquear / status da loja
    if (lowerContent.includes('desbloquear') || lowerContent.includes('bloquear') || lowerContent.includes('bloqueada') ||
        lowerContent.includes('suspensa') || lowerContent.includes('suspender') || lowerContent.includes('pendente') ||
        (lowerContent.includes('loja') && (lowerContent.includes('ativar') || lowerContent.includes('ativa') || lowerContent.includes('status')))) {
      return `Entendi! Para te ajudar melhor, preciso saber qual o status que aparece na sua loja (pendente, suspensa ou rejeitada).\n\nSe estiver pendente: sua loja está aguardando aprovação da equipe ElosCloud. Não é necessária nenhuma ação da sua parte — assim que for analisada você recebe uma notificação.\n\nSe estiver suspensa ou rejeitada: é necessário entrar em contato com o suporte para que a equipe verifique o motivo e possa reativar.\n\nQuer que eu abra um ticket de suporte para você agora?`;
    }

    // Marketplace — geral
    if (lowerContent.includes('marketplace') || lowerContent.includes('produto') || lowerContent.includes('vender') ||
        lowerContent.includes('comprar') || lowerContent.includes('loja')) {
      return `O Mercado Local da ElosCloud é onde você pode comprar e vender produtos dentro da plataforma.\n\nPara vender, você precisa criar um perfil de vendedor. Após o cadastro, sua loja fica com status "pendente" até ser aprovada pela nossa equipe. A ativação é manual e geralmente leva até 2 dias úteis.\n\nStatus possíveis da loja:\n- Pendente: aguardando aprovação\n- Ativa: loja funcionando normalmente\n- Suspensa: temporariamente bloqueada\n- Rejeitada: cadastro não aprovado (entre em contato com o suporte)\n\nTem alguma dúvida específica sobre o seu cadastro de vendedor?`;
    }

    // Profile and settings
    if (lowerContent.includes('perfil') || lowerContent.includes('conta') || lowerContent.includes('configurar') || 
        lowerContent.includes('configuração') || lowerContent.includes('dados')) {
      return `👤 **Perfil e Configurações**

**Configurações do Perfil:**
• Nome e foto de perfil
• Descrição pessoal
• Interesses
• Configurações de privacidade

**Tipos de Perfil:**
• **Público**: Visível para todos os usuários
• **Privado**: Apenas conexões podem ver

**Conexões e Rede:**
• Sistema de convites por código único
• Amigos autorizados
• Árvore genealógica de convites

**Configurações de Notificação:**
• Mensagens não lidas
• Atualizações de caixinhas
• Notificações de marketplace

**Segurança:**
• Validação JA3 para segurança
• Controle de acesso por roles
• Histórico de atividades

**Para editar seu perfil:**
1. Acesse "Configurações" no menu
2. Edite as informações desejadas
3. Salve as alterações

Precisa alterar alguma configuração específica?`;
    }

    // Technical issues
    if (lowerContent.includes('problema') || lowerContent.includes('erro') || lowerContent.includes('bug') ||
        lowerContent.includes('não funciona') || lowerContent.includes('não consegue') || lowerContent.includes('lento')) {
      return `🔧 **Problemas Técnicos Comuns**

**Problemas de Login:**
• Verifique sua conexão com a internet
• Limpe cache do navegador/app
• Confirme se está usando o e-mail correto

**Problemas de Pagamento:**
• Verifique dados bancários
• Confirme saldo disponível
• Aguarde processamento (pode levar alguns minutos)

**Problemas com Caixinhas:**
• Confirme se tem permissões adequadas
• Verifique se está na role correta
• Aguarde sincronização dos dados

**Problemas de Performance:**
• Verifique sua conexão
• Feche outras abas/aplicativos
• Tente atualizar a página

**Se o problema persistir:**
Nossa equipe técnica pode investigar questões específicas que requerem acesso aos logs do sistema.

Digite 'falar com suporte' para conectar-se com nossa equipe especializada que pode acessar dados técnicos detalhados e resolver problemas complexos.

Qual tipo de problema você está enfrentando?`;
    }

    // Support request
    if (lowerContent.includes('suporte') || lowerContent.includes('atendente') || lowerContent.includes('humano') ||
        lowerContent.includes('falar com') || lowerContent.includes('ajuda especializada')) {
      return `👥 **Conectando com Suporte Humano**

Vou transferir você para nossa equipe de suporte especializada. Eles têm acesso a:

• Dados detalhados da sua conta
• Logs do sistema em tempo real
• Ferramentas administrativas
• Histórico completo de transações

**Nossa equipe pode ajudar com:**
• Problemas técnicos complexos
• Questões financeiras específicas
• Configurações avançadas de caixinhas
• Disputas no marketplace
• Questões de segurança

Por favor, aguarde um momento enquanto transfiro sua conversa...`;
    }

    // Help/menu
    if (lowerContent.includes('ajuda') || lowerContent.includes('help') || lowerContent.includes('menu') || 
        lowerContent.includes('opções') || lowerContent.includes('comandos')) {
      return `📋 **Central de Ajuda ElosCloud**

**Principais tópicos:**
• Digite "caixinhas" - Para aprender sobre economia colaborativa
• Digite "marketplace" - Para comprar/vender produtos
• Digite "pagamentos" - Para questões financeiras
• Digite "perfil" - Para configurações de conta
• Digite "como funciona" - Para visão geral da plataforma

**Ações rápidas:**
• "falar com suporte" - Conecta com atendimento humano
• "meus dados" - Informações sobre sua conta
• "problemas" - Soluções para questões técnicas

**Recursos da plataforma:**
🏦 Caixinhas comunitárias
🛒 Marketplace digital
💰 Sistema ElosCoins
👥 Rede social integrada
🔒 Sistema de segurança avançado

O que você gostaria de explorar?`;
    }

    // Default response for complex questions
    return `💬 **Assistente ElosCloud**

Percebi que sua pergunta é bem específica e merece uma resposta detalhada.

**Posso ajudar imediatamente com:**
• Explicações sobre como a plataforma funciona
• Orientações sobre caixinhas e marketplace
• Informações sobre pagamentos e ElosCoins
• Configurações básicas de perfil

**Para questões específicas e personalizadas:**
Nossa equipe de suporte tem acesso a informações detalhadas da sua conta e pode fornecer ajuda personalizada.

Digite 'falar com suporte' para ser conectado a um especialista que pode acessar seus dados e histórico para dar uma resposta mais precisa.

Ou me diga sobre qual área da plataforma você tem dúvidas: caixinhas, marketplace, pagamentos ou perfil?`;
  }
  /**
   * Detecta mensagens de crise financeira (dinheiro sumindo, conta invadida, etc.)
   * para acionar resposta de acolhimento antes de escalar.
   */
  _isCrisisMessage(content) {
    const crisisKeywords = [
      'dinheiro sumiu', 'dinheiro sumindo', 'dinheiro desapareceu',
      'roubaram', 'fui roubado', 'me roubaram',
      'conta hackeada', 'hackearam', 'invadiram minha conta', 'acesso indevido',
      'não reconheço', 'transação estranha', 'cobrado indevidamente', 'cobrança indevida',
      'perdi tudo', 'cadê meu dinheiro', 'onde está meu dinheiro',
      'saldo negativo', 'dinheiro foi embora',
    ];
    const lower = content.toLowerCase();
    return crisisKeywords.some(kw => lower.includes(kw));
  }

  /**
   * Enriquece o contexto do usuário com dados em tempo real (wallet, caixinhas, empréstimos).
   * Se o contexto já vier rico, retorna sem nova consulta ao banco.
   */
  async _enrichUserContext(userId, existingContext) {
    if (existingContext && existingContext.wallet && existingContext.loans && existingContext.trustPassport) {
      return existingContext; // já rico
    }
    try {
      const SupportContextBuilder = require('./SupportContextBuilder');
      const [wallet, caixinhas, loans, trustPassport] = await Promise.all([
        SupportContextBuilder.getWalletInfo(userId),
        SupportContextBuilder.getUserCaixinhas(userId),
        SupportContextBuilder.getUserLoans(userId),
        SupportContextBuilder.getTrustPassport(userId),
      ]);
      return { ...(existingContext || {}), wallet, caixinhas: caixinhas || [], loans: loans || [], trustPassport };
    } catch (err) {
      logger.warn('AIService: falha ao enriquecer contexto do usuário', { userId, error: err.message });
      return existingContext || {};
    }
  }
}

module.exports = new AIService();
