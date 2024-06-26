const admin = require('firebase-admin');
const firestore = admin.firestore();

class GroupsCaixinha {
  constructor(data) {
    this.id = data.id;
    this.name = data.name;
    this.description = data.description;
    this.members = data.members || [];
    this.createdAt = data.createdAt ? new Date(data.createdAt.seconds * 1000) : new Date();
  }

  static async getById(id) {
    const doc = await firestore.collection('groupsCaixinha').doc(id).get();
    if (!doc.exists) {
      throw new Error('Grupo de caixinha não encontrado.');
    }
    return new GroupsCaixinha(doc.data());
  }

  static async create(data) {
    const group = new GroupsCaixinha(data);
    const docRef = await firestore.collection('groupsCaixinha').add({ ...group });
    group.id = docRef.id;
    return group;
  }

  static async update(id, data) {
    const groupRef = firestore.collection('groupsCaixinha').doc(id);
    await groupRef.update(data);
    const updatedDoc = await groupRef.get();
    return new GroupsCaixinha(updatedDoc.data());
  }

  static async delete(id) {
    const groupRef = firestore.collection('groupsCaixinha').doc(id);
    await groupRef.delete();
  }
}

module.exports = GroupsCaixinha;