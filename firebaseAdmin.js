require('dotenv').config();
const admin = require('firebase-admin');
const { logger } = require('./logger');

let firebaseApp = null;
let db = null;
let auth = null;
let storage = null;

/**
 * Inicializa o Firebase Admin apenas uma vez, se ainda não foi inicializado.
 * Responsável apenas por inicializar o aplicativo Firebase.
 */
function initializeFirebaseApp() {
  if (firebaseApp) {
    return firebaseApp;
  }

  try {
    let credential;
    const serviceAccountPath = process.env.FIREBASE_CREDENTIALS;
    
    // Verificar se o valor da variável de ambiente é um caminho ou um JSON
    if (serviceAccountPath.startsWith('{')) {
      // É um JSON direto
      try {
        const serviceAccount = JSON.parse(serviceAccountPath);
        credential = admin.credential.cert(serviceAccount);
      } catch (jsonError) {
        logger.error('Erro ao parsear JSON de credenciais:', {
          message: jsonError.message,
        });
        throw jsonError;
      }
    } else {
      // É um caminho para um arquivo
      try {
        const serviceAccount = require(serviceAccountPath);
        credential = admin.credential.cert(serviceAccount);
      } catch (fileError) {
        logger.error('Erro ao carregar arquivo de credenciais:', {
          message: fileError.message,
        });
        throw fileError;
      }
    }
    
    firebaseApp = admin.initializeApp({
      credential: credential,
      databaseURL: process.env.FIREBASE_DATABASE_URL,
      projectId: process.env.FIREBASE_PROJECT_ID,
      storageBucket: process.env.FIREBASE_STORAGE_BUCKET,
    });

    logger.info('Firebase App inicializado com sucesso');
  } catch (error) {
    logger.error('Erro ao inicializar o Firebase App:', {
      message: error.message,
    });
    throw error;
  }

  return firebaseApp;
}

/**
 * Obtém uma instância do Firestore, inicializando-o se necessário.
 * Retorna uma instância única de Firestore.
 */
function getFirestore() {
  if (!firebaseApp) {
    initializeFirebaseApp();
  }

  if (!db) {
    db = admin.firestore();
    logger.info('Firestore inicializado com sucesso');
  }

  return db;
}

/**
 * Obtém uma instância do Auth, inicializando-o se necessário.
 * Retorna uma instância única de Auth.
 */
function getAuth() {
  if (!firebaseApp) {
    initializeFirebaseApp();
  }

  if (!auth) {
    auth = admin.auth();
    logger.info('Auth inicializado com sucesso');
  }

  return auth;
}

/**
 * Obtém uma instância do Storage, inicializando-o se necessário.
 * Retorna uma instância única de Storage.
 */
function getStorage() {
  if (!firebaseApp) {
    initializeFirebaseApp();
  }

  if (!storage) {
    storage = admin.storage().bucket();
    logger.info('Storage inicializado com sucesso');
  }

  return storage;
}

/**
 * Retorna a instância do aplicativo Firebase, inicializando se necessário.
 */
function getApp() {
  if (!firebaseApp) {
    initializeFirebaseApp();
  }
  return firebaseApp;
}

module.exports = {
  admin,
  getApp,
  getFirestore,
  getAuth,
  getStorage
};