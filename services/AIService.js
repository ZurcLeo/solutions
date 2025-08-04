// /Users/leocruz/Documents/Projects/eloscloud/backend/eloscloudapp/services/AIService.js
const { logger } = require('../logger');
const SupportService = require('./SupportService');

const AI_MODEL_NAME = process.env.AI_MODEL_NAME || 'gpt-3.5-turbo';
const AI_ENABLED = process.env.AI_ENABLED !== 'false'; // Default to true unless explicitly disabled

let openai = null;

// Initialize OpenAI only if enabled and API key is available
if (AI_ENABLED && process.env.OPENAI_API_KEY) {
  try {
    const OpenAI = require('openai');
    openai = new OpenAI({ 
      apiKey: process.env.OPENAI_API_KEY,
      timeout: 30000
    });
    logger.info('OpenAI client initialized successfully', { service: 'AIService' });
  } catch (error) {
    logger.error('Failed to initialize OpenAI client', { 
      service: 'AIService', 
      error: error.message 
    });
  }
} else {
  logger.warn('AI Service running in fallback mode', { 
    service: 'AIService',
    reason: AI_ENABLED ? 'Missing OPENAI_API_KEY' : 'AI_ENABLED=false'
  });
}

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
        
        try {
          await SupportService.requestEscalation(conversationId, userId);
          return "Entendo que você precisa de uma ajuda mais específica. Acabei de transferir sua conversa para nossa equipe de suporte especializada.\\n\\nUm de nossos atendentes entrará em contato em breve para resolver sua questão com acesso completo aos dados da sua conta.\\n\\nEnquanto isso, se tiver outras dúvidas, estou aqui para ajudar!";
        } catch (escalationError) {
          logger.warn('Failed to create escalation ticket', {
            error: escalationError.message,
            conversationId,
            userId
          });
          return "Vou transferir você para nossa equipe de suporte especializada que pode acessar dados específicos da sua conta e resolver questões complexas.\\n\\nPor favor, aguarde que em breve um atendente entrará em contato.";
        }
      }

      // Check if OpenAI is available
      if (!openai) {
        logger.info('OpenAI not available, using fallback response', {
          service: 'AIService',
          method: 'processMessage',
          conversationId
        });
        return this._getFallbackResponse(messageContent, userId, userContext);
      }

      const messages = history.map(msg => ({
        role: msg.sender === userId ? 'user' : 'assistant',
        content: msg.content
      }));
      
      let systemContent = `Você é o assistente virtual da ElosCloud, uma plataforma de economia colaborativa e marketplace digital no Brasil.

Diretrizes de personalidade:
- Seja natural, amigável e conversacional (evite parecer robotizado)
- Use linguagem brasileira informal mas respeitosa
- Responda de forma direta e personalizada
- Demonstre compreensão do contexto específico do usuário
- Seja empático e prestativo

Sobre respostas:
- Responda perguntas específicas com informações detalhadas e úteis
- Use dados do usuário quando disponíveis para personalizar respostas
- Explique conceitos de forma clara e prática
- Ofereça próximos passos ou ações quando relevante

Escalonamento para suporte humano:
- Sugira apenas quando realmente necessário (problemas técnicos complexos, questões financeiras específicas, disputas)
- Evite escalonar para perguntas que você consegue responder adequadamente
- Sempre explique por que está sugerindo o escalonamento

Tópicos que você domina:
- Funcionamento das caixinhas (economia colaborativa)
- Sistema de pagamentos e ElosCoins
- Marketplace e vendas
- Configurações de perfil
- Explicações sobre saldos e valores`;

      // Add user context to system prompt if available
      if (userContext) {
        systemContent += `\n\nContexto do usuário:`;
        if (userContext.firstName) {
          systemContent += `\n- Nome: ${userContext.firstName}`;
        }
        if (userContext.caixinhas && userContext.caixinhas.length > 0) {
          systemContent += `\n- Participa de ${userContext.caixinhas.length} caixinha(s)`;
          const totalBalance = userContext.caixinhas.reduce((sum, c) => sum + (c.balance || 0), 0);
          systemContent += `\n- Saldo total em caixinhas: R$ ${totalBalance.toFixed(2)}`;
        }
        if (userContext.roles && userContext.roles.length > 0) {
          systemContent += `\n- Roles: ${userContext.roles.join(', ')}`;
        }
      }

      const systemPrompt = {
        role: 'system',
        content: systemContent
      };

      messages.unshift(systemPrompt);
      messages.push({ role: 'user', content: messageContent });

      const completion = await openai.chat.completions.create({
        model: AI_MODEL_NAME,
        messages: messages,
        max_tokens: 500,
        temperature: 0.7,
      });
      
      const aiResponse = completion.choices[0]?.message?.content?.trim();

      if (!aiResponse) {
        logger.warn('AI returned an empty response', {
          service: 'AIService',
          method: 'processMessage',
          conversationId
        });
        return "Desculpe, não consegui processar sua mensagem no momento.";
      }

      logger.info('AI response generated successfully', {
        service: 'AIService',
        method: 'processMessage',
        conversationId
      });
      return aiResponse;

    } catch (error) {
      logger.error('Error interacting with AI model', {
        service: 'AIService',
        method: 'processMessage',
        conversationId,
        error: error.message,
        errorCode: error.code,
        errorType: error.type,
        stack: error.stack
      });

      // Handle specific OpenAI errors
      if (error.message && error.message.includes('429')) {
        logger.warn('OpenAI quota exceeded, using fallback response', {
          service: 'AIService',
          method: 'processMessage',
          conversationId
        });
        return this._getFallbackResponse(messageContent, userId, userContext);
      }

      if (error.message && error.message.includes('401')) {
        logger.error('OpenAI authentication failed', {
          service: 'AIService',
          method: 'processMessage',
          conversationId
        });
        return "Estou com dificuldades técnicas no momento. Nossa equipe de suporte pode ajudá-lo melhor. Digite 'falar com suporte' para ser conectado a um atendente humano.";
      }

      // Generic fallback
      return this._getFallbackResponse(messageContent, userId, userContext);
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
• Trava bancária para segurança

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
• Sistema de segurança para grandes transações
• Validação adicional em pagamentos
• Proteção contra fraudes

**Para problemas de pagamento:**
• Verifique os dados bancários
• Confirme se há saldo suficiente
• Aguarde o processamento (pode levar alguns minutos)

Está com alguma dificuldade específica em um pagamento?`;
    }

    // Marketplace
    if (lowerContent.includes('marketplace') || lowerContent.includes('produto') || lowerContent.includes('vender') || 
        lowerContent.includes('comprar') || lowerContent.includes('loja')) {
      return `🛒 **Marketplace ElosCloud**

**Para Compradores:**
• Navegue pelos produtos disponíveis
• Filtre por categoria e preço
• Veja avaliações de outros usuários
• Finalize compras com ElosCoins ou outros métodos

**Para Vendedores:**
• Role de "Seller" necessária
• Cadastre produtos com fotos e descrições
• Gerencie estoque e pedidos
• Receba pagamentos através da plataforma

**Sistema de Avaliações:**
• Avalie produtos após a compra
• Vendedores também podem ser avaliados
• Sistema de reputação transparente

**Gestão de Pedidos:**
• Acompanhe status dos pedidos
• Comunicação direta com vendedores
• Sistema de disputas em caso de problemas

**Como começar a vender:**
1. Solicite a role de "Seller"
2. Configure seu perfil de vendedor
3. Cadastre seus primeiros produtos
4. Gerencie pedidos pelo painel

Você quer comprar ou vender produtos?`;
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
}

module.exports = new AIService();