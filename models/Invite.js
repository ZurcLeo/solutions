const admin = require('firebase-admin');
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
}

module.exports = Invite;