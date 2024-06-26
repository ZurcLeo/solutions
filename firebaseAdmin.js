var admin = require("firebase-admin");

var serviceAccount = require("./serviceAccountKey.json");

admin.initializeApp({
  credential: admin.credential.cert(serviceAccount),
  databaseURL: "https://elossolucoescloud-1804e-default-rtdb.firebaseio.com"
});

const db = admin.firestore();

module.exports = { admin, db };
