const { getFirestore } = require('../firebaseAdmin');
const { logger } = require('../logger');

class Seller {
  constructor(data) {
    logger.info('Creating new Seller instance', { 
      service: 'sellerModel', 
      function: 'constructor', 
      data 
    });

    this.id = data.id;
    this.userId = data.userId;
    this.type = data.type;
    this.document = data.document;
    this.documentValidated = data.documentValidated || false;
    this.businessName = data.businessName;
    this.tradingName = data.tradingName;
    this.phone = data.phone;
    this.address = data.address;
    this.bankInfo = data.bankInfo;
    this.status = data.status || 'pending';
    this.commissionDue = data.commissionDue || 0;
    this.lastCommissionPayment = data.lastCommissionPayment ? 
      new Date(data.lastCommissionPayment.seconds * 1000) : null;
    this.createdAt = data.createdAt ? 
      new Date(data.createdAt.seconds * 1000) : new Date();
    this.updatedAt = data.updatedAt ? 
      new Date(data.updatedAt.seconds * 1000) : new Date();
  }

  toPlainObject() {
    return {
      id: this.id,
      userId: this.userId,
      type: this.type,
      document: this.document,
      documentValidated: this.documentValidated,
      businessName: this.businessName,
      tradingName: this.tradingName,
      phone: this.phone,
      address: this.address,
      bankInfo: this.bankInfo,
      status: this.status,
      commissionDue: this.commissionDue,
      lastCommissionPayment: this.lastCommissionPayment,
      createdAt: this.createdAt,
      updatedAt: this.updatedAt
    };
  }

  static async getById(sellerId) {
    const db = getFirestore();
    logger.info('Getting seller by ID', { 
      service: 'sellerModel', 
      function: 'getById', 
      sellerId 
    });

    if (!sellerId) {
      throw new Error('sellerId not provided');
    }

    try {
      const sellerDoc = await db.collection('sellers').doc(sellerId).get();
      if (!sellerDoc.exists) {
        logger.warn('Seller not found', { 
          service: 'sellerModel', 
          function: 'getById', 
          sellerId 
        });
        throw new Error('Seller not found');
      }

      return new Seller({ id: sellerId, ...sellerDoc.data() });
    } catch (error) {
      logger.error('Error getting seller', { 
        service: 'sellerModel', 
        function: 'getById', 
        sellerId, 
        error: error.message 
      });
      throw error;
    }
  }

  static async create(data) {
    const db = getFirestore();
    logger.info('Creating seller', { 
      service: 'sellerModel', 
      function: 'create', 
      data 
    });

    try {
      const seller = new Seller(data);
      const docRef = await db.collection('sellers').add(seller.toPlainObject());
      seller.id = docRef.id;
      return seller;
    } catch (error) {
      logger.error('Error creating seller', { 
        service: 'sellerModel', 
        function: 'create', 
        error: error.message 
      });
      throw error;
    }
  }

  static async update(sellerId, data) {
    const db = getFirestore();
    logger.info('Updating seller', { 
      service: 'sellerModel', 
      function: 'update', 
      sellerId, 
      data 
    });

    try {
      const sellerRef = db.collection('sellers').doc(sellerId);
      data.updatedAt = new Date();
      await sellerRef.update(data);
      
      const updatedDoc = await sellerRef.get();
      return new Seller({ id: sellerId, ...updatedDoc.data() });
    } catch (error) {
      logger.error('Error updating seller', { 
        service: 'sellerModel', 
        function: 'update', 
        sellerId, 
        error: error.message 
      });
      throw error;
    }
  }

  static async updateCommissionStatus(sellerId, commissionAmount) {
    const db = getFirestore();
    logger.info('Updating commission status', { 
      service: 'sellerModel', 
      function: 'updateCommissionStatus', 
      sellerId,
      commissionAmount 
    });

    try {
      const sellerRef = db.collection('sellers').doc(sellerId);
      const seller = await this.getById(sellerId);
      
      await sellerRef.update({
        commissionDue: seller.commissionDue + commissionAmount,
        updatedAt: new Date()
      });

      return this.getById(sellerId);
    } catch (error) {
      logger.error('Error updating commission', {
        service: 'sellerModel',
        function: 'updateCommissionStatus',
        sellerId,
        error: error.message
      });
      throw error;
    }
  }

  static async delete(sellerId) {
    const db = getFirestore();
    logger.info('Deleting seller', { 
      service: 'sellerModel', 
      function: 'delete', 
      sellerId 
    });

    try {
      await db.collection('sellers').doc(sellerId).delete();
    } catch (error) {
      logger.error('Error deleting seller', { 
        service: 'sellerModel', 
        function: 'delete', 
        sellerId, 
        error: error.message 
      });
      throw error;
    }
  }
}

module.exports = Seller;