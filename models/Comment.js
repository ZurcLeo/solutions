const admin = require('firebase-admin');
const firestore = admin.firestore();

class Comment {
  constructor(data) {
    this.id = data.id;
    this.texto = data.texto;
    this.usuarioNome = data.usuarioNome;
    this.usuarioId = data.usuarioId;
    this.usuarioFoto = data.usuarioFoto;
    this.timestamp = data.timestamp ? new Date(data.timestamp.seconds * 1000) : new Date();
  }

  static async getByPostId(postId) {
    const snapshot = await firestore.collection('posts').doc(postId).collection('comentarios').get();
    return snapshot.docs.map(doc => new Comment(doc.data()));
  }

  static async create(postId, data) {
    const comment = new Comment(data);
    const docRef = await firestore.collection('posts').doc(postId).collection('comentarios').add({ ...comment });
    comment.id = docRef.id;
    return comment;
  }

  static async delete(postId, commentId) {
    const commentRef = firestore.collection('posts').doc(postId).collection('comentarios').doc(commentId);
    await commentRef.delete();
  }
}

module.exports = Comment;