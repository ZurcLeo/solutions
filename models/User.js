const { admin } = require('../firebaseAdmin');
const firestore = admin.firestore();

class User {
  constructor(data) {
    this.id = data.id || data.uid;
    this.uid = data.uid;
    this.nome = data.nome;
    this.email = data.email;
    this.reacoes = data.reacoes || {};
    this.perfilPublico = data.perfilPublico || false;
    this.ja3Hash = data.ja3Hash;
    this.tipoDeConta = data.tipoDeConta;
    this.isOwnerOrAdmin = data.isOwnerOrAdmin || false;
    this.fotoDoPerfil = data.fotoDoPerfil;
    this.descricao = data.descricao;
    this.interessesNegocios = data.interessesNegocios || [];
    this.amigosAutorizados = data.amigosAutorizados || [];
    this.amigos = data.amigos || [];
    this.interessesPessoais = data.interessesPessoais || [];
    this.dataCriacao = data.dataCriacao ? new Date(data.dataCriacao.seconds * 1000) : new Date();
    this.saldoElosCoins = data.saldoElosCoins || 0;
    this.conversasComMensagensNaoLidas = data.conversasComMensagensNaoLidas || [];
  }

  static async getById(id) {
    const doc = await firestore.collection('usuario').doc(id).get();
    if (!doc.exists) {
      throw new Error('Usuário não encontrado.');
    }
    const data = doc.data();
    data.id = id; // Garante que o ID está no objeto
    return new User(data);
  }

  static async create(data) {
    const user = new User(data);
    const docRef = await firestore.collection('usuario').add({ ...user });
    user.id = docRef.id;
    return user;
  }

  static async update(id, data) {
    const userRef = firestore.collection('usuario').doc(id);
    await userRef.update(data);
    const updatedDoc = await userRef.get();
    return new User(updatedDoc.data());
  }

  static async delete(id) {
    const userRef = firestore.collection('usuario').doc(id);
    await userRef.delete();
  }
}

module.exports = User;