const { error } = require('winston');
const {admin} = require('../firebaseAdmin');
const firestore = admin.firestore();

class Invite {
  constructor(data) {
    this.id = data.id;
    this.createdAt = data.createdAt ? new Date(data.createdAt._seconds * 1000) : new Date();
    this.senderId = data.senderId;
    this.senderName = data.senderName;
    this.senderPhotoURL = data.senderPhotoURL;
    this.inviteId = data.inviteId;
    this.email = data.email;
    this.validatedBy = data.validatedBy || null;
    this.status = data.status;
    this.lastSentAt = data.lastSentAt ? new Date(data.lastSentAt._seconds * 1000) : null;
  }

  static async getById(id) {
    const doc = await firestore.collection('convites').doc(id).get();
    if (!doc.exists) {
      throw new Error('Convite não encontrado.');
    }
    return new Invite(doc.data());
  }

  static async create(data) {
    const invite = new Invite(data);
    const docRef = await firestore.collection('convites').add({ ...invite });
    invite.id = docRef.id;
    return invite;
  }

  static async update(id, data) {
    const inviteRef = firestore.collection('convites').doc(id);
    await inviteRef.update(data);
    const updatedDoc = await inviteRef.get();
    return new Invite(updatedDoc.data());
  }

  static async delete(id) {
    const inviteRef = firestore.collection('convites').doc(id);
    await inviteRef.delete();
  }

  static async getBySenderId(senderId) {
    const userRef = firestore.collection('usuario').doc(senderId);
    const userDoc = await userRef.get();
    if (!userDoc.exists) {
      throw new Error('Usuário não encontrado.', error);
    }
    const snapshot = await firestore.collection('convites').where('senderId', '==', senderId).get();
    return snapshot.docs.map(doc => new Invite(doc.data()));
  }

}

module.exports = Invite;