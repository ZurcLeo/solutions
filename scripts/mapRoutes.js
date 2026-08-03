#!/usr/bin/env node
/**
 * mapRoutes.js — Mapeador completo de rotas do backend ElosCloud
 *
 * Lê todos os arquivos de rota registrados em routesConfig.js,
 * extrai método HTTP, path, middlewares, controller, e tenta
 * inferir parâmetros (body/query/params) a partir de Joi schemas
 * e JSDoc @swagger.
 *
 * Uso:
 *   node scripts/mapRoutes.js              # Saída no terminal (tabela)
 *   node scripts/mapRoutes.js --json       # Saída JSON
 *   node scripts/mapRoutes.js --md         # Saída Markdown
 *   node scripts/mapRoutes.js --md > docs/API_ROUTES.md
 */

const fs = require('fs');
const path = require('path');

// ── Configuração ──────────────────────────────────────────────
const ROOT = path.resolve(__dirname, '..');
const ROUTES_DIR = path.join(ROOT, 'routes');
const ROUTES_CONFIG = path.join(ROOT, 'config', 'routes', 'routesConfig.js');

// Middlewares conhecidos e seus significados
const KNOWN_MIDDLEWARES = {
  verifyToken:        { type: 'auth', desc: 'JWT obrigatório' },
  optionalAuth:       { type: 'auth', desc: 'JWT opcional' },
  firstAccess:        { type: 'auth', desc: 'Primeiro acesso' },
  checkRole:          { type: 'rbac', desc: 'Role necessária' },
  checkPermission:    { type: 'rbac', desc: 'Permissão necessária' },
  requireAdmin:       { type: 'rbac', desc: 'Requer admin' },
  requireCaixinhaAdmin: { type: 'rbac', desc: 'Requer admin da caixinha' },
  requireCaixinhaRole: { type: 'rbac', desc: 'Requer role na caixinha' },
  requireKYC:         { type: 'rbac', desc: 'Requer KYC verificado' },
  readLimit:          { type: 'rate', desc: 'Rate limit leitura' },
  writeLimit:         { type: 'rate', desc: 'Rate limit escrita' },
  rateLimiter:        { type: 'rate', desc: 'Rate limiter genérico' },
  authRateLimiter:    { type: 'rate', desc: 'Rate limiter auth (restrito)' },
  validate:           { type: 'validation', desc: 'Validação Joi' },
  deviceCheck:        { type: 'security', desc: 'Análise de device' },
  velocityCheck:      { type: 'security', desc: 'Anti brute-force' },
  transactionAnalysis: { type: 'security', desc: 'Análise de transação' },
  riskScoring:        { type: 'security', desc: 'Score de risco' },
  securityLogging:    { type: 'security', desc: 'Log de segurança' },
  healthCheck:        { type: 'infra', desc: 'Health check da rota' },
};

// ── Funções de parsing ────────────────────────────────────────

/**
 * Extrai os prefixos registrados em routesConfig.js
 * @returns {{ prefix: string, file: string }[]}
 */
function parseRoutesConfig() {
  const src = fs.readFileSync(ROUTES_CONFIG, 'utf-8');
  const entries = [];
  const re = /\{\s*path:\s*['"]([^'"]+)['"]\s*,\s*file:\s*['"]([^'"]+)['"]\s*(?:,\s*moduleId:\s*['"][^'"]*['"]\s*)?\}/g;
  let m;
  while ((m = re.exec(src)) !== null) {
    entries.push({
      prefix: m[1],
      file: path.resolve(path.dirname(ROUTES_CONFIG), m[2]) + '.js',
    });
  }
  return entries;
}

/**
 * Extrai definições de rota de um arquivo Express Router.
 * Suporta:
 *   router.get('/path', mw1, mw2, ctrl.method)
 *   router.route('/path').get(mw1, ctrl.method).post(...)
 */
function parseRouteFile(filePath) {
  if (!fs.existsSync(filePath)) {
    return [{ error: `Arquivo não encontrado: ${filePath}` }];
  }

  const src = fs.readFileSync(filePath, 'utf-8');
  const routes = [];

  // ── Pattern 1: router.METHOD('/path', ...args) ──
  // Matches: router.get('/path', verifyToken, readLimit, ctrl.method)
  const methodRe = /router\.(get|post|put|patch|delete)\(\s*['"]([^'"]*)['"]\s*,([\s\S]*?)\)/g;
  let m;
  while ((m = methodRe.exec(src)) !== null) {
    const method = m[1].toUpperCase();
    const routePath = m[2];
    const argsStr = m[3].trim();
    const { middlewares, controller, joiSchema } = parseArgs(argsStr);

    routes.push({
      method,
      path: routePath,
      middlewares,
      controller,
      joiSchema,
      auth: inferAuth(middlewares),
      swagger: extractSwaggerBlock(src, m.index),
    });
  }

  // ── Pattern 2: router.route('/path').get(...).post(...) ──
  const routeRe = /router\.route\(\s*['"]([^'"]*)['"]\s*\)([\s\S]*?)(?=\n\s*(?:router\.|module\.|\/\/|\/\*|\n\n|$))/g;
  while ((m = routeRe.exec(src)) !== null) {
    const routePath = m[1];
    const chain = m[2];
    const chainMethodRe = /\.(get|post|put|patch|delete)\(([\s\S]*?)\)/g;
    let cm;
    while ((cm = chainMethodRe.exec(chain)) !== null) {
      const method = cm[1].toUpperCase();
      const argsStr = cm[2].trim();
      const { middlewares, controller, joiSchema } = parseArgs(argsStr);
      routes.push({
        method,
        path: routePath,
        middlewares,
        controller,
        joiSchema,
        auth: inferAuth(middlewares),
        swagger: extractSwaggerBlock(src, m.index),
      });
    }
  }

  // ── Pattern 3: router.use(verifyToken) — middleware global no arquivo ──
  const globalMws = [];
  const useRe = /router\.use\(\s*(verifyToken|optionalAuth|readLimit|writeLimit|checkRole\([^)]*\)|checkPermission\([^)]*\))/g;
  while ((m = useRe.exec(src)) !== null) {
    globalMws.push(m[1]);
  }

  // Aplica middlewares globais a todas as rotas
  if (globalMws.length > 0) {
    routes.forEach(r => {
      r.middlewares = [...globalMws, ...r.middlewares];
      r.auth = inferAuth(r.middlewares);
    });
  }

  return routes;
}

/**
 * Faz parse da string de argumentos de uma chamada router.method()
 */
function parseArgs(argsStr) {
  const middlewares = [];
  let controller = '';
  let joiSchema = '';

  // Remove funções inline (req, res, next) => { ... }
  const cleaned = argsStr.replace(/\(req,?\s*res,?\s*(?:next)?\)\s*=>\s*\{[^}]*(?:\{[^}]*\}[^}]*)*\}/g, '__INLINE_MW__');
  // Also handle async (req, res, next) => { ... }
  const cleaned2 = cleaned.replace(/async\s*\(req,?\s*res,?\s*(?:next)?\)\s*=>\s*\{[^}]*(?:\{[^}]*\}[^}]*)*\}/g, '__INLINE_MW__');

  // Split by commas (respecting parentheses)
  const tokens = smartSplit(cleaned2);

  for (const token of tokens) {
    const t = token.trim();
    if (!t || t === '__INLINE_MW__') {
      if (t === '__INLINE_MW__') middlewares.push('(inline middleware)');
      continue;
    }

    // validate(schema) pattern
    const validateMatch = t.match(/validate\(([^)]+)\)/);
    if (validateMatch) {
      middlewares.push('validate');
      joiSchema = validateMatch[1].trim();
      continue;
    }

    // checkRole('admin') pattern
    const roleMatch = t.match(/checkRole\(['"]([^'"]+)['"]\)/);
    if (roleMatch) {
      middlewares.push(`checkRole(${roleMatch[1]})`);
      continue;
    }

    // checkPermission('x:y') pattern
    const permMatch = t.match(/checkPermission\(['"]([^'"]+)['"]/);
    if (permMatch) {
      middlewares.push(`checkPermission(${permMatch[1]})`);
      continue;
    }

    // velocityCheck('action') pattern
    const velMatch = t.match(/velocityCheck\(['"]([^'"]+)['"]\)/);
    if (velMatch) {
      middlewares.push(`velocityCheck(${velMatch[1]})`);
      continue;
    }

    // controller.method or ctrl.method
    if (t.includes('.') && !t.startsWith('(')) {
      controller = t;
      continue;
    }

    // Known middleware name
    if (KNOWN_MIDDLEWARES[t] || /^[a-zA-Z_]+$/.test(t)) {
      middlewares.push(t);
      continue;
    }
  }

  return { middlewares, controller, joiSchema };
}

/**
 * Split por vírgula respeitando parênteses aninhados
 */
function smartSplit(str) {
  const tokens = [];
  let depth = 0;
  let current = '';
  for (const ch of str) {
    if (ch === '(' || ch === '{' || ch === '[') depth++;
    if (ch === ')' || ch === '}' || ch === ']') depth--;
    if (ch === ',' && depth === 0) {
      tokens.push(current);
      current = '';
    } else {
      current += ch;
    }
  }
  if (current.trim()) tokens.push(current);
  return tokens;
}

/**
 * Infere o nível de autenticação baseado nos middlewares
 */
function inferAuth(middlewares) {
  const mwStr = middlewares.join(' ');
  if (mwStr.includes('checkRole') || mwStr.includes('checkPermission') || mwStr.includes('requireAdmin')) {
    return 'RBAC';
  }
  if (mwStr.includes('verifyToken')) return 'JWT';
  if (mwStr.includes('optionalAuth')) return 'Optional';
  return 'Public';
}

/**
 * Tenta extrair o bloco @swagger JSDoc acima de uma rota
 */
function extractSwaggerBlock(src, routeIndex) {
  // Procura para trás a partir do index da rota
  const before = src.substring(Math.max(0, routeIndex - 2000), routeIndex);
  const swaggerRe = /\/\*\*[\s\S]*?@swagger[\s\S]*?\*\//g;
  let lastMatch = null;
  let m;
  while ((m = swaggerRe.exec(before)) !== null) {
    // Só pega se estiver próximo (< 200 chars antes da rota)
    if (before.length - (m.index + m[0].length) < 200) {
      lastMatch = m[0];
    }
  }
  return lastMatch ? true : false;
}

// ── Main ──────────────────────────────────────────────────────

function main() {
  const args = process.argv.slice(2);
  const outputJson = args.includes('--json');
  const outputMd = args.includes('--md');

  const configEntries = parseRoutesConfig();
  const allRoutes = [];
  let totalSwagger = 0;
  let totalRoutes = 0;

  for (const entry of configEntries) {
    const routes = parseRouteFile(entry.file);
    for (const route of routes) {
      if (route.error) {
        allRoutes.push({
          prefix: entry.prefix,
          ...route,
        });
        continue;
      }
      const fullPath = entry.prefix + route.path;
      totalRoutes++;
      if (route.swagger) totalSwagger++;
      allRoutes.push({
        prefix: entry.prefix,
        fullPath,
        method: route.method,
        auth: route.auth,
        middlewares: route.middlewares,
        controller: route.controller,
        joiSchema: route.joiSchema || null,
        hasSwagger: route.swagger,
      });
    }
  }

  // ── Saída ──
  if (outputJson) {
    const result = {
      generatedAt: new Date().toISOString(),
      totalRoutes,
      totalWithSwagger: totalSwagger,
      totalWithoutSwagger: totalRoutes - totalSwagger,
      swaggerCoverage: `${((totalSwagger / totalRoutes) * 100).toFixed(1)}%`,
      routes: allRoutes,
    };
    console.log(JSON.stringify(result, null, 2));
    return;
  }

  if (outputMd) {
    printMarkdown(allRoutes, totalRoutes, totalSwagger, configEntries);
    return;
  }

  // Terminal table output
  printTable(allRoutes, totalRoutes, totalSwagger);
}

function printTable(routes, total, swagger) {
  console.log('\n╔══════════════════════════════════════════════════════════════════════════════════════════════╗');
  console.log('║                         ElosCloud API — Mapa de Rotas                                      ║');
  console.log('╚══════════════════════════════════════════════════════════════════════════════════════════════╝\n');

  // Group by prefix
  const groups = {};
  for (const r of routes) {
    if (!groups[r.prefix]) groups[r.prefix] = [];
    groups[r.prefix].push(r);
  }

  for (const [prefix, groupRoutes] of Object.entries(groups)) {
    console.log(`\n┌─ ${prefix} ${'─'.repeat(Math.max(0, 70 - prefix.length))}┐`);
    for (const r of groupRoutes) {
      if (r.error) {
        console.log(`│  ⚠  ${r.error}`);
        continue;
      }
      const method = r.method.padEnd(7);
      const path = r.fullPath.padEnd(45);
      const auth = r.auth.padEnd(8);
      const sw = r.hasSwagger ? '📄' : '  ';
      console.log(`│ ${method} ${path} ${auth} ${sw} ${r.controller || ''}`);
    }
    console.log(`└${'─'.repeat(80)}┘`);
  }

  console.log(`\n── Resumo ──────────────────────────────────────────`);
  console.log(`   Total de rotas:      ${total}`);
  console.log(`   Com Swagger:         ${swagger} (${((swagger / total) * 100).toFixed(1)}%)`);
  console.log(`   Sem Swagger:         ${total - swagger} (${(((total - swagger) / total) * 100).toFixed(1)}%)`);
  console.log(`   Cobertura Swagger:   ${((swagger / total) * 100).toFixed(1)}%`);
  console.log('');
}

function printMarkdown(routes, total, swagger, configEntries) {
  console.log('# ElosCloud API — Mapa Completo de Rotas\n');
  console.log(`> Gerado em: ${new Date().toISOString()}\n`);
  console.log('## Resumo\n');
  console.log(`| Métrica | Valor |`);
  console.log(`|---------|-------|`);
  console.log(`| Total de rotas | ${total} |`);
  console.log(`| Arquivos de rota | ${configEntries.length} |`);
  console.log(`| Com Swagger | ${swagger} (${((swagger / total) * 100).toFixed(1)}%) |`);
  console.log(`| Sem Swagger | ${total - swagger} (${(((total - swagger) / total) * 100).toFixed(1)}%) |`);
  console.log('');

  // Auth breakdown
  const authCounts = { Public: 0, Optional: 0, JWT: 0, RBAC: 0 };
  routes.forEach(r => { if (r.auth) authCounts[r.auth] = (authCounts[r.auth] || 0) + 1; });
  console.log('### Autenticação\n');
  console.log('| Nível | Qtd |');
  console.log('|-------|-----|');
  for (const [level, count] of Object.entries(authCounts)) {
    console.log(`| ${level} | ${count} |`);
  }
  console.log('');

  // Group by prefix
  const groups = {};
  for (const r of routes) {
    if (!groups[r.prefix]) groups[r.prefix] = [];
    groups[r.prefix].push(r);
  }

  console.log('## Rotas por Módulo\n');

  for (const [prefix, groupRoutes] of Object.entries(groups)) {
    console.log(`### \`${prefix}\`\n`);
    console.log('| Método | Path | Auth | Swagger | Controller | Joi |');
    console.log('|--------|------|------|---------|------------|-----|');
    for (const r of groupRoutes) {
      if (r.error) {
        console.log(`| - | - | - | - | ⚠ ${r.error} | - |`);
        continue;
      }
      const sw = r.hasSwagger ? '✅' : '❌';
      const joi = r.joiSchema || '-';
      console.log(`| \`${r.method}\` | \`${r.fullPath}\` | ${r.auth} | ${sw} | \`${r.controller}\` | ${joi} |`);
    }
    console.log('');
  }

  // Missing swagger list
  const missing = routes.filter(r => !r.hasSwagger && !r.error);
  if (missing.length > 0) {
    console.log('## Rotas sem documentação Swagger\n');
    console.log('| # | Método | Path | Controller |');
    console.log('|---|--------|------|------------|');
    missing.forEach((r, i) => {
      console.log(`| ${i + 1} | \`${r.method}\` | \`${r.fullPath}\` | \`${r.controller}\` |`);
    });
    console.log('');
  }
}

main();
