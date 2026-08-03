module.exports = (req, res, next) => {
    // Transport
    res.setHeader('Strict-Transport-Security', 'max-age=31536000; includeSubDomains; preload');

    // Content type / MIME sniffing
    res.setHeader('X-Content-Type-Options', 'nosniff');

    // Clickjacking — mantido para compatibilidade com browsers antigos
    res.setHeader('X-Frame-Options', 'DENY');

    // XSS filter legado (browsers antigos)
    res.setHeader('X-XSS-Protection', '1; mode=block');

    // CSP — API JSON pura: default-src 'none' bloqueia tudo.
    // Em dev, Swagger UI (/api-docs) precisa carregar scripts/styles/imagens.
    // Em produção, /api-docs está desabilitado (index.js) — CSP restritivo em todas as rotas.
    // [SEC-006]
    if (process.env.NODE_ENV !== 'production' && req.path.startsWith('/api-docs')) {
      res.setHeader(
        'Content-Security-Policy',
        "default-src 'self'; script-src 'self' 'unsafe-inline'; style-src 'self' 'unsafe-inline'; img-src 'self' data:; frame-ancestors 'none'"
      );
    } else {
      res.setHeader(
        'Content-Security-Policy',
        "default-src 'none'; frame-ancestors 'none'"
      );
    }

    // Referrer — não vazar URL da API em requisições cross-origin [SEC-012 parcial]
    res.setHeader('Referrer-Policy', 'no-referrer');

    // Permissions — sem acesso a câmera, microfone, geolocalização [SEC-012 parcial]
    res.setHeader('Permissions-Policy', 'camera=(), microphone=(), geolocation=()');

    next();
  };