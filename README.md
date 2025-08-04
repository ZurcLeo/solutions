# Elos Cloud Backend

Backend da aplicação Elos Cloud - uma plataforma social e financeira.

## Visão Geral

Este backend fornece APIs para:
- Autenticação e autorização de usuários
- Sistema de caixinhas colaborativas
- Gestão de pagamentos
- Mensagens e notificações
- Sistema de convites
- Conexões entre usuários

## Tecnologias

- **Node.js** - Runtime JavaScript
- **Express.js** - Framework web
- **Firebase** - Autenticação e banco de dados
- **JWT** - Tokens de autenticação
- **Socket.IO** - Comunicação em tempo real
- **Swagger** - Documentação da API

## Estrutura do Projeto

```
├── controllers/     # Controladores das rotas
├── services/       # Lógica de negócio
├── models/         # Modelos de dados
├── middlewares/    # Middlewares personalizados
├── routes/         # Definição das rotas
├── config/         # Configurações da aplicação
├── schemas/        # Esquemas de validação
└── utils/          # Utilitários
```

## Documentação

- **API Documentation**: Acesse `/api-docs` para ver a documentação Swagger
- **Code Documentation**: Execute `npm run docs:generate` para gerar documentação JSDoc

## Scripts Disponíveis

- `npm start` - Inicia a aplicação
- `npm run dev` - Inicia em modo de desenvolvimento
- `npm test` - Executa os testes
- `npm run docs:generate` - Gera documentação JSDoc
- `npm run docs:build` - Constrói toda a documentação

## Ambiente

Certifique-se de configurar as variáveis de ambiente necessárias:
- `JWT_SECRET`
- `JWT_REFRESH_SECRET`
- `NODE_ENV`
- Credenciais do Firebase