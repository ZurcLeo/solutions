const admin = require('firebase-admin');
const { logger } = require('./logger');
require('dotenv').config();

let firebaseApp;
let db;
let auth;
let storage;

function initializeFirebaseAdmin() {
  try {
    if (firebaseApp) {
      return firebaseApp;
    }

    const serviceAccount = process.env.FIREBASE_CREDENTIALS;

    if (!serviceAccount) {
      throw new Error('FIREBASE_CREDENTIALS não encontradas nas variáveis de ambiente');
    }

    const parsedServiceAccount = JSON.parse(serviceAccount);

    firebaseApp = admin.initializeApp({
      credential: admin.credential.cert(parsedServiceAccount),
      databaseURL: process.env.FIREBASE_DATABASE_URL,
      apiKey: process.env.FIREBASE_API_KEY,
      authDomain: process.env.FIREBASE_AUTH_DOMAIN,
      projectId: process.env.FIREBASE_PROJECT_ID,
      storageBucket: process.env.FIREBASE_STORAGE_BUCKET,
      messagingSenderId: process.env.FIREBASE_MESSAGING_SENDER_ID,
      appId: process.env.FIREBASE_APP_ID,
      measurementId: process.env.FIREBASE_MEASUREMENT_ID
    });

    db = admin.firestore();
    console.log(db);
    auth = admin.auth();
    storage = admin.storage().bucket();

    logger.info('Firebase Admin inicializado com sucesso', firebaseApp);

    return firebaseApp;
  } catch (error) {
    logger.error('Erro ao inicializar Firebase Admin:', error);
    throw error;
  }
}

// Função para verificar token
async function verifyToken(token) {
  try {
      const app = initializeFirebaseAdmin();
      const decodedToken = await app.auth().verifyIdToken(token);
      return decodedToken;
  } catch (error) {
      console.error('Erro ao verificar token:', error);
      throw error;
  }
}

// Getter para garantir que o `db` seja acessado corretamente
function getFirestore() {
  if (!db) {
    initializeFirebaseAdmin();
  }
  return db;
}

module.exports = {
  initializeFirebaseAdmin,
  verifyToken,
  getApp: () => firebaseApp,
  getFirestore, // Use este getter para acessar o Firestore
  auth,
  storage
};