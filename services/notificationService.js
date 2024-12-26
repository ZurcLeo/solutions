// src/services/notificationService.js
const { FieldValue } = require('firebase-admin/firestore');
const { logger } = require('../logger');
const Notification = require('../models/Notification');

const notificationService = {
  /**
   * Fetches notifications for a specific user.
   * @param {string} userId - The ID of the user to fetch notifications for.
   * @returns {Promise<Object>} - An object containing private and public notifications.
   */
  getUserNotifications: async (userId) => {
    logger.info('Obtendo notificações do usuário', {
      service: 'notificationService',
      function: 'getUserNotifications',
      userId
    });

    try {
      const data = await Notification.getByUserId(userId);
      logger.info('Notificações obtidas com sucesso', {
        service: 'notificationService',
        function: 'getUserNotifications',
        userId,
        data
      });
      return { success: true, data };
    } catch (error) {
      logger.error(`Error getting user notifications: ${error.message}`, {
        service: 'notificationService',
        function: 'getUserNotifications',
        userId
      });
      return { success: false, message: `Error getting user notifications: ${error.message}` };
    }
  },

  /**
   * Marks a notification as read for a specific user.
   * @param {string} userId - The ID of the user.
   * @param {string} notificationId - The ID of the notification to mark as read.
   * @param {string} type - The type of the notification.
   * @returns {Promise<Object>} - The updated notification data.
   */
  markAsRead: async (userId, notificationId, type) => {
    logger.info('Marcando notificação como lida', {
      service: 'notificationService',
      function: 'markAsRead',
      userId,
      notificationId,
      type
    });

    try {
      const notificationRef = Notification.markAsRead(userId, notificationId, type);
      const doc = await notificationRef;
      console.log(doc)

      if (!doc.exists) {
        throw new Error(`No document to update: ${notificationId}`);
      }

      await notificationRef.update({ lida: true, lidaEm: FieldValue.serverTimestamp() });
      logger.info('Notificação marcada como lida com sucesso', {
        service: 'notificationService',
        function: 'markAsRead',
        userId,
        notificationId
      });
      return { success: true, message: 'Notification marked as read' };
    } catch (error) {
      logger.error(`Error marking notification as read: ${error.message}`, {
        service: 'notificationService',
        function: 'markAsRead',
        userId,
        notificationId
      });
      return { success: false, message: `Error marking notification as read: ${error.message}` };
    }
  },

  /**
   * Creates a new notification.
   * @param {string} userId - The ID of the user.
   * @param {Object} notificationData - The data of the notification to create.
   * @returns {Promise<Object>} - The created notification data.
   */
  createNotification: async (userId, notificationData) => {
    logger.info('Criando nova notificação', {
      service: 'notificationService',
      function: 'createNotification',
      userId,
      notificationData
    });

    try {
      const notificationRef = Notification.createNotificationRef(userId);
      await notificationRef.set({
        ...notificationData,
        createdAt: FieldValue.serverTimestamp(),
        lida: false
      });
      logger.info('Notificação criada com sucesso', {
        service: 'notificationService',
        function: 'createNotification',
        userId,
        notificationData
      });
      return { success: true, message: 'Notification created successfully' };
    } catch (error) {
      logger.error(`Error creating notification: ${error.message}`, {
        service: 'notificationService',
        function: 'createNotification',
        userId
      });
      return { success: false, message: `Error creating notification: ${error.message}` };
    }
  }
};

module.exports = notificationService;