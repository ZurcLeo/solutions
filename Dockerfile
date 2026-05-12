# =============================================================================
# ESTÁGIO 1: Builder
# Instala dependências e compila binários nativos (sharp, grpc)
# =============================================================================
FROM node:20-alpine AS builder

# Dependências de build para sharp e módulos com binários nativos
RUN apk add --no-cache python3 make g++ libc6-compat

WORKDIR /app

# Copia manifests primeiro para cache de camada
COPY package*.json ./

# npm install: tolerante a lockfile desatualizado em ambiente de build limpo
RUN npm install --no-audit --prefer-offline

# Garante que o sharp está compilado para a arquitetura alvo (Alpine/musl)
RUN npm install --os=linux --libc=musl --cpu=x64 sharp

# Copia o restante do código (. dockerignore exclui o que não deve entrar)
COPY . .


# =============================================================================
# ESTÁGIO 2: Runner
# Imagem final enxuta sem ferramentas de build
# =============================================================================
FROM node:20-alpine AS runner

# Necessário para o sharp rodar em Alpine
RUN apk add --no-cache libc6-compat

WORKDIR /app

ENV NODE_ENV=production

# Copia tudo do builder — o .dockerignore já garantiu que o builder
# contém apenas o código necessário, sem certs, logs ou dados de usuário
COPY --from=builder /app ./

EXPOSE 8080

# node diretamente: SIGTERM chega ao processo Node, não ao npm
CMD ["node", "index.js"]
