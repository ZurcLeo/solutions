require('dotenv').config();
const admin = require('firebase-admin');
const express = require('express');
const bodyParser = require('body-parser');
const cors = require('./middlewares/cors');
const paymentsRoutes = require('./routes/payments');
const authRoutes = require('./routes/auth');
const verifyToken = require('./middlewares/auth');
const recaptchaRoutes = require('./routes/recaptcha');
const emailRoutes = require('./routes/email');
const userRoutes = require('./routes/users');
const videoSdkRoutes = require('./routes/videosdk');

admin.initializeApp({
    credential: admin.credential.applicationDefault(),
    databaseURL: process.env.FIREBASE_DATABASE_URL,
  });

const app = express();
app.use(cors); 
app.use(express.json());
app.use(bodyParser.json());

app.use('/api/payments', paymentsRoutes);
app.use('/api/auth', authRoutes);
app.use('/api/recaptcha', recaptchaRoutes);
app.use('/api/email', emailRoutes);
app.use('/api/users', userRoutes);
app.use('/api/videosdk', verifyToken, videoSdkRoutes);

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
});
