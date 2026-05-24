import { initializeApp } from 'firebase/app';
import { getAuth } from 'firebase/auth';
import { getFirestore } from 'firebase/firestore';
import firebaseConfig from '../../firebase-applet-config.json';

let app: any;
let db: any = null;
let auth: any = null;

try {
  app = initializeApp(firebaseConfig);
  try {
    db = getFirestore(app);
  } catch (firestoreErr: any) {
    console.warn("[FirebaseClient] Firestore failed to initialize, suppressing error:", firestoreErr.message);
  }
  try {
    auth = getAuth(app);
  } catch (authErr: any) {
    console.warn("[FirebaseClient] Auth failed to initialize, suppressing error:", authErr.message);
  }
} catch (globalErr: any) {
  console.warn("[FirebaseClient] Firebase SDK crashed or failed to initialize:", globalErr.message);
}

export { db, auth };

