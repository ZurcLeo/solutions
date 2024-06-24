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

// Função para exportar dados de uma coleção
async function exportCollection(collectionName) {
  const snapshot = await db.collection(collectionName).get();
  const data = [];

  snapshot.forEach((doc) => {
    data.push({ id: doc.id, ...doc.data() });
  });

  fs.writeFileSync(`${collectionName}.json`, JSON.stringify(data, null, 2));
  console.log(`Exported ${snapshot.size} documents from ${collectionName} collection.`);
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