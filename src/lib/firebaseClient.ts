import { initializeApp } from 'firebase/app';
import { getAuth, setPersistence, browserLocalPersistence } from 'firebase/auth';
import { getDatabase } from 'firebase/database';
import firebaseConfig from '../../firebase-applet-config.json';

let db: any = null;
let auth: any = null;

try {
  const app = initializeApp(firebaseConfig);
  db = getDatabase(app);
  auth = getAuth(app);

  // Force Firebase to ALWAYS remember the login on this device/browser.
  // Without this, some browsers (especially installed PWA / mobile webviews)
  // forget the session and ask for email+password again every time.
  setPersistence(auth, browserLocalPersistence).catch((e) => {
    console.warn('[Firebase] Could not set persistence:', e);
  });
} catch (e) {
  console.warn('[Firebase] Init skipped:', e);
}

export { db, auth };
