// firebaseAdmin.js
const admin = require('firebase-admin');
require('dotenv').config();

// Certifique-se de ter configurado suas credenciais corretamente.
const serviceAccount = require('./serviceAccountKey.json');

admin.initializeApp({
  credential: admin.credential.cert(serviceAccount),
  databaseURL: process.env.FIREBASE_DATABASE_URL
});

const db = admin.firestore();
const auth = admin.auth();

module.exports = { admin, db, auth };