// BankAccount.js (Updated with encryption)
const encryptionService = require('../services/encryptionService');
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
    
    // Public fields (not encrypted)
    this.bankName = data.bankName;
    this.isActive = data.isActive || false;
    this.createdAt = data.createdAt ? new Date(data.createdAt.seconds * 1000) : new Date();
    this.updatedAt = data.updatedAt ? new Date(data.updatedAt.seconds * 1000) : null;
    
    // Secure fields - will be encrypted
    if (data.encrypted) {
      // Encrypted data already present, store it directly
      this.encrypted = data.encrypted;
      
      // Store last 4 digits for reference (if available)
      this.lastDigits = data.lastDigits || null;
    } else {
      // Data is in plaintext, needs to be encrypted
      this.accountNumber = data.accountNumber;
      this.accountHolder = data.accountHolder;
      this.accountType = data.accountType;
      this.bankCode = data.bankCode;
      this.pixKey = data.pixKey || null;
      this.pixKeyType = data.pixKeyType || null;
    }
  }

  /**
   * Prepares the bank account for storage by encrypting sensitive data
   * @returns {Promise<Object>} Data ready for storage
   */
  async prepareForStorage() {
    try {
      // Create the sensitive data object to encrypt
      const sensitiveData = {
        accountNumber: this.accountNumber,
        accountHolder: this.accountHolder,
        accountType: this.accountType,
        bankCode: this.bankCode,
        pixKey: this.pixKey,
        pixKeyType: this.pixKeyType
      };
      
      // Encrypt the sensitive data
      this.encrypted = await encryptionService.encrypt(sensitiveData, {
        dataType: 'bank_account',
        // Add Additional Authenticated Data for extra protection
        aad: `bank_account_${this.adminId}_${this.caixinhaId}`
      });
      
      // Store the last 4 digits for reference
      this.lastDigits = this.accountNumber ? this.accountNumber.slice(-4) : null;
      
      // Remove plaintext sensitive fields
      delete this.accountNumber;
      delete this.accountHolder;
      delete this.accountType;
      delete this.bankCode;
      delete this.pixKey;
      delete this.pixKeyType;
      
      // Return the object ready for storage
      return {
        id: this.id,
        adminId: this.adminId,
        caixinhaId: this.caixinhaId,
        bankName: this.bankName,
        isActive: this.isActive,
        encrypted: this.encrypted,
        lastDigits: this.lastDigits,
        createdAt: this.createdAt,
        updatedAt: this.updatedAt
      };
    } catch (error) {
      logger.error('Erro ao criptografar dados bancários', {
        service: 'BankAccount',
        method: 'prepareForStorage',
        adminId: this.adminId,
        caixinhaId: this.caixinhaId,
        error: error.message
      });
      throw new Error('Falha ao criptografar dados bancários');
    }
  }

  /**
   * Decrypts the sensitive data for this bank account
   * @returns {Promise<BankAccount>} This instance with decrypted data
   */
  async decrypt() {
    if (!this.encrypted) {
      return this; // No encrypted data to decrypt
    }
    
    try {
      // Decrypt the sensitive data
      const decrypted = await encryptionService.decrypt(this.encrypted, {
        dataType: 'bank_account',
        // Same AAD used during encryption for verification
        aad: `bank_account_${this.adminId}_${this.caixinhaId}`
      });
      
      // Apply decrypted properties to this instance
      this.accountNumber = decrypted.accountNumber;
      this.accountHolder = decrypted.accountHolder;
      this.accountType = decrypted.accountType;
      this.bankCode = decrypted.bankCode;
      this.pixKey = decrypted.pixKey;
      this.pixKeyType = decrypted.pixKeyType;
      
      return this;
    } catch (error) {
      logger.error('Erro ao descriptografar dados bancários', {
        service: 'BankAccount',
        method: 'decrypt',
        adminId: this.adminId,
        caixinhaId: this.caixinhaId,
        error: error.message
      });
      throw new Error('Falha ao descriptografar dados bancários');
    }
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
      // Note: We can no longer filter by accountNumber directly as it's encrypted
      if (query.lastDigits) {
        queryRef = queryRef.where('lastDigits', '==', query.lastDigits);
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
  
      const accounts = [];
      
      // Process each account, potentially decrypting if needed
      for (const doc of snapshot.docs) {
        const account = new BankAccount({
          ...doc.data(),
          id: doc.id
        });
        
        // Decrypt only if explicitly requested
        if (query.includeDecrypted === true) {
          await account.decrypt();
        }
        
        accounts.push(account);
      }
  
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

  static async getById(adminId, id, options = {}) {
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

      const account = new BankAccount({
        ...doc.data(),
        id
      });
      
      // Decrypt only if explicitly requested or by default
      const shouldDecrypt = options.decrypt !== false;
      if (shouldDecrypt) {
        await account.decrypt();
      }

      return account;
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

  static async getAllByAdmin(adminId, options = {}) {
    try {
      const db = getFirestore();
      const path = this.getPath(adminId);
      const snapshot = await db.collection(path).get();
      const accounts = [];
      
      // Process each account, potentially decrypting if needed
      for (const doc of snapshot.docs) {
        const account = new BankAccount({
          ...doc.data(),
          id: doc.id
        });
        
        // Decrypt only if explicitly requested or by default
        const shouldDecrypt = options.decrypt !== false;
        if (shouldDecrypt) {
          await account.decrypt();
        }
        
        accounts.push(account);
      }

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
  
      // Create account instance
      const account = new BankAccount(cleanAccountData);
      
      // Prepare account data with encryption
      const storageData = await account.prepareForStorage();
      
      const path = this.getPath(adminId);
  
      // Criar a conta bancária
      const docRef = db.collection(path).doc();
      await docRef.set({
        ...storageData,
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
      // Only adding non-sensitive or masked data to the caixinha
      const bankAccountData = caixinhaDoc.data().bankAccountData || [];
      bankAccountData.push(cleanFirestoreData({
          id: account.id,
          bankName: account.bankName,
          lastDigits: account.lastDigits,
          createdAt: account.createdAt,
      }));
      
      await caixinhaRef.update({ bankAccountData });
    
      logger.info('Dados bancários adicionados à caixinha com sucesso', {
        service: 'BankAccount',
        method: 'create',
        caixinhaId,
        accountsCount: bankAccountData.length,
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
      // If sensitive data is being updated, we need to handle encryption
      const hasSensitiveFields = [
        'accountNumber', 'accountHolder', 'accountType', 
        'bankCode', 'pixKey', 'pixKeyType'
      ].some(field => data[field] !== undefined);
      
      if (hasSensitiveFields) {
        // Get the existing account data
        const existingAccount = await this.getById(adminId, id, { decrypt: true });
        
        // Update with new data
        Object.assign(existingAccount, data);
        
        // Re-encrypt all sensitive data
        const storageData = await existingAccount.prepareForStorage();
        
        // Update in database
        const db = getFirestore();
        const path = this.getPath(adminId);
        await db.collection(path).doc(id).update({
          ...storageData,
          updatedAt: FieldValue.serverTimestamp()
        });
        
        logger.info('Conta bancária atualizada com dados sensíveis recriptografados', {
          service: 'BankAccount',
          method: 'update',
          adminId,
          accountId: id,
          updatedFields: Object.keys(data)
        });
        
        return existingAccount;
      } else {
        // Only updating non-sensitive fields
        const db = getFirestore();
        const path = this.getPath(adminId);
        await db.collection(path).doc(id).update({ 
          ...data, 
          updatedAt: FieldValue.serverTimestamp() 
        });
        
        // Get the updated account
        return this.getById(adminId, id);
      }
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
      
      // Get the account data to find associated caixinha
      const accountDoc = await accountRef.get();
      if (accountDoc.exists) {
        const accountData = accountDoc.data();
        const caixinhaId = accountData.caixinhaId;
        
        // Start a batch transaction
        const batch = db.batch();
        
        // Delete the account
        batch.delete(accountRef);
        
        // If we have a caixinha ID, update the caixinha's bankAccountData
        if (caixinhaId) {
          const caixinhaRef = db.collection('caixinhas').doc(caixinhaId);
          const caixinhaDoc = await caixinhaRef.get();
          
          if (caixinhaDoc.exists) {
            const caixinha = caixinhaDoc.data();
            const bankAccountData = caixinha.bankAccountData || [];
            
            // Remove this account from the array
            const updatedAccounts = bankAccountData.filter(account => account.id !== id);
            
            // Update the caixinha
            batch.update(caixinhaRef, { bankAccountData: updatedAccounts });
          }
        }
        
        // Commit all operations
        await batch.commit();
      } else {
        // Account doesn't exist, just log a warning
        logger.warn('Tentativa de excluir conta bancária inexistente', {
          service: 'BankAccount',
          method: 'delete',
          adminId,
          accountId: id
        });
      }

      logger.info('Conta bancária excluída com sucesso', {
        service: 'BankAccount',
        method: 'delete',
        adminId,
        accountId: id
      });
      
      return true;
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
        batch.update(doc.ref, { 
          isActive: false,
          updatedAt: FieldValue.serverTimestamp()
        });
      });

      await batch.commit();

      logger.info('Todas as contas bancárias foram desativadas', {
        service: 'BankAccount',
        method: 'deactivateAll',
        adminId,
        accountsDeactivated: snapshot.size
      });
      
      return true;
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
  
  /**
   * Migrates existing plaintext bank data to encrypted format
   * @param {string} adminId Admin ID to migrate accounts for
   * @returns {Promise<Object>} Migration statistics
   */
  static async migrateToEncrypted(adminId) {
    try {
      logger.info('Iniciando migração de contas bancárias para formato criptografado', {
        service: 'BankAccount',
        method: 'migrateToEncrypted',
        adminId
      });
      
      const db = getFirestore();
      const path = this.getPath(adminId);
      const snapshot = await db.collection(path).get();
      
      if (snapshot.empty) {
        logger.info('Nenhuma conta bancária para migrar', {
          service: 'BankAccount',
          method: 'migrateToEncrypted',
          adminId
        });
        return { migrated: 0, skipped: 0, failed: 0 };
      }
      
      let migrated = 0;
      let skipped = 0;
      let failed = 0;
      
      // Process accounts in batches for better performance
      const batchSize = 20;
      const batches = [];
      let currentBatch = [];
      
      snapshot.forEach(doc => {
        const data = doc.data();
        
        // Skip already encrypted accounts
        if (data.encrypted) {
          skipped++;
          return;
        }
        
        // Add to current batch
        currentBatch.push({ doc, data });
        
        // If batch full, add to batches and start new batch
        if (currentBatch.length >= batchSize) {
          batches.push([...currentBatch]);
          currentBatch = [];
        }
      });
      
      // Add any remaining accounts in the last batch
      if (currentBatch.length > 0) {
        batches.push([...currentBatch]);
      }
      
      // Process each batch
      for (const batch of batches) {
        const dbBatch = db.batch();
        
        for (const { doc, data } of batch) {
          try {
            // Create account instance with existing data
            const account = new BankAccount({ ...data, id: doc.id });
            
            // Prepare encrypted data
            const storageData = await account.prepareForStorage();
            
            // Set up batch update
            dbBatch.update(doc.ref, {
              ...storageData,
              updatedAt: FieldValue.serverTimestamp()
            });
            
            migrated++;
          } catch (error) {
            logger.error('Erro ao migrar conta bancária para formato criptografado', {
              service: 'BankAccount',
              method: 'migrateToEncrypted',
              adminId,
              accountId: doc.id,
              error: error.message
            });
            failed++;
          }
        }
        
        // Commit batch
        await dbBatch.commit();
      }
      
      logger.info('Migração de contas bancárias concluída', {
        service: 'BankAccount',
        method: 'migrateToEncrypted',
        adminId,
        migrated,
        skipped,
        failed
      });
      
      return { migrated, skipped, failed };
    } catch (error) {
      logger.error('Erro durante migração de contas bancárias', {
        service: 'BankAccount',
        method: 'migrateToEncrypted',
        adminId,
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