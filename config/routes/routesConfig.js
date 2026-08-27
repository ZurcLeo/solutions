const routeLogger = require('../../middlewares/routeLogger');
const requireModule = require('../../middlewares/requireModule');
const { logger } = require('../../logger');

module.exports = (app) => {
  const routes = [
    { path: '/api/rbac',                 file: '../../routes/rbac' },
    { path: '/api/health',               file: '../../routes/health' },
    { path: '/api/auth',                 file: '../../routes/auth' },
    { path: '/api/admin',                file: '../../routes/admin' },
    { path: '/api/support',              file: '../../routes/support' },
    { path: '/api/interests',            file: '../../routes/interests' },
    { path: '/api/caixinha',             file: '../../routes/caixinha',         moduleId: 'caixinhas' },
    { path: '/api/rifas',                file: '../../routes/rifas',            moduleId: 'jogos' },
    { path: '/api/banking',              file: '../../routes/bankAccount' },
    { path: '/api/email',                file: '../../routes/email' },
    { path: '/api/groups',               file: '../../routes/groupsCaixinha',   moduleId: 'caixinhas' },
    { path: '/api/invite',               file: '../../routes/invite' },
    { path: '/api/ja3',                  file: '../../routes/ja3' },
    { path: '/api/messages',             file: '../../routes/messages' },
    { path: '/api/notifications',        file: '../../routes/notifications' },
    { path: '/api/payments',             file: '../../routes/payments' },
    { path: '/api/posts',                file: '../../routes/posts' },
    { path: '/api/stickers',             file: '../../routes/stickers' },
    { path: '/api/recaptcha',            file: '../../routes/recaptcha' },
    { path: '/api/users',                file: '../../routes/user' },
    { path: '/api/video-sdk',            file: '../../routes/videosdk' },
    { path: '/api/connections',          file: '../../routes/connections' },
    { path: '/api/webhook',              file: '../../routes/webhook' },
    { path: '/api/security',             file: '../../routes/security' },
    // { path: '/api/qa',                   file: '../../routes/qa' }, // DISABLED: QAOrchestratorService hangs on require() — blocks entire server startup
    { path: '/api/sre',                  file: '../../routes/sre' },
    { path: '/api/gamification',         file: '../../routes/gamification' },
    { path: '/api/elcoin',               file: '../../routes/eloCoin' },
    { path: '/api/kyc',                  file: '../../routes/kyc' },
    { path: '/api/contracts',            file: '../../routes/contracts',        moduleId: 'juridico' },
    { path: '/api/marketplace',          file: '../../routes/marketplace' },
    { path: '/api/subscriptions',        file: '../../routes/subscriptions' },
    { path: '/api/kyc-social',           file: '../../routes/kycSocial' },
    { path: '/api/preferences',          file: '../../routes/preferences' },
    { path: '/api/modules',              file: '../../routes/modules' },
    { path: '/api/delivery',             file: '../../routes/delivery' },
    { path: '/api/bookings',             file: '../../routes/bookings' },
    { path: '/api/marketplace/imoveis',  file: '../../routes/propertyStays' },
    { path: '/api/games',               file: '../../routes/games',            moduleId: 'jogos' },
    { path: '/api/payments/pix-direto',  file: '../../routes/pixDireto' },
    { path: '/api/user',                 file: '../../routes/userReadiness' },
    { path: '/api/trust',                file: '../../routes/trustPassport' },
    { path: '/api/agora',                file: '../../routes/agora',            moduleId: 'cidadania' },
    { path: '/api/carona',               file: '../../routes/carona',           moduleId: 'mobilidade_urbana' },
    { path: '/api/fiscal',               file: '../../routes/fiscal',           moduleId: 'juridico' },
    { path: '/api/waitlist',             file: '../../routes/waitlist' },
    { path: '/api/vehicles',            file: '../../routes/vehicles',         moduleId: 'mobilidade_urbana' },
    { path: '/api/governance',          file: '../../routes/governance',       moduleId: 'juridico' },
    { path: '/api/vision',              file: '../../routes/vision' },
    { path: '/api/vault',               file: '../../routes/documentVault' },
    { path: '/api/icon',               file: '../../routes/iconApi' },
    { path: '/api/public/store',       file: '../../routes/publicStore' },
    { path: '/api/public/handle',      file: '../../routes/handleRoutes' },
    { path: '/api/integrations/ml',  file: '../../routes/mlIntegration' },
    { path: '/api/channel-links',    file: '../../routes/channelLinks' },
    { path: '/api/agenda',            file: '../../routes/agenda' },
    { path: '/api/emergency-contacts', file: '../../routes/emergencyContacts' },
    { path: '/api/ledger',            file: '../../routes/ledger' },
    { path: '/api/research',          file: '../../routes/research' },
  ];

  routes.forEach(({ path, file, moduleId }) => {
    const handler = require(file);
    if (moduleId) {
      app.use(path, requireModule(moduleId), routeLogger(handler));
    } else {
      app.use(path, routeLogger(handler));
    }
    logger.info(`[routesConfig] Registered: ${path}${moduleId ? ` (module: ${moduleId})` : ''}`);
  });
};