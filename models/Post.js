const admin = require('firebase-admin');
const firestore = admin.firestore();

class Post {
  constructor(data) {
    this.id = data.id;
    this.conteudo = data.conteudo;
    this.mediaUrl = data.mediaUrl;
    this.usuarioNome = data.usuarioNome;
    this.visibilidade = data.visibilidade;
    this.usuarioId = data.usuarioId;
    this.tipoMedia = data.tipoMedia;
    this.usuarioFoto = data.usuarioFoto;
    this.timestamp = data.timestamp ? new Date(data.timestamp.seconds * 1000) : new Date();
    this.comentarios = data.comentarios || [];
    this.reacoes = data.reacoes || [];
    this.gifts = data.gifts || [];
  }

  static async getById(id) {
    const doc = await firestore.collection('posts').doc(id).get();
    if (!doc.exists) {
      throw new Error('Post não encontrado.');
    }
    return new Post(doc.data());
  }

  static async create(data) {
    const post = new Post(data);
    const docRef = await firestore.collection('posts').add({ ...post });
    post.id = docRef.id;
    return post;
  }

  static async update(id, data) {
    const postRef = firestore.collection('posts').doc(id);
    await postRef.update(data);
    const updatedDoc = await postRef.get();
    return new Post(updatedDoc.data());
  }

  static async delete(id) {
    const postRef = firestore.collection('posts').doc(id);
    await postRef.delete();
  }
}

module.exports = Post;