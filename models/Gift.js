const admin = require('firebase-admin');
const firestore = admin.firestore();

class Gift {
  constructor(data) {
    this.id = data.id;
    this.giftId = data.giftId;
    this.senderName = data.senderName;
    this.sender = data.sender;
    this.valor = data.valor;
    this.nome = data.nome;
    this.url = data.url;
    this.timestamp = data.timestamp ? new Date(data.timestamp.seconds * 1000) : new Date();
  }

  static async getByPostId(postId) {
    const snapshot = await firestore.collection('posts').doc(postId).collection('gifts').get();
    return snapshot.docs.map(doc => new Gift(doc.data()));
  }

  static async create(postId, data) {
    const gift = new Gift(data);
    const docRef = await firestore.collection('posts').doc(postId).collection('gifts').add({ ...gift });
    gift.id = docRef.id;
    return gift;
  }

  static async delete(postId, giftId) {
    const giftRef = firestore.collection('posts').doc(postId).collection('gifts').doc(giftId);
    await giftRef.delete();
  }
}

module.exports = Gift;