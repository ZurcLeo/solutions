// backend/scripts/migrateInterests.js
const admin = require('../firebaseAdmin');
const interestsService = require('../services/InterestsService');

const db = admin.getFirestore();

async function migrateInterests() {
    const allInterests = interestsService.getAvailableInterests();
    const categoriesMap = {}; // Para armazenar as categorias já criadas
  
    try {
      console.log('Iniciando a migração de interesses...');
  
      for (const interest of allInterests) {
        const categoryName = interest.category;
  
        // Verificar ou criar a categoria
        let categoryId = categoriesMap[categoryName];
        if (!categoryId) {
          // Verificar se a categoria já existe no Firestore
          const existingCategorySnapshot = await db.collection('interests_categories')
            .where('name', '==', categoryName)
            .get();
  
          if (existingCategorySnapshot.empty) {
            const categoryRef = await db.collection('interests_categories').add({
              name: categoryName,
              order: 0,
              active: true,
            });
            categoryId = categoryRef.id;
            categoriesMap[categoryName] = categoryId;
            console.log(`  Categoria ${categoryName} criada com ID: ${categoryId}`);
          } else {
            categoryId = existingCategorySnapshot.docs[0].id;
            categoriesMap[categoryName] = categoryId;
            console.log(`  Categoria ${categoryName} já existe com ID: ${categoryId}`);
          }
        }
  
        // Verificar se o interesse já existe para esta categoria
        const existingInterestSnapshot = await db.collection('interests')
          .where('label', '==', interest.label)
          .where('categoryId', '==', categoryId)
          .get();
  
        if (existingInterestSnapshot.empty) {
          await db.collection('interests').add({
            label: interest.label,
            categoryId: categoryId,
            order: 0,
            active: true,
          });
          console.log(`    Interesse ${interest.label} criado na categoria ${categoryName}.`);
        } else {
          console.log(`    Interesse ${interest.label} já existe na categoria ${categoryName}.`);
        }
      }
  
      console.log('Migração de interesses concluída!');
    } catch (error) {
      console.error('Erro durante a migração:', error);
    }
  }
  
  migrateInterests();