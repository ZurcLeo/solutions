// services/notificationService.js
const { db } = require('../firebaseAdmin');
const { FieldValue } = require('firebase-admin/firestore');

exports.getUserNotifications = async (userId) => {
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
};

exports.markAsRead = async (userId, notificationId, type) => {
  console.log(`markAsRead service called with userId: ${userId}, notificationId: ${notificationId}, type: ${type}`);

  try {
    const notificationDocRef = type === 'global'
      ? db.collection('notificacoes/global/notifications').doc(notificationId)
      : db.collection(`notificacoes/${userId}/notifications`).doc(notificationId);

    if (type === 'global') {
      await notificationDocRef.update({
        [`lida.${userId}`]: FieldValue.serverTimestamp()
      });
    } else {
      await notificationDocRef.update({ lida: true });
    }

    console.log('Notification marked as read successfully');
  } catch (error) {
    console.error('Error updating notification', error);
    throw error;
  }
};

exports.createNotification = async ({ userId, type, conteudo }) => {
  try {
    if (type === 'global') {
      const notification = {
        conteudo,
        tipo: type,
        lida: {}, // Initialize an empty object to store user IDs and timestamps
        timestamp: FieldValue.serverTimestamp(),
      };
      await db.collection('notificacoes/global/notifications').add(notification);
    } else {
      const notification = {
        conteudo,
        lida: false,
        tipo: type,
        timestamp: FieldValue.serverTimestamp(),
      };
      await db.collection(`notificacoes/${userId}/notifications`).add(notification);
    }
  } catch (error) {
    console.error(`Error creating notification: ${error.message}`);
    console.error(error.stack);
    // Log additional context, such as the user ID and notification type
    console.error(`User ID: ${userId}, Type: ${type}`);
    // Return an error response or re-throw the error
    return { error: 'Failed to create notification' };
    
  }
}