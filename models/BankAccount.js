const { getFirestore } = require('../firebaseAdmin');
const { FieldValue } = require('firebase-admin/firestore');
const { logger } = require('../logger');

function cleanData(data) {
    return Object.fromEntries(Object.entries(data).filter(([_, value]) => value !== undefined));
  }

  function cleanFirestoreData(data) {
    return JSON.parse(JSON.stringify(data, (key, value) => (value === undefined ? null : value)));
  }

class BankAccount {
  constructor(data) {
    this.id = data.id || null;
    this.adminId = data.adminId;
    this.caixinhaId = data.caixinhaId;
    this.bankName = data.bankName;
    this.accountNumber = data.accountNumber;
    this.accountHolder = data.accountHolder;
    this.accountType = data.accountType;
    this.pixKey = data.pixKey || null;
    this.isActive = data.isActive || false;
    this.createdAt = data.createdAt ? new Date(data.createdAt.seconds * 1000) : new Date();
    this.updatedAt = data.updatedAt ? new Date(data.updatedAt.seconds * 1000) : null;
  }

  static async find(adminId, query = {}) {
    try {
      const db = getFirestore();
      logger.info('Iniciando busca de contas bancárias', {
        service: 'BankAccount',
        method: 'find',
        adminId,
        query,
      });
  
      if (!adminId) {
        throw new Error('adminId é obrigatório para buscar contas bancárias.');
      }
  
      // Define o caminho para a subcoleção
      const accountsRef = db
        .collection('bankAccounts')
        .doc(adminId)
        .collection('accounts');
  
      let queryRef = accountsRef;
  
      // Aplica filtros dinamicamente se forem fornecidos na query
      if (query.caixinhaId) {
        queryRef = queryRef.where('caixinhaId', '==', query.caixinhaId);
      }
      if (query.accountNumber) {
        queryRef = queryRef.where('accountNumber', '==', query.accountNumber);
      }
      if (query.accountType) {
        queryRef = queryRef.where('accountType', '==', query.accountType);
      }
      if (query.isActive !== undefined) {
        queryRef = queryRef.where('isActive', '==', query.isActive);
      }
  
      const snapshot = await queryRef.get();
  
      if (snapshot.empty) {
        logger.info('Nenhuma conta bancária encontrada', {
          service: 'BankAccount',
          method: 'find',
          adminId,
        });
        return [];
      }
  
      const accounts = snapshot.docs.map((doc) => {
        const data = doc.data();
        return new BankAccount({
          ...data,
          id: doc.id,
          createdAt: data.createdAt?.toDate(),
          updatedAt: data.updatedAt?.toDate(),
        });
      });
  
      logger.info('Contas bancárias encontradas', {
        service: 'BankAccount',
        method: 'find',
        adminId,
        totalAccounts: accounts.length,
      });
  
      return accounts;
    } catch (error) {
      logger.error('Erro ao buscar contas bancárias', {
        service: 'BankAccount',
        method: 'find',
        adminId,
        query,
        error: error.message,
      });
      throw error;
    }
  }  

  static async getById(adminId, id) {
    try {
      const db = getFirestore();
      const path = this.getPath(adminId);
      const doc = await db.collection(path).doc(id).get();

      if (!doc.exists) {
        logger.warn('Conta bancária não encontrada', {
          service: 'BankAccount',
          method: 'getById',
          adminId,
          accountId: id
        });
        throw new Error('Conta bancária não encontrada.');
      }

      logger.info('Conta bancária encontrada', {
        service: 'BankAccount',
        method: 'getById',
        adminId,
        accountId: id
      });

      return new BankAccount(doc.data());
    } catch (error) {
      logger.error('Erro ao buscar conta bancária', {
        service: 'BankAccount',
        method: 'getById',
        adminId,
        accountId: id,
        error: error.message
      });
      throw error;
    }
  }

  static async getAllByAdmin(adminId) {
    try {
      const db = getFirestore();
      const path = this.getPath(adminId);
      const snapshot = await db.collection(path).get();
      const accounts = [];
      
      snapshot.forEach(doc => {
        accounts.push(new BankAccount(doc.data()));
      });

      logger.info('Listagem de contas bancárias por admin', {
        service: 'BankAccount',
        method: 'getAllByAdmin',
        adminId,
        accountsCount: accounts.length
      });

      return accounts;
    } catch (error) {
      logger.error('Erro ao listar contas bancárias', {
        service: 'BankAccount',
        method: 'getAllByAdmin',
        adminId,
        error: error.message
      });
      throw error;
    }
  }

  static async create(data) {
    try {
      const { adminId, caixinhaId } = data;
  
      if (!adminId || !caixinhaId) {
        logger.error('Tentativa de criar conta sem adminId ou caixinhaId', {
          service: 'BankAccount',
          method: 'create',
          data,
        });
        throw new Error('adminId e caixinhaId são obrigatórios para registrar uma conta bancária.');
      }
  
      const db = getFirestore();
  
      // Limpa os dados para garantir que não há valores undefined
      const cleanAccountData = cleanData(data);
  
      const account = new BankAccount(cleanAccountData);
      const path = this.getPath(adminId);
  
      // Criar a conta bancária
      const docRef = await db.collection(path).doc();
      await docRef.set({
        ...account,
        id: docRef.id,
        createdAt: FieldValue.serverTimestamp(),
        updatedAt: FieldValue.serverTimestamp(),
      });
  
      account.id = docRef.id;
  
      logger.info('Conta bancária criada com sucesso', {
        service: 'BankAccount',
        method: 'create',
        adminId,
        caixinhaId,
        accountId: account.id,
      });
  
      // Atualizar os dados bancários na caixinha
      const caixinhaRef = db.collection('caixinhas').doc(caixinhaId);
      const caixinhaDoc = await caixinhaRef.get();
  
      if (!caixinhaDoc.exists) {
        logger.error('Caixinha não encontrada para atualizar dados bancários', {
          service: 'BankAccount',
          method: 'create',
          caixinhaId,
        });
        throw new Error('Caixinha não encontrada.');
      }
  
      // Adicionar os dados da conta ao campo `bankAccountData`
      const bankAccountData = caixinhaDoc.data().bankAccountData || [];
      bankAccountData.push(cleanFirestoreData({
          id: account.id,
          bankCode: account.bankCode,
          bankName: account.bankName,
          accountNumber: account.accountNumber,
          accountHolder: account.accountHolder,
          accountType: account.accountType,
          pixKeyType: account.pixKeyType,
          pixKey: account.pixKey,
          createdAt: account.createdAt,
      }));
      await caixinhaRef.update({ bankAccountData });
    
      logger.info('Dados bancários adicionados à caixinha com sucesso', {
        service: 'BankAccount',
        method: 'create',
        caixinhaId,
        bankAccountData,
      });
  
      return account;
    } catch (error) {
      logger.error('Erro ao criar conta bancária', {
        service: 'BankAccount',
        method: 'create',
        adminId: data.adminId,
        caixinhaId: data.caixinhaId,
        error: error.message,
      });
      throw error;
    }
  }
  

  static async update(adminId, id, data) {
    try {
      const db = getFirestore();
      const path = this.getPath(adminId);
      const accountRef = db.collection(path).doc(id);

      await accountRef.update({ 
        ...data, 
        updatedAt: FieldValue.serverTimestamp() 
      });

      const updatedDoc = await accountRef.get();

      logger.info('Conta bancária atualizada com sucesso', {
        service: 'BankAccount',
        method: 'update',
        adminId,
        accountId: id,
        updatedFields: Object.keys(data)
      });

      return new BankAccount(updatedDoc.data());
    } catch (error) {
      logger.error('Erro ao atualizar conta bancária', {
        service: 'BankAccount',
        method: 'update',
        adminId,
        accountId: id,
        error: error.message
      });
      throw error;
    }
  }

  static async delete(adminId, id) {
    try {
      const db = getFirestore();
      const path = this.getPath(adminId);
      const accountRef = db.collection(path).doc(id);
      await accountRef.delete();

      logger.info('Conta bancária excluída com sucesso', {
        service: 'BankAccount',
        method: 'delete',
        adminId,
        accountId: id
      });
    } catch (error) {
      logger.error('Erro ao excluir conta bancária', {
        service: 'BankAccount',
        method: 'delete',
        adminId,
        accountId: id,
        error: error.message
      });
      throw error;
    }
  }

  static async deactivateAll(adminId) {
    try {
      const db = getFirestore();
      const path = this.getPath(adminId);
      const snapshot = await db.collection(path).where('isActive', '==', true).get();

      const batch = db.batch();
      snapshot.forEach(doc => {
        batch.update(doc.ref, { isActive: false });
      });

      await batch.commit();

      logger.info('Todas as contas bancárias foram desativadas', {
        service: 'BankAccount',
        method: 'deactivateAll',
        adminId,
        accountsDeactivated: snapshot.size
      });
    } catch (error) {
      logger.error('Erro ao desativar todas as contas', {
        service: 'BankAccount',
        method: 'deactivateAll',
        adminId,
        error: error.message
      });
      throw error;
    }
  }

  static async activate(adminId, id) {
    try {
      await this.deactivateAll(adminId);
      const result = await this.update(adminId, id, { isActive: true });

      logger.info('Conta bancária ativada com sucesso', {
        service: 'BankAccount',
        method: 'activate',
        adminId,
        accountId: id
      });

      return result;
    } catch (error) {
      logger.error('Erro ao ativar conta bancária', {
        service: 'BankAccount',
        method: 'activate',
        adminId,
        accountId: id,
        error: error.message
      });
      throw error;
    }
  }

  static getPath(adminId) {
    if (!adminId) throw new Error('adminId é obrigatório');
    return `bankAccounts/${adminId}/accounts`;
  }
}

module.exports = BankAccount;