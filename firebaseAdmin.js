const admin = require('firebase-admin');
const { logger } = require('./logger');
require('dotenv').config();

try {
  const serviceAccount = JSON.parse(process.env.FIREBASE_CREDENTIALS);

logger.error('FIREBASE_CREDENTIALS:', serviceAccount)

  admin.initializeApp({
    credential: admin.credential.cert(serviceAccount),
    databaseURL: process.env.FIREBASE_DATABASE_URL,
    apiKey: process.env.FIREBASE_API_KEY,
    authDomain: process.env.FIREBASE_AUTH_DOMAIN,
    projectId: process.env.FIREBASE_PROJECT_ID,
    storageBucket: process.env.FIREBASE_STORAGE_BUCKET,
    messagingSenderId: process.env.FIREBASE_MESSAGING_SENDER_ID,
    appId: process.env.FIREBASE_APP_ID,
    measurementId: process.env.FIREBASE_MEASUREMENT_ID
  });

  const db = admin.firestore();
  const auth = admin.auth();
  const storage = admin.storage().bucket();

  module.exports = { admin, db, auth, storage };

} catch (error) {
  console.error("Erro ao carregar credenciais do Firebase:", error);
}