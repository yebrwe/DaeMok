export interface FirebaseClientConfiguration {
  apiKey: string;
  authDomain: string;
  databaseURL: string;
  projectId: string;
  storageBucket: string;
  messagingSenderId: string;
  appId: string;
  measurementId: string;
}

export const FIREBASE_CLIENT_CONFIG = Object.freeze({
  apiKey: 'AIzaSyBxHJ14JjS3DOHHR9xwLGjIKdBJp8cD448',
  authDomain: 'daemok-155c1.firebaseapp.com',
  databaseURL: 'https://daemok-155c1-default-rtdb.asia-southeast1.firebasedatabase.app',
  projectId: 'daemok-155c1',
  storageBucket: 'daemok-155c1.firebasestorage.app',
  messagingSenderId: '991265301980',
  appId: '1:991265301980:web:13a56cb9609cdb92d5db19',
  measurementId: 'G-3HXC4G5MTG',
}) satisfies FirebaseClientConfiguration;

const REQUIRED_FIREBASE_CLIENT_KEYS = [
  'apiKey',
  'authDomain',
  'databaseURL',
  'projectId',
  'appId',
] as const;

export function hasFirebaseClientConfiguration(
  config: Partial<FirebaseClientConfiguration>,
): boolean {
  return REQUIRED_FIREBASE_CLIENT_KEYS.every((key) => (
    typeof config[key] === 'string' && config[key].trim().length > 0
  ));
}

export const FIREBASE_CLIENT_CONFIGURED = hasFirebaseClientConfiguration(
  FIREBASE_CLIENT_CONFIG,
);
