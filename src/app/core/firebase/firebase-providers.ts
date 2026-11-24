import { EnvironmentProviders, InjectionToken, inject, makeEnvironmentProviders } from '@angular/core';
import { getAnalytics, isSupported } from 'firebase/analytics';
import { FirebaseApp, getApp, getApps, initializeApp } from 'firebase/app';
import { Auth, getAuth } from 'firebase/auth';
import { FirebaseError } from 'firebase/app';
import {
  Firestore,
  getFirestore,
  initializeFirestore,
  persistentLocalCache,
  persistentMultipleTabManager,
} from 'firebase/firestore';
import { FirebaseStorage, getStorage } from 'firebase/storage';
import { environment } from '../../../environments/environment';

export const FIREBASE_APP = new InjectionToken<FirebaseApp>('FIREBASE_APP');
export const FIREBASE_AUTH = new InjectionToken<Auth>('FIREBASE_AUTH');
export const FIRESTORE = new InjectionToken<Firestore>('FIRESTORE');
export const FIREBASE_STORAGE = new InjectionToken<FirebaseStorage>('FIREBASE_STORAGE');

export function provideFirebase(): EnvironmentProviders {
  return makeEnvironmentProviders([
    {
      provide: FIREBASE_APP,
      useFactory: () => createFirebaseApp(),
    },
    {
      provide: FIREBASE_AUTH,
      useFactory: () => getAuth(inject(FIREBASE_APP)),
    },
    {
      provide: FIRESTORE,
      useFactory: () => createFirestore(inject(FIREBASE_APP)),
    },
    {
      provide: FIREBASE_STORAGE,
      useFactory: () => getStorage(inject(FIREBASE_APP)),
    },
  ]);
}

function createFirebaseApp(): FirebaseApp {
  const app = getApps().length ? getApp() : initializeApp(environment.firebase);
  void isSupported()
    .then((supported) => {
      if (supported) {
        getAnalytics(app);
      }
    })
    .catch(() => undefined);
  return app;
}

function createFirestore(app: FirebaseApp): Firestore {
  try {
    return initializeFirestore(app, {
      localCache: persistentLocalCache({
        tabManager: persistentMultipleTabManager(),
      }),
    });
  } catch (error) {
    if (error instanceof FirebaseError && error.code === 'failed-precondition') {
      return getFirestore(app);
    }
    throw error;
  }
}
