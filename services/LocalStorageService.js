// localStorageService.js
const fs = require('fs').promises;
const path = require('path');
const { logger } = require('../logger');

// Diretório onde os dados serão armazenados
const DATA_DIR = path.join(__dirname, '../data');

// Garantir que o diretório de dados existe
async function ensureDataDir() {
  try {
    await fs.mkdir(DATA_DIR, { recursive: true });
  } catch (error) {
    if (error.code !== 'EEXIST') {
      throw error;
    }
  }
}

// Simular a classe Collection do Firestore
class LocalCollection {
  constructor(collectionName) {
    this.collectionName = collectionName;
    this.filePath = path.join(DATA_DIR, `${collectionName}.json`);
  }

  // Carregar dados do arquivo
  async _loadData() {
    try {
      await ensureDataDir();
      const data = await fs.readFile(this.filePath, 'utf8');
      return JSON.parse(data);
    } catch (error) {
      if (error.code === 'ENOENT') {
        // Arquivo não existe, retornar objeto vazio
        return {};
      }
      throw error;
    }
  }

  // Salvar dados no arquivo
  async _saveData(data) {
    await ensureDataDir();
    await fs.writeFile(this.filePath, JSON.stringify(data, null, 2), 'utf8');
  }

  // Obter todos os documentos
  async get() {
    try {
      const data = await this._loadData();
      
      // Simular a estrutura de resposta do Firestore
      const documents = Object.entries(data).map(([id, docData]) => ({
        id,
        data: () => ({ ...docData }),
        exists: true
      }));
      
      // Adicionar métodos de iteração para compatibilidade
      documents.forEach = callback => {
        documents.map(doc => callback(doc));
        return documents;
      };
      
      return documents;
    } catch (error) {
      logger.error(`Erro ao carregar documentos da coleção ${this.collectionName}`, {
        service: 'LocalCollection',
        function: 'get',
        error: error.message
      });
      throw error;
    }
  }

  // Obter um documento por ID
  async doc(id) {
    try {
      const data = await this._loadData();
      
      return {
        id,
        async get() {
          return {
            id,
            data: () => data[id] || null,
            exists: !!data[id]
          };
        },
        async set(docData) {
          const updatedData = { ...data };
          updatedData[id] = { ...docData };
          await this._parent._saveData(updatedData);
          return true;
        },
        _parent: this
      };
    } catch (error) {
      logger.error(`Erro ao obter documento ${id} da coleção ${this.collectionName}`, {
        service: 'LocalCollection',
        function: 'doc',
        error: error.message
      });
      throw error;
    }
  }

  // Simular queries - muito simplificado
  where(field, operator, value) {
    return {
      async get() {
        const allDocs = await this._parent.get();
        const filteredDocs = allDocs.filter(doc => {
          const data = doc.data();
          if (operator === '==') {
            return data[field] === value;
          }
          // Adicionar mais operadores conforme necessário
          return false;
        });
        return filteredDocs;
      },
      _parent: this
    };
  }
}

// Classe para simular o batch do Firestore
class LocalBatch {
  constructor() {
    this.operations = [];
  }

  set(docRef, data) {
    this.operations.push({
      type: 'set',
      docRef,
      data
    });
  }

  update(docRef, data) {
    this.operations.push({
      type: 'update',
      docRef,
      data
    });
  }

  delete(docRef) {
    this.operations.push({
      type: 'delete',
      docRef
    });
  }

  async commit() {
    for (const operation of this.operations) {
      const { type, docRef, data } = operation;
      if (type === 'set') {
        await docRef.set(data);
      } else if (type === 'update') {
        const doc = await docRef.get();
        const currentData = doc.data() || {};
        await docRef.set({ ...currentData, ...data });
      } else if (type === 'delete') {
        const allData = await docRef._parent._loadData();
        delete allData[docRef.id];
        await docRef._parent._saveData(allData);
      }
    }
    return true;
  }
}

const LocalStorageService = {
  collection(name) {
    return new LocalCollection(name);
  },
  
  batch() {
    return new LocalBatch();
  },
  
  // Interface para compatibilidade com Firestore
  get db() {
    return {
      collection: this.collection,
      batch: this.batch
    };
  }
};

module.exports = LocalStorageService;