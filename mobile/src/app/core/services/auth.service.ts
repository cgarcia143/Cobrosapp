import { Injectable, signal } from '@angular/core';
import type { AppSession, StoredUser } from '../domain/models';
import { localDb, seedLocalData, sha256 } from '../db/local-db';

const SESSION_KEY = 'cobranzas.uid';

@Injectable({ providedIn: 'root' })
export class AuthService {
  readonly session = signal<AppSession | null>(null);

  async restore(): Promise<void> {
    await seedLocalData();
    const uid = localStorage.getItem(SESSION_KEY);
    if (!uid) {
      return;
    }
    const user = await localDb.user(uid);
    if (!user?.active) {
      localStorage.removeItem(SESSION_KEY);
      return;
    }
    this.session.set(toSession(user));
  }

  async signIn(email: string, password: string): Promise<AppSession> {
    await seedLocalData();
    const user = await localDb.userByEmail(email.trim().toLowerCase());
    if (!user || !user.active) {
      throw new Error('Correo o contraseña incorrectos.');
    }
    const hash = await sha256(password);
    if (hash !== user.passwordHash) {
      throw new Error('Correo o contraseña incorrectos.');
    }
    localStorage.setItem(SESSION_KEY, user.uid);
    const session = toSession(user);
    this.session.set(session);
    return session;
  }

  async refresh(): Promise<void> {
    const uid = this.session()?.uid;
    if (!uid) {
      return;
    }
    const user = await localDb.user(uid);
    if (!user?.active) {
      this.signOut();
      return;
    }
    this.session.set(toSession(user));
  }

  signOut(): void {
    localStorage.removeItem(SESSION_KEY);
    this.session.set(null);
  }
}

function toSession(user: StoredUser): AppSession {
  return {
    uid: user.uid,
    email: user.email,
    displayName: user.displayName,
    role: user.role,
    tenantId: user.tenantId,
    subscriptionActive: user.role === 'super_admin' || user.role !== null,
  };
}
