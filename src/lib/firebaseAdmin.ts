import admin from 'firebase-admin';

if (!admin.apps.length) {
  // 권장: GOOGLE_APPLICATION_CREDENTIALS 또는 서비스 계정 JSON을 환경변수로
  admin.initializeApp({
    credential: admin.credential.applicationDefault(),
  });
}

export { admin };
