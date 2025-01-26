// models/blacklist.js
const { getFirestore } = require('../firebaseAdmin');

const db = getFirestore();

class Blacklist {
  constructor() {
    this.blacklistRef = db.collection('blacklist');
  }

  async addToBlacklist(token) {
    const tokenDoc = this.blacklistRef.doc(token);
    await tokenDoc.set({
      createdAt: db.FieldValue.serverTimestamp()
    });
  }

  async isTokenBlacklisted(token) {
    const tokenDoc = await this.blacklistRef.doc(token).get();
    return tokenDoc.exists;
  }

  async removeExpiredTokens() {
    const now = db.Timestamp.now();
    const snapshot = await this.blacklistRef.where('createdAt', '<', now.toDate()).get();
    
    const batch = db.batch();
    snapshot.forEach((doc) => {
      batch.delete(doc.ref);
    });
    
    await batch.commit();
  }
}

module.exports = Blacklist;