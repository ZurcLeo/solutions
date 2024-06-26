const admin = require('firebase-admin');
const firestore = admin.firestore();

class Reaction {
  constructor(data) {
    this.id = data.id;
    this.tipoDeReacao = data.tipoDeReacao;
    this.senderName = data.senderName;
    this.senderFoto = data.senderFoto;
    this.timestamp = data.timestamp ? new Date(data.timestamp.seconds * 1000) : new Date();
  }

  static async getByPostId(postId) {
    const snapshot = await firestore.collection('posts').doc(postId).collection('reacoes').get();
    return snapshot.docs.map(doc => new Reaction(doc.data()));
  }

  static async create(postId, data) {
    const reaction = new Reaction(data);
    const docRef = await firestore.collection('posts').doc(postId).collection('reacoes').add({ ...reaction });
    reaction.id = docRef.id;
    return reaction;
  }

  static async delete(postId, reactionId) {
    const reactionRef = firestore.collection('posts').doc(postId).collection('reacoes').doc(reactionId);
    await reactionRef.delete();
  }
}

module.exports = Reaction;