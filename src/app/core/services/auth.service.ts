import { Injectable, inject, signal } from '@angular/core';
import { FirebaseError } from 'firebase/app';
import { User, onAuthStateChanged, signInWithEmailAndPassword, signOut } from 'firebase/auth';
import {
  Unsubscribe,
  doc,
  getDoc,
  onSnapshot,
  serverTimestamp,
  setDoc,
  updateDoc,
  writeBatch,
} from 'firebase/firestore';
import { PLATFORM_OWNER_EMAIL, type AppSession, type UserRole } from '../domain/models';
import { FIREBASE_AUTH, FIRESTORE } from '../firebase/firebase-providers';
import { isUserRole } from '../firestore/mappers';

@Injectable({ providedIn: 'root' })
export class AuthService {
  private readonly auth = inject(FIREBASE_AUTH);
  private readonly firestore = inject(FIRESTORE);
  readonly session = signal<AppSession | null>(null);
  readonly ready = signal(false);
  private readonly readyPromise: Promise<void>;
  private stopProfile: Unsubscribe | null = null;

  constructor() {
    this.readyPromise = new Promise((resolve) => {
      let settled = false;
      const finish = () => {
        if (settled) {
          return;
        }
        settled = true;
        this.ready.set(true);
        resolve();
      };
      onAuthStateChanged(
        this.auth,
        (user) => {
          void this.applyUser(user).finally(finish);
        },
        () => {
          this.session.set(null);
          finish();
        },
      );
      setTimeout(finish, 8000);
    });
  }

  ensureSession(): Promise<AppSession | null> {
    return this.readyPromise.then(() => this.session());
  }

  async signIn(email: string, password: string): Promise<void> {
    await signInWithEmailAndPassword(this.auth, email.trim(), password);
    const current = this.auth.currentUser;
    if (current) {
      await this.applyUser(current);
    }
  }

  signOut(): Promise<void> {
    this.stopProfile?.();
    this.stopProfile = null;
    return signOut(this.auth);
  }

  private async applyUser(user: User | null): Promise<void> {
    this.stopProfile?.();
    this.stopProfile = null;
    if (!user) {
      this.session.set(null);
      return;
    }

    await this.ensureProfile(user);
    await new Promise<void>((resolve) => {
      let first = true;
      this.stopProfile = onSnapshot(
        doc(this.firestore, 'users', user.uid),
        (snapshot) => {
          this.session.set(mapSession(user, snapshot.data()));
          if (first) {
            first = false;
            resolve();
          }
        },
        () => {
          this.session.set(mapSession(user, undefined));
          if (first) {
            first = false;
            resolve();
          }
        },
      );
    });
  }

  private async ensureProfile(user: User): Promise<void> {
    const email = (user.email ?? '').toLowerCase();
    const userRef = doc(this.firestore, 'users', user.uid);
    const snapshot = await getDoc(userRef);
    if (!snapshot.exists()) {
      const owner = email === PLATFORM_OWNER_EMAIL;
      const batch = writeBatch(this.firestore);
      batch.set(userRef, {
        email,
        displayName: user.displayName || email,
        role: owner ? 'super_admin' : null,
        tenantId: null,
        active: true,
        updatedAt: serverTimestamp(),
      });
      if (email) {
        batch.set(doc(this.firestore, 'accounts', email), { uid: user.uid, email });
      }
      try {
        await batch.commit();
      } catch (error) {
        const again = await getDoc(userRef);
        if (!again.exists()) {
          throw error;
        }
      }
      return;
    }

    if (email === PLATFORM_OWNER_EMAIL && !isUserRole(snapshot.data()['role'])) {
      await updateDoc(userRef, {
        role: 'super_admin',
        tenantId: null,
        updatedAt: serverTimestamp(),
      });
    }

    if (!email) {
      return;
    }
    const accountRef = doc(this.firestore, 'accounts', email);
    const account = await getDoc(accountRef);
    if (!account.exists()) {
      try {
        await setDoc(accountRef, { uid: user.uid, email });
      } catch (error) {
        if (!(error instanceof FirebaseError) || error.code !== 'permission-denied') {
          throw error;
        }
      }
    }
  }
}

function mapSession(user: User, data: Record<string, unknown> | undefined): AppSession {
  const roleValue = data?.['role'];
  const tenantValue = data?.['tenantId'];
  const role: UserRole | null = isUserRole(roleValue) ? roleValue : null;
  const tenantId = typeof tenantValue === 'string' && tenantValue.length > 0 ? tenantValue : null;
  return {
    uid: user.uid,
    email: user.email,
    displayName: user.displayName,
    role,
    tenantId,
    subscriptionActive: role === 'super_admin' || role !== null,
  };
}
