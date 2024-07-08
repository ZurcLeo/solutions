const { db } = require('../firebaseAdmin');

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
    const doc = await db.collection('convites').doc(id).get();
    if (!doc.exists) {
      throw new Error('Convite não encontrado.');
    }
    return new Invite({ ...doc.data(), id: doc.id });
  }

  static async create(data) {
    const invite = new Invite(data);
    const docRef = await db.collection('convites').add({ ...invite });
    invite.id = docRef.id;
    return invite;
  }

  static async update(id, data) {
    const inviteRef = db.collection('convites').doc(id);
    await inviteRef.update(data);
    const updatedDoc = await inviteRef.get();
    return new Invite({ ...updatedDoc.data(), id: updatedDoc.id });
  }

  static async delete(id) {
    const inviteRef = db.collection('convites').doc(id);
    await inviteRef.delete();
  }

  static async getBySenderId(senderId) {
    const snapshot = await db.collection('convites').where('senderId', '==', senderId).get();
    if (snapshot.empty) {
      throw new Error('Nenhum convite encontrado para este usuário.');
    }
    return snapshot.docs.map(doc => new Invite({ ...doc.data(), id: doc.id }));
  }
}

module.exports = Invite;