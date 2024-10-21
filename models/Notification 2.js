// models/Notification.js
const { db } = require('../firebaseAdmin');

class Notification {
  constructor(userId, type, content, url, createdAt = new Date(), read = false) {
    this.userId = userId;
    this.type = type;
    this.content = content;
    this.url = url;
    this.createdAt = createdAt;
    this.read = read;
  }

  static async create(userId, type, content, url) {
    const notificationData = {
      userId,
      type,
      content,
      url,
      createdAt: new Date(),
      read: false
    };

    const notificationRef = db.collection('notifications').doc();
    await notificationRef.set(notificationData);

    return new Notification(userId, type, content, url, notificationData.createdAt);
  }

  static async getByUserId(userId) {
    const notificationsSnapshot = await db.collection('notifications')
      .where('userId', '==', userId)
      .orderBy('createdAt', 'desc')
      .get();

    return notificationsSnapshot.docs.map(doc => doc.data());
  }

  static async markAsRead(notificationId) {
    const notificationRef = db.collection('notifications').doc(notificationId);
    await notificationRef.update({ read: true });
  }
}

module.exports = Notification;