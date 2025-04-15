const { getFirestore } = require('../firebaseAdmin');

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
    const db = getFirestore(); // Garante a inicialização do Firestore
    const notificationData = {
      userId,
      type,
      content,
      url,
      createdAt: new Date(),
      read: false,
    };

    const notificationRef = db.collection('notificacoes')
      .doc(userId)
      .collection('notifications')
      .doc(); // Cria um novo documento com ID automático

    await notificationRef.set(notificationData);

    return new Notification(userId, type, content, url, notificationData.createdAt);
  }

  static async getByUserId(userId) {
    const db = getFirestore(); // Garante a inicialização do Firestore
    const notificationsRef = db.collection('notificacoes')
      .doc(userId)
      .collection('notifications');
  
    const notificationsSnapshot = await notificationsRef
      .orderBy('createdAt', 'desc') // Corrigido para ordenar por 'createdAt'
      .get();

    return notificationsSnapshot.docs.map(doc => ({
      id: doc.id,
      ...doc.data(),
    }));
  }

static async markAsRead(userId, notificationId) {
  const db = getFirestore();
  const notificationRef = db.collection('notificacoes')
    .doc(userId)
    .collection('notifications')
    .doc(notificationId);

  const doc = await notificationRef.get();

  if (!doc.exists) {
    throw new Error(`Notification not found: ${notificationId}`);
  }

  await notificationRef.update({ lida: true, lidaEm: new Date() });
  
  // Retornar o documento atualizado se necessário
  return { success: true, message: 'Notification marked as read' };
}
}

module.exports = Notification;