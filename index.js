const express = require('express');
const cors = require('cors');
const { admin } = require('./firebaseAdmin');
const swaggerUi = require('swagger-ui-express');
const swaggerDocs = require('./swagger');

// Cria uma instância do aplicativo Express
const app = express();

// Configurações de Middleware
app.use(cors());
app.use(express.json());

// Importação de Rotas
const authRoutes = require('./routes/auth');
const caixinhaRoutes = require('./routes/caixinha');
const emailRoutes = require('./routes/email');
const groupsCaixinhaRoutes = require('./routes/groupsCaixinha');
const inviteRoutes = require('./routes/invite');
const ja3Routes = require('./routes/ja3');
const messageRoutes = require('./routes/messages');
const notificationsRoutes = require('./routes/notifications');
const paymentsRoutes = require('./routes/payments');
const postsRoutes = require('./routes/posts');
const recaptchaRoutes = require('./routes/recaptcha');
const userRoutes = require('./routes/user');
const videoSdkRoutes = require('./routes/videoSdk');
const connectionsRoutes = require('./routes/connections');

// Definição de Rotas
app.use('/api/auth', authRoutes);
app.use('/api/caixinha', caixinhaRoutes);
app.use('/api/email', emailRoutes);
app.use('/api/groups', groupsCaixinhaRoutes);
app.use('/api/invite', inviteRoutes);
app.use('/api/ja3', ja3Routes);
app.use('/api/messages', messageRoutes);
app.use('/api/notifications', notificationsRoutes);
app.use('/api/payments', paymentsRoutes);
app.use('/api/posts', postsRoutes);
app.use('/api/recaptcha', recaptchaRoutes);
app.use('/api/users', userRoutes);
app.use('/api/video-sdk', videoSdkRoutes);
app.use('/api/connections', connectionsRoutes);
app.use('/api-docs', swaggerUi.serve, swaggerUi.setup(swaggerDocs));

// Inicialização do Servidor
const PORT = process.env.PORT || 9000;
app.listen(PORT, () => {
  console.log(`Servidor rodando na porta ${PORT}`);
});
