require('dotenv').config();
const express = require('express');
const bodyParser = require('body-parser');
const cors = require('./middlewares/cors');
const paymentsRoutes = require('./routes/payments');
const authRoutes = require('./routes/auth');  // Nova rota para autenticação
const recaptchaRoutes = require('./routes/recaptcha');
const emailRoutes = require('./routes/email');
const userRoutes = require('./routes/users');
const admin = require('firebase-admin');

// Inicialize o Firebase Admin SDK usando credenciais das variáveis de ambiente
const serviceAccount = require(process.env.FIREBASE_CREDENTIALS);

admin.initializeApp({
    credential: admin.credential.cert(serviceAccount),
    databaseURL: process.env.FIREBASE_DATABASE_URL,
});

const app = express();
app.use(cors);
app.use(express.json());
app.use(bodyParser.json());

// Use rotas
app.use('/api/payments', paymentsRoutes);
app.use('/api/auth', authRoutes); 
app.use('/api/recaptcha', recaptchaRoutes);
app.use('/api/email', emailRoutes);
app.use('/api/users', userRoutes);

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
    console.log(`Server running on port ${PORT}`);
});
