const express = require('express');
const bodyParser = require('body-parser');
const cors = require('cors');
const morgan = require('morgan');
const { admin } = require('./firebaseAdmin'); // Importando o firebaseAdmin.js
require('dotenv').config();

const paymentsRoutes = require('./routes/payments');
const authRoutes = require('./routes/auth');
const recaptchaRoutes = require('./routes/recaptcha');
const emailRoutes = require('./routes/email');
const userRoutes = require('./routes/user');
const videoSdkRoutes = require('./routes/videosdk');
const inviteRoutes = require('./routes/invite');
const ja3Routes = require('./routes/ja3');
const notificationsRoutes = require('./routes/notifications');

const app = express();

const allowedOrigins = ['https://eloscloud.com', 'http://localhost:3000'];

const corsOptions = {
  origin: (origin, callback) => {
    if (!origin || allowedOrigins.indexOf(origin) !== -1) {
      callback(null, true);
    } else {
      callback(new Error('Not allowed by CORS'));
    }
  },
  methods: 'GET,HEAD,PUT,PATCH,POST,DELETE,OPTIONS',
  allowedHeaders: 'Content-Type, Authorization',
  credentials: true,
  optionsSuccessStatus: 204
};

app.use(cors(corsOptions));
app.use(express.json());
app.use(bodyParser.urlencoded({ extended: true }));
app.use(morgan('dev'));

// Adicionar cabeçalhos de segurança para lidar com Cross-Origin-Opener-Policy
app.use((req, res, next) => {
  res.setHeader('Cross-Origin-Opener-Policy', 'same-origin');
  res.setHeader('Cross-Origin-Embedder-Policy', 'require-corp');
  next();
});

app.get('/', (req, res) => {
  res.send(`Server running on port ${PORT}`);
});

app.use('/api/payments', paymentsRoutes);
app.use('/api/auth', authRoutes);
app.use('/api/recaptcha', recaptchaRoutes);
app.use('/api/email', emailRoutes);
app.use('/api/users', userRoutes);
app.use('/api/videosdk', videoSdkRoutes);
app.use('/api/invite', inviteRoutes);
app.use('/api/ja3', ja3Routes);
app.use('/api/notifications', notificationsRoutes);

const PORT = process.env.PORT || 9000;

app.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
});