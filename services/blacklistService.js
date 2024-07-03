// services/blacklistService.js
const { db, admin } = require('../firebaseAdmin');

const blacklistRef = db.collection('blacklist');

const addToBlacklist = async (token) => {
  const tokenDoc = blacklistRef.doc(token);
  await tokenDoc.set({
    createdAt: admin.firestore.FieldValue.serverTimestamp()
  });
};

const isTokenBlacklisted = async (token) => {
  const tokenDoc = await blacklistRef.doc(token).get();
  return tokenDoc.exists;
};

const removeExpiredTokens = async () => {
  const now = admin.firestore.Timestamp.now();
  const snapshot = await blacklistRef.where('createdAt', '<', now.toDate()).get();
  
  const batch = db.batch();
  snapshot.forEach((doc) => {
    batch.delete(doc.ref);
  });
  
  await batch.commit();
};

module.exports = {
  addToBlacklist,
  isTokenBlacklisted,
  removeExpiredTokens
};