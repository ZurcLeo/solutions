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
    const notificationDocRef = type === 'private'
        ? db.collection(`notificacoes/${userId}/notifications`).doc(notificationId)
        : db.collection('notificacoes/global/notifications').doc(notificationId);

    if (type === 'private') {
        await notificationDocRef.update({ lida: true });
    } else {
        await notificationDocRef.update({
            [`lida.${userId}`]: FieldValue.serverTimestamp()
        });
    }
};