const swaggerJsDoc = require('swagger-jsdoc');
const swaggerUi = require('swagger-ui-express');

const swaggerOptions = {
  swaggerDefinition: {
    openapi: '3.0.0',
    info: {
      title: 'API Elos Cloud',
      version: '1.0.0',
      description: 'Documentação da API - Elos Cloud',
      contact: {
        name: 'Leonardo Cruz',
        email: 'leonardo@eloscloud.com.br',
      },
      servers: [
        {
          url: 'http://localhost:9000',
        },
      ],
    },
    components: {
      securitySchemes: {
        bearerAuth: {
          type: 'http',
          scheme: 'bearer',
          bearerFormat: 'JWT',
        },
      },
      schemas: {
        Caixinha: {
          type: 'object',
          properties: {
            id: {
              type: 'string',
              description: 'ID da caixinha',
            },
            name: {
              type: 'string',
              description: 'Nome da caixinha',
            },
          },
        },
        EmailInvite: {
          type: 'object',
          properties: {
            to: {
              type: 'string',
              description: 'Email do destinatário',
            },
            subject: {
              type: 'string',
              description: 'Assunto do email',
            },
            message: {
              type: 'string',
              description: 'Mensagem do email',
            },
          },
        },
        GroupCaixinha: {
          type: 'object',
          properties: {
            id: {
              type: 'string',
              description: 'ID do grupo de caixinhas',
            },
            name: {
              type: 'string',
              description: 'Nome do grupo de caixinhas',
            },
          },
        },
        InviteGenerate: {
          type: 'object',
          properties: {
            email: {
              type: 'string',
              description: 'Email para o qual o convite será gerado',
              example: 'user@example.com',
            },
          },
        },
        InviteValidate: {
          type: 'object',
          properties: {
            inviteToken: {
              type: 'string',
              description: 'Token do convite a ser validado',
              example: 'some_invite_token',
            },
          },
        },
        InviteInvalidate: {
          type: 'object',
          properties: {
            inviteToken: {
              type: 'string',
              description: 'Token do convite a ser invalidado',
              example: 'some_invite_token',
            },
          },
        },
        JA3Calculate: {
          type: 'object',
          properties: {
            data: {
              type: 'string',
              description: 'Dados para calcular o hash JA3',
              example: 'example data',
            },
          },
        },
        JA3Hash: {
          type: 'object',
          properties: {
            hash: {
              type: 'string',
              description: 'Hash JA3 calculado',
              example: 'calculated_ja3_hash',
            },
          },
        },
        Message: {
          type: 'object',
          properties: {
            id: {
              type: 'string',
              description: 'ID da mensagem',
            },
            userId: {
              type: 'string',
              description: 'ID do usuário que enviou a mensagem',
            },
            content: {
              type: 'string',
              description: 'Conteúdo da mensagem',
            },
            createdAt: {
              type: 'string',
              format: 'date-time',
              description: 'Data e hora de criação da mensagem',
            },
            updatedAt: {
              type: 'string',
              format: 'date-time',
              description: 'Data e hora da última atualização da mensagem',
            },
          },
        },
        Notification: {
          type: 'object',
          properties: {
            id: {
              type: 'string',
              description: 'ID da notificação',
            },
            userId: {
              type: 'string',
              description: 'ID do usuário que recebeu a notificação',
            },
            message: {
              type: 'string',
              description: 'Mensagem da notificação',
            },
            read: {
              type: 'boolean',
              description: 'Status de leitura da notificação',
            },
            createdAt: {
              type: 'string',
              format: 'date-time',
              description: 'Data e hora de criação da notificação',
            },
          },
        },
        Purchase: {
          type: 'object',
          properties: {
            id: {
              type: 'string',
              description: 'ID da compra',
            },
            userId: {
              type: 'string',
              description: 'ID do usuário que fez a compra',
            },
            amount: {
              type: 'number',
              description: 'Quantidade da compra',
            },
            createdAt: {
              type: 'string',
              format: 'date-time',
              description: 'Data e hora da compra',
            },
          },
        },
        PaymentIntentRequest: {
          type: 'object',
          properties: {
            quantidade: {
              type: 'number',
              description: 'Quantidade do pagamento',
            },
            valor: {
              type: 'number',
              description: 'Valor do pagamento',
            },
            userId: {
              type: 'string',
              description: 'ID do usuário',
            },
            description: {
              type: 'string',
              description: 'Descrição do pagamento',
            },
            recaptchaToken: {
              type: 'string',
              description: 'Token do reCAPTCHA',
            },
          },
        },
        PaymentIntentResponse: {
          type: 'object',
          properties: {
            id: {
              type: 'string',
              description: 'ID da intenção de pagamento',
            },
            client_secret: {
              type: 'string',
              description: 'Segredo do cliente para a intenção de pagamento',
            },
          },
        },
        SessionStatus: {
          type: 'object',
          properties: {
            status: {
              type: 'string',
              description: 'Status da sessão de pagamento',
            },
            customer_email: {
              type: 'string',
              description: 'Email do cliente',
            },
          },
        },
        Post: {
          type: 'object',
          properties: {
            id: {
              type: 'string',
              description: 'ID da postagem',
            },
            userId: {
              type: 'string',
              description: 'ID do usuário que criou a postagem',
            },
            content: {
              type: 'string',
              description: 'Conteúdo da postagem',
            },
            createdAt: {
              type: 'string',
              format: 'date-time',
              description: 'Data e hora de criação da postagem',
            },
            updatedAt: {
              type: 'string',
              format: 'date-time',
              description: 'Data e hora da última atualização da postagem',
            },
          },
        },
        Contribuicao: {
          type: 'object',
          properties: {
            id: {
              type: 'string',
              description: 'ID da contribuição',
            },
            caixinhaId: {
              type: 'string',
              description: 'ID da caixinha associada',
            },
            userId: {
              type: 'string',
              description: 'ID do usuário que fez a contribuição',
            },
            valor: {
              type: 'number',
              description: 'Valor da contribuição',
            },
            data: {
              type: 'string',
              format: 'date-time',
              description: 'Data da contribuição',
            },
          },
        },
        ConfiguracoesCaixinha: {
          type: 'object',
          properties: {
            id: {
              type: 'string',
              description: 'ID das configurações da caixinha',
            },
            caixinhaId: {
              type: 'string',
              description: 'ID da caixinha associada',
            },
            nome: {
              type: 'string',
              description: 'Nome da caixinha',
            },
            descricao: {
              type: 'string',
              description: 'Descrição da caixinha',
            },
            contribuicaoMensal: {
              type: 'number',
              description: 'Valor da contribuição mensal',
            },
            dataCriacao: {
              type: 'string',
              format: 'date-time',
              description: 'Data de criação da caixinha',
            },
          },
        },
        RecaptchaVerify: {
          type: 'object',
          properties: {
            token: {
              type: 'string',
              description: 'Token reCAPTCHA a ser verificado',
              example: 'token_do_recaptcha',
            },
          },
        },
        RecaptchaResponse: {
          type: 'object',
          properties: {
            success: {
              type: 'boolean',
              description: 'Indica se a verificação foi bem-sucedida',
            },
            score: {
              type: 'number',
              description: 'Pontuação do reCAPTCHA',
            },
            action: {
              type: 'string',
              description: 'Ação do reCAPTCHA',
            },
          },
        },
        User: {
          type: 'object',
          properties: {
            id: {
              type: 'string',
              description: 'ID do usuário',
            },
            name: {
              type: 'string',
              description: 'Nome do usuário',
            },
            email: {
              type: 'string',
              description: 'Email do usuário',
            },
            password: {
              type: 'string',
              description: 'Senha do usuário',
            },
            createdAt: {
              type: 'string',
              format: 'date-time',
              description: 'Data e hora de criação do usuário',
            },
            updatedAt: {
              type: 'string',
              format: 'date-time',
              description: 'Data e hora da última atualização do usuário',
            },
          },
        },
        TokenResponse: {
          type: 'object',
          properties: {
            token: {
              type: 'string',
              description: 'Token de autenticação',
            },
          },
        },
        SessionResponse: {
          type: 'object',
          properties: {
            sessionId: {
              type: 'string',
              description: 'ID da sessão de vídeo',
            },
            status: {
              type: 'string',
              description: 'Status da sessão de vídeo',
            },
            createdAt: {
              type: 'string',
              format: 'date-time',
              description: 'Data e hora de criação da sessão',
            },
          },
        },
        MeetingResponse: {
          type: 'object',
          properties: {
            meetingId: {
              type: 'string',
              description: 'ID da reunião',
            },
            status: {
              type: 'string',
              description: 'Status da reunião',
            },
            createdAt: {
              type: 'string',
              format: 'date-time',
              description: 'Data e hora de criação da reunião',
            },
          },
        },
        ValidateMeetingResponse: {
          type: 'object',
          properties: {
            isValid: {
              type: 'boolean',
              description: 'Indica se a reunião é válida',
            },
            meetingId: {
              type: 'string',
              description: 'ID da reunião',
            },
            status: {
              type: 'string',
              description: 'Status da reunião',
            },
          },
        },
      },
    },
  },
  apis: ['./routes/*.js'],
};

const swaggerDocs = swaggerJsDoc(swaggerOptions);

module.exports = swaggerDocs;