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

    // Refere-se ao caminho correto no Firestore: db/notificacoes/${userId}/notifications/notificationId
    const notificationRef = db.collection('notificacoes')
      .doc(userId)
      .collection('notifications')
      .doc(); // Cria um novo documento com um ID gerado automaticamente
    await notificationRef.set(notificationData);

    return new Notification(userId, type, content, url, notificationData.createdAt);
  }

  static async getByUserId(userId) {
    const notificationsRef = db.collection('notificacoes')
      .doc(userId)
      .collection('notifications');
  
    const notificationsSnapshot = await notificationsRef
      .orderBy('timestamp', 'desc')
      .get();
  
    console.log("Total de documentos recuperados: ", notificationsSnapshot.size);
  
    notificationsSnapshot.forEach(doc => {
      console.log(doc.id, '=>', doc.data());
    });
  
    return notificationsSnapshot.docs.map(doc => ({
      id: doc.id, // Inclui o ID da notificação para referência
      ...doc.data()
    }));
  }

  static async markAsRead(userId, notificationId) {
    // Refere-se ao caminho correto no Firestore: db/notificacoes/${userId}/notifications/notificationId
    const notificationRef = db.collection('notificacoes')
      .doc(userId)
      .collection('notifications')
      .doc(notificationId);
      
    const doc = await notificationRef.get();
    
    if (!doc.exists) {
      throw new Error(`No document to update: ${notificationId}`);
    }

    await notificationRef.update({ read: true, readAt: new Date() });
  }
}

module.exports = Notification;