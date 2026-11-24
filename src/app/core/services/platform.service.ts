import { Injectable, inject } from '@angular/core';
import { FirebaseError, deleteApp, initializeApp } from 'firebase/app';
import {
  createUserWithEmailAndPassword,
  getAuth,
  signInWithEmailAndPassword,
  signOut,
} from 'firebase/auth';
import {
  DocumentData,
  Timestamp,
  WriteBatch,
  collection,
  doc,
  getDoc,
  onSnapshot,
  orderBy,
  query,
  serverTimestamp,
  setDoc,
  updateDoc,
  writeBatch,
} from 'firebase/firestore';
import { environment } from '../../../environments/environment';
import type { BillingCycle, Tenant, TenantType, UserRole } from '../domain/models';
import { PLATFORM_OWNER_EMAIL } from '../domain/models';
import { assertCopInteger } from '../domain/money';
import { FIREBASE_AUTH, FIRESTORE } from '../firebase/firebase-providers';
import { isUserRole, mapTenant } from '../firestore/mappers';

export interface CreateTenantInput {
  name: string;
  type: TenantType;
  city: string;
  phone: string;
  capitalCop: number;
  cycle: BillingCycle;
  amountCop: number;
}

export interface InviteMemberInput {
  tenantId: string;
  email: string;
  displayName: string;
  phone: string;
}

export interface PlatformUser {
  uid: string;
  email: string;
  displayName: string;
  phone: string;
  role: UserRole | null;
  tenantId: string | null;
  active: boolean;
}

export interface SavePlatformUser {
  uid: string | null;
  email: string;
  displayName: string;
  phone: string;
  password: string;
  role: UserRole | null;
  tenantId: string | null;
  active: boolean;
}

export interface TenantProfileInput {
  name: string;
  city: string;
  phone: string;
  capitalCop: number;
}

interface AccountProfile {
  uid: string;
  email: string;
  displayName: string;
  role: UserRole | null;
  tenantId: string | null;
}

@Injectable({ providedIn: 'root' })
export class PlatformService {
  private readonly firestore = inject(FIRESTORE);
  private readonly auth = inject(FIREBASE_AUTH);

  watchTenants(onData: (tenants: Tenant[]) => void, onError: (error: Error) => void): () => void {
    const tenantsQuery = query(collection(this.firestore, 'tenants'), orderBy('name'));
    return onSnapshot(
      tenantsQuery,
      (snapshot) => onData(snapshot.docs.map((item) => mapTenant(item.id, item.data()))),
      (error) => onError(error),
    );
  }

  watchUsers(onData: (users: PlatformUser[]) => void, onError: (error: Error) => void): () => void {
    const usersQuery = query(collection(this.firestore, 'users'), orderBy('displayName'));
    return onSnapshot(
      usersQuery,
      (snapshot) => onData(snapshot.docs.map((item) => mapPlatformUser(item.id, item.data()))),
      (error) => onError(error),
    );
  }

  async saveUser(input: SavePlatformUser): Promise<void> {
    const email = input.email.trim().toLowerCase();
    const displayName = input.displayName.trim();
    const phone = input.phone.trim();
    if (!displayName || !email) {
      throw new Error('Nombre y correo son obligatorios.');
    }
    const role = input.role;
    const needsTenant = role === 'oficina_admin' || role === 'independiente' || role === 'cobrador';
    const tenantId = needsTenant ? input.tenantId : null;
    if (needsTenant && !tenantId) {
      throw new Error('Asigna una sede para ese rol.');
    }
    if (email === PLATFORM_OWNER_EMAIL && role !== 'super_admin') {
      throw new Error('La cuenta principal de la plataforma sigue siendo super administrador.');
    }
    if (input.uid && input.uid === this.auth.currentUser?.uid && role !== 'super_admin') {
      throw new Error('No puedes quitarte el rol de super administrador.');
    }
    if (tenantId && role) {
      await this.assertRoleFitsTenant(role, tenantId);
    }

    const resolved = await this.resolveUserId(input.uid, email, input.password);
    const userRef = doc(this.firestore, 'users', resolved.uid);
    const previousSnap = resolved.existed ? await getDoc(userRef) : null;
    const previous = previousSnap?.exists() ? mapPlatformUser(previousSnap.id, previousSnap.data()) : null;
    const storedEmail = previous?.email || email;
    const profile = {
      email: storedEmail,
      displayName,
      phone,
      role,
      tenantId,
      active: input.active,
      updatedAt: serverTimestamp(),
    };

    const batch = writeBatch(this.firestore);
    if (previous) {
      batch.update(userRef, profile);
    } else {
      batch.set(userRef, profile);
      const accountRef = doc(this.firestore, 'accounts', email);
      const accountSnap = await getDoc(accountRef);
      if (!accountSnap.exists()) {
        batch.set(accountRef, { uid: resolved.uid, email: storedEmail });
      }
    }
    if (previous?.tenantId && previous.tenantId !== tenantId) {
      await this.queueMemberActive(batch, previous.tenantId, resolved.uid, false);
    }
    await this.syncSedeOwner(batch, resolved.uid, role, tenantId, previous?.tenantId ?? null);
    const assignsTenant = Boolean(tenantId && role && role !== 'super_admin' && previous);
    if (assignsTenant && tenantId && role) {
      batch.set(doc(this.firestore, `tenants/${tenantId}/members/${resolved.uid}`), {
        displayName,
        email: storedEmail,
        role,
        active: input.active,
        phone,
        updatedAt: serverTimestamp(),
      });
    }
    await batch.commit();

    if (!previous && tenantId && role && role !== 'super_admin') {
      await setDoc(doc(this.firestore, `tenants/${tenantId}/members/${resolved.uid}`), {
        displayName,
        email: storedEmail,
        role,
        active: input.active,
        phone,
        updatedAt: serverTimestamp(),
      });
    }
  }

  async setUserActive(user: PlatformUser, active: boolean): Promise<void> {
    if (user.uid === this.auth.currentUser?.uid && !active) {
      throw new Error('No puedes desactivar tu propio usuario.');
    }
    if (user.email === PLATFORM_OWNER_EMAIL && !active) {
      throw new Error('No puedes desactivar la cuenta principal de la plataforma.');
    }
    const batch = writeBatch(this.firestore);
    batch.update(doc(this.firestore, 'users', user.uid), {
      active,
      updatedAt: serverTimestamp(),
    });
    if (user.tenantId && user.role && user.role !== 'super_admin') {
      await this.queueMemberActive(batch, user.tenantId, user.uid, active);
    }
    await batch.commit();
  }

  async updateTenantProfile(tenantId: string, input: TenantProfileInput): Promise<void> {
    const name = input.name.trim();
    if (!name || name.length > 80) {
      throw new Error('El nombre de la sede es obligatorio y admite hasta 80 caracteres.');
    }
    const capitalCop = assertCopInteger(input.capitalCop, 'El capital');
    if (capitalCop < 0) {
      throw new Error('El capital no puede ser negativo.');
    }
    await updateDoc(doc(this.firestore, 'tenants', tenantId), {
      name,
      city: input.city.trim(),
      phone: input.phone.trim(),
      capitalCop,
      updatedAt: serverTimestamp(),
    });
  }

  async createTenant(input: CreateTenantInput): Promise<void> {
    const name = input.name.trim();
    const city = input.city.trim();
    const phone = input.phone.trim();
    const capitalCop = assertCopInteger(input.capitalCop, 'El capital');
    const amountCop = assertCopInteger(input.amountCop, 'El valor de la suscripción');
    if (!name || name.length > 80) {
      throw new Error('El nombre de la sede es obligatorio y admite hasta 80 caracteres.');
    }
    if (capitalCop < 0 || amountCop < 0) {
      throw new Error('Los valores en pesos no pueden ser negativos.');
    }
    const actorUid = this.auth.currentUser?.uid;
    if (!actorUid) {
      throw new Error('Debes iniciar sesión.');
    }
    const nextDue = Timestamp.fromDate(new Date(Date.now() + 15 * 86_400_000));
    await setDoc(doc(collection(this.firestore, 'tenants')), {
      name,
      type: input.type,
      status: 'trial',
      ownerUid: '',
      capitalCop,
      phone,
      city,
      subscription: {
        plan: input.type,
        cycle: input.cycle,
        amountCop,
        nextDue,
        lastPaymentAt: null,
      },
      createdAt: serverTimestamp(),
      updatedAt: serverTimestamp(),
      createdBy: actorUid,
    });
  }

  async setTenantAccess(tenantId: string, status: 'activo' | 'suspendido'): Promise<void> {
    await updateDoc(doc(this.firestore, 'tenants', tenantId), {
      status,
      updatedAt: serverTimestamp(),
    });
  }

  async registerSubscriptionPayment(tenantId: string, amountCop: number): Promise<void> {
    const amount = assertCopInteger(amountCop, 'El pago');
    if (amount <= 0) {
      throw new Error('El pago de la suscripción debe ser mayor que cero.');
    }
    const tenantRef = doc(this.firestore, 'tenants', tenantId);
    const snapshot = await getDoc(tenantRef);
    if (!snapshot.exists()) {
      throw new Error('La sede no existe.');
    }
    const subscription = isRecord(snapshot.data()['subscription']) ? snapshot.data()['subscription'] : {};
    const cycle: BillingCycle = subscription['cycle'] === 'anual' ? 'anual' : 'mensual';
    const currentDue = subscription['nextDue'] instanceof Timestamp ? subscription['nextDue'].toDate() : new Date();
    const base = currentDue.getTime() > Date.now() ? currentDue : new Date();
    const nextDue = addCycle(base, cycle);
    const batch = writeBatch(this.firestore);
    batch.update(tenantRef, {
      status: 'activo',
      subscription: {
        plan: subscription['plan'] === 'independiente' ? 'independiente' : 'oficina',
        cycle,
        amountCop: amount,
        nextDue: Timestamp.fromDate(nextDue),
        lastPaymentAt: serverTimestamp(),
      },
      updatedAt: serverTimestamp(),
    });
    batch.set(doc(collection(this.firestore, `tenants/${tenantId}/billingPayments`)), {
      amountCop: amount,
      cycle,
      nextDue: Timestamp.fromDate(nextDue),
      createdAt: serverTimestamp(),
    });
    await batch.commit();
  }

  async inviteCollector(input: InviteMemberInput): Promise<void> {
    const account = await this.findAccount(input.email);
    if (account.role === 'super_admin' || account.role === 'oficina_admin' || account.role === 'independiente') {
      throw new Error('Ese usuario ya tiene otro rol.');
    }
    if (account.tenantId && account.tenantId !== input.tenantId) {
      throw new Error('Ese usuario ya pertenece a otra sede.');
    }
    const batch = writeBatch(this.firestore);
    batch.update(doc(this.firestore, `users/${account.uid}`), {
      role: 'cobrador',
      tenantId: input.tenantId,
      active: true,
      displayName: input.displayName.trim(),
      phone: input.phone.trim(),
      updatedAt: serverTimestamp(),
    });
    batch.set(doc(this.firestore, `tenants/${input.tenantId}/members/${account.uid}`), {
      displayName: input.displayName.trim(),
      email: account.email,
      role: 'cobrador',
      active: true,
      phone: input.phone.trim(),
      updatedAt: serverTimestamp(),
    });
    await batch.commit();
  }

  private async assertRoleFitsTenant(role: UserRole, tenantId: string): Promise<void> {
    const tenantSnap = await getDoc(doc(this.firestore, 'tenants', tenantId));
    if (!tenantSnap.exists()) {
      throw new Error('La sede no existe.');
    }
    const type = tenantSnap.data()['type'];
    if (role === 'cobrador' && type !== 'oficina') {
      throw new Error('Un cobrador solo puede pertenecer a una oficina.');
    }
    if (role === 'independiente' && type !== 'independiente') {
      throw new Error('Un independiente solo puede quedar en una sede independiente.');
    }
    if (role === 'oficina_admin' && type !== 'oficina') {
      throw new Error('El administrador de oficina solo puede quedar en una oficina.');
    }
  }

  private async resolveUserId(
    uid: string | null,
    email: string,
    password: string,
  ): Promise<{ uid: string; existed: boolean }> {
    if (uid) {
      return { uid, existed: true };
    }
    const accountSnap = await getDoc(doc(this.firestore, 'accounts', email));
    const existingUid = accountSnap.exists() ? accountSnap.data()['uid'] : null;
    if (typeof existingUid === 'string' && existingUid.length > 0) {
      return { uid: existingUid, existed: true };
    }
    return { uid: await provisionAuthUser(email, password), existed: false };
  }

  private async syncSedeOwner(
    batch: WriteBatch,
    uid: string,
    role: UserRole | null,
    tenantId: string | null,
    previousTenantId: string | null,
  ): Promise<void> {
    const manages = role === 'oficina_admin' || role === 'independiente';
    if (manages && tenantId) {
      batch.update(doc(this.firestore, 'tenants', tenantId), {
        ownerUid: uid,
        updatedAt: serverTimestamp(),
      });
    }
    if (!previousTenantId || (previousTenantId === tenantId && manages)) {
      return;
    }
    const previousTenant = await getDoc(doc(this.firestore, 'tenants', previousTenantId));
    if (previousTenant.exists() && previousTenant.data()['ownerUid'] === uid) {
      batch.update(previousTenant.ref, {
        ownerUid: '',
        updatedAt: serverTimestamp(),
      });
    }
  }

  private async queueMemberActive(batch: WriteBatch, tenantId: string, uid: string, active: boolean): Promise<void> {
    const memberRef = doc(this.firestore, `tenants/${tenantId}/members/${uid}`);
    const member = await getDoc(memberRef);
    if (member.exists()) {
      batch.update(memberRef, { active, updatedAt: serverTimestamp() });
    }
  }

  private async findAccount(email: string): Promise<AccountProfile> {
    const normalized = email.trim().toLowerCase();
    const accountSnap = await getDoc(doc(this.firestore, 'accounts', normalized));
    const uid = accountSnap.exists() ? accountSnap.data()['uid'] : null;
    if (typeof uid !== 'string' || uid.length === 0) {
      throw new Error('Ese correo todavía no tiene cuenta. La persona debe ingresar una vez.');
    }
    const userSnap = await getDoc(doc(this.firestore, 'users', uid));
    if (!userSnap.exists()) {
      throw new Error('Ese correo todavía no tiene cuenta. La persona debe ingresar una vez.');
    }
    const data = userSnap.data();
    const tenantValue = data['tenantId'];
    return {
      uid,
      email: typeof data['email'] === 'string' && data['email'].length > 0 ? data['email'] : normalized,
      displayName: typeof data['displayName'] === 'string' ? data['displayName'] : normalized,
      role: isUserRole(data['role']) ? data['role'] : null,
      tenantId: typeof tenantValue === 'string' && tenantValue.length > 0 ? tenantValue : null,
    };
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

function addCycle(date: Date, cycle: BillingCycle): Date {
  const next = new Date(date.getTime());
  next.setUTCMonth(next.getUTCMonth() + (cycle === 'anual' ? 12 : 1));
  return next;
}

function mapPlatformUser(id: string, data: DocumentData): PlatformUser {
  const tenantValue = data['tenantId'];
  return {
    uid: id,
    email: typeof data['email'] === 'string' ? data['email'] : '',
    displayName: typeof data['displayName'] === 'string' ? data['displayName'] : '',
    phone: typeof data['phone'] === 'string' ? data['phone'] : '',
    role: isUserRole(data['role']) ? data['role'] : null,
    tenantId: typeof tenantValue === 'string' && tenantValue.length > 0 ? tenantValue : null,
    active: data['active'] !== false,
  };
}

async function provisionAuthUser(email: string, password: string): Promise<string> {
  const secret = password.trim();
  if (secret.length < 6) {
    throw new Error('La contraseña debe tener al menos 6 caracteres.');
  }
  const secondary = initializeApp(environment.firebase, `alta-${Date.now()}`);
  const secondaryAuth = getAuth(secondary);
  try {
    try {
      const created = await createUserWithEmailAndPassword(secondaryAuth, email, secret);
      return created.user.uid;
    } catch (error) {
      if (!(error instanceof FirebaseError) || error.code !== 'auth/email-already-in-use') {
        throw error;
      }
      try {
        const existing = await signInWithEmailAndPassword(secondaryAuth, email, secret);
        return existing.user.uid;
      } catch (signInError) {
        if (signInError instanceof FirebaseError && signInError.code === 'auth/invalid-credential') {
          throw new Error('Ese correo ya existe y la contraseña no coincide.');
        }
        throw signInError;
      }
    }
  } finally {
    await signOut(secondaryAuth).catch(() => undefined);
    await deleteApp(secondary);
  }
}
