require('dotenv').config();
const express = require('express');
const bodyParser = require('body-parser');
const cors = require('./middlewares/cors');
const paymentsRoutes = require('./routes/payments');
const admin = require('firebase-admin');

// Inicialize o Firebase Admin SDK usando credenciais das variáveis de ambiente
const serviceAccount = JSON.parse(process.env.FIREBASE_CREDENTIALS);

admin.initializeApp({
    credential: admin.credential.cert(serviceAccount),
    databaseURL: process.env.FIREBASE_DATABASE_URL,
});

const app = express();
app.use(cors);
app.use(express.json());
app.use(bodyParser.json());

// Use rotas
app.use('/api', paymentsRoutes);

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
    console.log(`Server running on port ${PORT}`);
});
