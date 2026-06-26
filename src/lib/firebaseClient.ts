import { initializeApp } from 'firebase/app';
import { getAuth } from 'firebase/auth';
import { getDatabase } from 'firebase/database';
import firebaseConfig from '../../firebase-applet-config.json';

let db: any = null;
let auth: any = null;

try {
  const app = initializeApp(firebaseConfig);
  db = getDatabase(app);
  auth = getAuth(app);
} catch (e) {
  console.warn('[Firebase] Init skipped:', e);
}

export { db, auth };
