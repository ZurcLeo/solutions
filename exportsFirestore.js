const admin = require('firebase-admin');
const fs = require('fs');

// Caminho para o seu arquivo de chave privada do Firebase
const serviceAccount = require('./serviceAccountKey.json');

// Inicializar o Firebase Admin SDK
admin.initializeApp({
  credential: admin.credential.cert(serviceAccount),
  databaseURL: process.env.FIREBASE_DATABASE_URL
});

const db = admin.firestore();
const collectionName = 'conexoes'; 

async function exportCollection() {
  const snapshot = await db.collection(collectionName).get();
  const data = [];

  snapshot.forEach(doc => {
    data.push({ id: doc.id, ...doc.data() });
  });

  fs.writeFileSync(`${collectionName}.json`, JSON.stringify(data, null, 2));
  console.log(`Exported ${snapshot.size} documents from ${collectionName} collection.`);
}

exportCollection().catch(console.error);
