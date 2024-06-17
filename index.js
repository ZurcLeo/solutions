require('dotenv').config();
const express = require('express');
const bodyParser = require('body-parser');
const cors = require('cors');
const morgan = require("morgan");
const admin = require('firebase-admin');

admin.initializeApp({
  credential: admin.credential.applicationDefault(),
  databaseURL: process.env.FIREBASE_DATABASE_URL,
});

const paymentsRoutes = require('./routes/payments');
const authRoutes = require('./routes/auth');
const recaptchaRoutes = require('./routes/recaptcha');
const emailRoutes = require('./routes/email');
const userRoutes = require('./routes/users');
const videoSdkRoutes = require('./routes/videosdk');
const inviteRoutes = require('./routes/invite');
const ja3Routes = require('./routes/ja3');

const app = express();

const corsOptions = {
  origin: 'https://eloscloud.com',
  methods: 'GET,HEAD,PUT,PATCH,POST,DELETE,OPTIONS',
  allowedHeaders: 'Content-Type, Authorization',
  credentials: true,
  optionsSuccessStatus: 204
};

app.use(cors(corsOptions));
app.use(express.json());
app.use(bodyParser.urlencoded({ extended: true }));
app.use(morgan("dev"));

app.get("/", (req, res) => {
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


const PORT = process.env.PORT || 3000;

app.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
});
