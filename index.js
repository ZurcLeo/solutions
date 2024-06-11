const express = require('express');
const cors = require('cors');
const admin = require('firebase-admin');
const paymentRoutes = require('./routes/payment');

admin.initializeApp({
    credential: admin.credential.applicationDefault(),
});

const app = express();

// Configurar CORS para permitir requisições de localhost:3001
app.use(cors({
    origin: 'http://localhost:3001',
    methods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'],
    allowedHeaders: ['Content-Type', 'Authorization'],
    credentials: true
}));

app.use(express.json());

app.use('/api', paymentRoutes);

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
    console.log(`Server running on port ${PORT}`);
});
