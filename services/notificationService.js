// services/notificationService.js
const { db } = require('../firebaseAdmin');
const { FieldValue } = require('firebase-admin/firestore');
const Joi = require('joi')
const { getUserById } = require('../controllers/userController')

const notificationSchema = Joi.object({
  userId: Joi.string().optional(),
  type: Joi.string()
  .valid(
    'global', 
    'reacao',
    'comentario', 
    'presente', 
    'postagem',
    'caixinha',
    'mensagem',
    'amizade_aceita',
    'pedido_amizade',
    'email_enviado'
  ).required(),
  conteudo: Joi.string().required(),
  url: Joi.string().uri().optional(),
});

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
      await notificationDocRef.update({ 
        ['lidaEm']: FieldValue.serverTimestamp()
       });
    }

    console.log('Notification marked as read successfully');
  } catch (error) {
    console.error('Error updating notification', error);
    throw error;
  }
};

exports.createNotification = async (data) => {
  const { error, value } = notificationSchema.validate(data);
  if (error) {
      console.error(`Validation error: ${error.details[0].message}`);
      throw new Error('Invalid request parameters');
  }

  const { userId, type, conteudo, url } = value;

  const notification = {
      conteudo,
      tipo: type,
      lida: {},
      timestamp: FieldValue.serverTimestamp(),
      userId: type === 'global' ? 'global' : userId,
      fotoDoPerfil: type === 'global'? process.env.CLAUD_PROFILE_IMG : (await getUserById(userId)).fotoDoPerfil,
      url: type === 'global'? url : 'url-para-o-evento-que-gerou-a-notificacao'
  }

  try {
      if (type === 'global') {
          await db.collection('notificacoes/global/notifications').add(notification);
      } else {
          await db.collection(`notificacoes/${userId}/notifications`).add(notification);
      }
  } catch (error) {
      console.error(`Error creating notification: ${error.message}`);
      console.error(error.stack);
      console.error(`User ID: ${userId}, Type: ${type}`);
      throw new Error('Failed to create notification');
  }
};