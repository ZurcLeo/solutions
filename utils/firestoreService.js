// backend/services/firestoreService.js
const { getFirestore } = require('../firebaseAdmin');

class FirestoreService {
  constructor() {
    this.db = getFirestore();
  }

  collection(collectionName) {
    return this.db.collection(collectionName);
  }
}

module.exports = new FirestoreService();