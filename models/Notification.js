// models/Notification.js
const { db } = require('../firebaseAdmin');
const { FieldValue } = require('firebase-admin/firestore');
const { logger } = require('../logger');

class Notification {
  constructor(data) {
    // this.id = data.id;
    this.conteudo = data.conteudo;
    this.tipo = data.type;
    this.lida = data.lida || {};
    this.timestamp = data.timestamp || FieldValue.serverTimestamp();
    this.userId = data.userId;
    this.fotoDoPerfil = data.fotoDoPerfil || process.env.CLAUD_PROFILE_IMG;
    this.url = data.url || 'https://eloscloud.com';
  }

  static async create(userId, type, conteudo, url) {
    logger.info('[Notification.js][create][data] = ', conteudo)
    const data = {
      userId,
      type,
      conteudo,
      url,
    };
    const notification = new Notification(data);
    const collectionPath = type === 'global' ? 'notificacoes/global/notifications' : `notificacoes/${userId}/notifications`;
    const docRef = await db.collection(collectionPath).add({ ...notification });
    notification.id = docRef.id;
    return notification;
  }

  static async update(id, data, userId, type) {
    const collectionPath = type === 'global' ? 'notificacoes/global/notifications' : `notificacoes/${userId}/notifications`;
    const notificationRef = db.collection(collectionPath).doc(id);
    await notificationRef.update(data);
    const updatedDoc = await notificationRef.get();
    return new Notification(updatedDoc.data());
  }

  static async getUserNotifications(userId) {
    const privateNotificationsRef = db.collection(`notificacoes/${userId}/notifications`);
    const globalNotificationsRef = db.collection('notificacoes/global/notifications');

    const privateSnapshot = await privateNotificationsRef.where("lida", "==", false).get();
    const globalSnapshot = await globalNotificationsRef.get();

    const privateNotifications = privateSnapshot.docs.map(doc => ({
      id: doc.id,
      ...doc.data()
    }));

    const globalNotifications = globalSnapshot.docs.map(doc => {
      const data = doc.data();
      return {
        id: doc.id,
        ...data,
        isRead: !!data.lida[userId]
      };
    }).filter(notification => !notification.isRead);

    return { privateNotifications, globalNotifications };
  }
}

module.exports = Notification;