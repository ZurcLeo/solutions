const admin = require('firebase-admin');
const fs = require('fs');
require('dotenv').config();

// Caminho para o seu arquivo de chave privada do Firebase
const serviceAccount = require('./serviceAccountKey.json');

// Inicializar o Firebase Admin SDK
admin.initializeApp({
  credential: admin.credential.cert(serviceAccount),
  databaseURL: process.env.FIREBASE_DATABASE_URL,
});

const db = admin.firestore();

// Função para exportar dados de uma coleção, incluindo subcoleções
async function exportCollection(collectionName) {
  const collectionRef = db.collection(collectionName);
  const data = await exportDocuments(collectionRef, collectionName);
  fs.writeFileSync(`${collectionName}.json`, JSON.stringify(data, null, 2));
  console.log(`Exported data from ${collectionName} collection.`);
}

// Função recursiva para exportar documentos e suas subcoleções
async function exportDocuments(collectionRef, parentName = '') {
  const snapshot = await collectionRef.get();
  const data = [];

  if (snapshot.empty) {
    // Verificar e exportar subcoleções mesmo se a coleção principal estiver vazia
    const subCollections = await collectionRef.listDocuments().then(docRefs => {
      return Promise.all(docRefs.map(docRef => docRef.listCollections()));
    });

    for (const subCollectionGroup of subCollections) {
      for (const subCollection of subCollectionGroup) {
        const subCollectionData = await exportDocuments(subCollection, `${parentName}/${subCollection.id}`);
        if (subCollectionData.length > 0) {
          data.push({ id: subCollection.id, [subCollection.id]: subCollectionData });
        }
      }
    }
  } else {
    for (const doc of snapshot.docs) {
      const docData = { id: doc.id, ...doc.data() };
      const subCollections = await doc.ref.listCollections();

      for (const subCollection of subCollections) {
        docData[subCollection.id] = await exportDocuments(subCollection, `${parentName}/${doc.id}/${subCollection.id}`);
      }

      data.push(docData);
    }
  }

  return data;
}

// Função para listar todas as coleções
async function listCollections() {
  const collections = await db.listCollections();
  return collections.map((collection) => collection.id);
}

// Função principal para o CLI
async function main() {
  try {
    const inquirer = await import('inquirer');
    const collections = await listCollections();

    const { action } = await inquirer.default.prompt([
      {
        type: 'list',
        name: 'action',
        message: 'O que você gostaria de fazer?',
        choices: ['Mostrar todas as coleções', 'Exportar uma coleção específica', 'Sair'],
      },
    ]);

    if (action === 'Mostrar todas as coleções') {
      console.log('Coleções disponíveis:');
      collections.forEach((collection) => {
        console.log(collection);
      });
      return main(); // Rechama o menu principal
    }

    if (action === 'Exportar uma coleção específica') {
      const { collectionName } = await inquirer.default.prompt([
        {
          type: 'list',
          name: 'collectionName',
          message: 'Selecione a coleção que deseja exportar:',
          choices: collections,
        },
      ]);
      await exportCollection(collectionName);
      return main(); // Rechama o menu principal
    }

    if (action === 'Sair') {
      console.log('Saindo...');
      process.exit(0);
    }
  } catch (error) {
    console.error('Erro:', error);
  }
}

main();