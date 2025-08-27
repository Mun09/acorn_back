import admin from 'firebase-admin';

if (!admin.apps.length) {
  const serviceAccount = require('../../serviceAccountKey.json');

  admin.initializeApp({
    credential: admin.credential.cert(serviceAccount),
    projectId: serviceAccount.project_id, // 명시하면 더 안전
  });
}

export { admin };
