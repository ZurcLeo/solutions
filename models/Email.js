// models/Email.js
const { getFirestore } = require('../firebaseAdmin');
const { logger } = require('../logger');

class Email {
  constructor(data) {
    this.id = data.id;
    this.to = data.to;
    this.subject = data.subject;
    this.templateType = data.templateType;
    this.templateData = data.templateData || {};
    this.status = data.status || 'pending';
    this.createdAt = data.createdAt || new Date();
    this.sentAt = data.sentAt || null;
    this.userId = data.userId || null;
    this.reference = data.reference || null; // Reference to related entity (e.g., inviteId)
    this.referenceType = data.referenceType || null; // Type of reference (e.g., 'invite')
    this.messageId = data.messageId || null; // Message ID from the email provider
    this.error = data.error || null;
    this.retryCount = data.retryCount || 0;
  }

  toPlainObject() {
    return {
      id: this.id,
      to: this.to,
      subject: this.subject,
      templateType: this.templateType,
      templateData: this.templateData,
      status: this.status,
      createdAt: this.createdAt,
      sentAt: this.sentAt,
      userId: this.userId,
      reference: this.reference,
      referenceType: this.referenceType,
      messageId: this.messageId,
      error: this.error,
      retryCount: this.retryCount
    };
  }

  static async create(emailData) {
    const db = getFirestore();
    try {
      const emailRef = db.collection('emails').doc();
      
      // Set default values
      const email = new Email({
        ...emailData,
        id: emailRef.id,
        createdAt: new Date()
      });
      
      await emailRef.set(email.toPlainObject());
      
      logger.info('Email record created', {
        service: 'emailModel',
        function: 'create',
        emailId: emailRef.id
      });
      
      return email;
    } catch (error) {
      logger.error('Error creating email record', {
        service: 'emailModel',
        function: 'create',
        error: error.message
      });
      throw error;
    }
  }

  static async getById(emailId) {
    const db = getFirestore();
    try {
      const emailDoc = await db.collection('emails').doc(emailId).get();
      
      if (!emailDoc.exists) {
        throw new Error('Email not found');
      }
      
      return new Email({ ...emailDoc.data(), id: emailDoc.id });
    } catch (error) {
      logger.error('Error getting email by ID', {
        service: 'emailModel',
        function: 'getById',
        emailId,
        error: error.message
      });
      throw error;
    }
  }

  static async updateStatus(emailId, status, data = {}) {
    const db = getFirestore();
    try {
      const emailRef = db.collection('emails').doc(emailId);
      
      const updateData = {
        status,
        ...data
      };
      
      // If status is 'sent', set sentAt
      if (status === 'sent' && !data.sentAt) {
        updateData.sentAt = new Date();
      }
      
      // If status is 'error', increment retry count
      if (status === 'error' && !data.retryCount) {
        const emailDoc = await emailRef.get();
        if (emailDoc.exists) {
          updateData.retryCount = (emailDoc.data().retryCount || 0) + 1;
        }
      }
      
      await emailRef.update(updateData);
      
      logger.info('Email status updated', {
        service: 'emailModel',
        function: 'updateStatus',
        emailId,
        status
      });
      
      return true;
    } catch (error) {
      logger.error('Error updating email status', {
        service: 'emailModel',
        function: 'updateStatus',
        emailId,
        status,
        error: error.message
      });
      throw error;
    }
  }

  static async getByUser(userId, limit = 50) {
    const db = getFirestore();
    try {
      const snapshot = await db.collection('emails')
        .where('userId', '==', userId)
        .orderBy('createdAt', 'desc')
        .limit(limit)
        .get();
      
      return snapshot.docs.map(doc => 
        new Email({ ...doc.data(), id: doc.id })
      );
    } catch (error) {
      logger.error('Error getting emails by user', {
        service: 'emailModel',
        function: 'getByUser',
        userId,
        error: error.message
      });
      throw error;
    }
  }

  static async getByReference(referenceType, referenceId, limit = 50) {
    const db = getFirestore();
    try {
      const snapshot = await db.collection('emails')
        .where('referenceType', '==', referenceType)
        .where('reference', '==', referenceId)
        .orderBy('createdAt', 'desc')
        .limit(limit)
        .get();
      
      return snapshot.docs.map(doc => 
        new Email({ ...doc.data(), id: doc.id })
      );
    } catch (error) {
      logger.error('Error getting emails by reference', {
        service: 'emailModel',
        function: 'getByReference',
        referenceType,
        referenceId,
        error: error.message
      });
      throw error;
    }
  }

  static async getByStatus(status, limit = 100) {
    const db = getFirestore();
    try {
      const snapshot = await db.collection('emails')
        .where('status', '==', status)
        .orderBy('createdAt', 'desc')
        .limit(limit)
        .get();
      
      return snapshot.docs.map(doc => 
        new Email({ ...doc.data(), id: doc.id })
      );
    } catch (error) {
      logger.error('Error getting emails by status', {
        service: 'emailModel',
        function: 'getByStatus',
        status,
        error: error.message
      });
      throw error;
    }
  }
}

module.exports = Email;