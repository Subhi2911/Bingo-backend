const admin = require("firebase-admin");

let serviceAccount;

try {
  serviceAccount = require("./serviceAccountKey.json");
} catch (error) {
  serviceAccount = JSON.parse(process.env.FIREBASE_SERVICE_ACCOUNT);
}

admin.initializeApp({
  credential: admin.credential.cert(serviceAccount),
});

module.exports = admin;