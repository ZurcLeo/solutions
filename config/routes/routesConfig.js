const routeLogger = require('../../middlewares/routeLogger');

module.exports = (app) => {
  const routes = [
    { path: '/api/health', handler: require('../../routes/health') },
    { path: '/api/auth', handler: require('../../routes/auth') },
    { path: '/api/interests', handler: require('../../routes/interests') },
    { path: '/api/caixinha', handler: require('../../routes/caixinha') },
    { path: '/api/email', handler: require('../../routes/email') },
    { path: '/api/groups', handler: require('../../routes/groupsCaixinha') },
    { path: '/api/invite', handler: require('../../routes/invite') },
    { path: '/api/ja3', handler: require('../../routes/ja3') },
    { path: '/api/messages', handler: require('../../routes/messages') },
    { path: '/api/notifications', handler: require('../../routes/notifications') },
    { path: '/api/payments', handler: require('../../routes/payments') },
    { path: '/api/posts', handler: require('../../routes/posts') },
    { path: '/api/recaptcha', handler: require('../../routes/recaptcha') },
    { path: '/api/users', handler: require('../../routes/user') },
    { path: '/api/video-sdk', handler: require('../../routes/videosdk') },
    { path: '/api/connections', handler: require('../../routes/connections') }
    // Adicione todas as outras rotas aqui
  ];

  routes.forEach(({ path, handler }) => {
    app.use(path, routeLogger(handler));
  });
};