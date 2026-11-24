import { initializeApp } from 'firebase-admin/app';
import { getAuth } from 'firebase-admin/auth';
import { FieldValue, Timestamp, getFirestore } from 'firebase-admin/firestore';
import { HttpsError, onCall } from 'firebase-functions/v2/https';
import { onSchedule } from 'firebase-functions/v2/scheduler';

initializeApp();

const REGION = 'southamerica-east1';

type StaffRole = 'oficina_admin' | 'cobrador' | 'independiente';
type TenantType = 'oficina' | 'independiente';
type BillingCycle = 'mensual' | 'anual';

interface AuthToken {
  uid: string;
  token: Record<string, unknown>;
}

export const createTenant = onCall({ region: REGION }, async (request) => {
  const auth = requireSuper(request.auth);
  const name = readText(request.data, 'name', 80);
  const type = readChoice<TenantType>(request.data, 'type', ['oficina', 'independiente']);
  const ownerEmail = readText(request.data, 'ownerEmail', 120).toLowerCase();
  const city = readOptionalText(request.data, 'city', 80);
  const capitalCop = readCop(request.data, 'capitalCop', true);
  const cycle = readChoice<BillingCycle>(request.data, 'cycle', ['mensual', 'anual']);
  const amountCop = readCop(request.data, 'amountCop', true);
  const owner = await getAuth().getUserByEmail(ownerEmail);
  assertTenantAvailable(owner.customClaims, null);

  const role: StaffRole = type === 'oficina' ? 'oficina_admin' : 'independiente';
  const db = getFirestore();
  const tenantRef = db.collection('tenants').doc();
  const nextDue = Timestamp.fromDate(addDays(new Date(), 15));

  await tenantRef.set({
    name,
    type,
    status: 'trial',
    ownerUid: owner.uid,
    capitalCop,
    phone: '',
    city,
    subscription: {
      plan: type,
      cycle,
      amountCop,
      nextDue,
      lastPaymentAt: null,
    },
    createdAt: FieldValue.serverTimestamp(),
    updatedAt: FieldValue.serverTimestamp(),
    createdBy: auth.uid,
  });
  await tenantRef.collection('members').doc(owner.uid).set({
    displayName: owner.displayName || ownerEmail,
    email: ownerEmail,
    role,
    active: true,
    phone: '',
    updatedAt: FieldValue.serverTimestamp(),
  });
  await applyClaims(owner.uid, role, tenantRef.id, true);
  return { tenantId: tenantRef.id };
});

export const setTenantAccess = onCall({ region: REGION }, async (request) => {
  requireSuper(request.auth);
  const tenantId = readText(request.data, 'tenantId', 80);
  const status = readChoice<'activo' | 'suspendido'>(request.data, 'status', ['activo', 'suspendido']);
  const db = getFirestore();
  const tenantRef = db.collection('tenants').doc(tenantId);
  const tenant = await tenantRef.get();
  if (!tenant.exists) {
    throw new HttpsError('not-found', 'La sede no existe.');
  }
  await tenantRef.update({
    status,
    updatedAt: FieldValue.serverTimestamp(),
  });
  await syncMemberClaims(tenantId, status !== 'suspendido');
  return { tenantId, status };
});

export const registerSubscriptionPayment = onCall({ region: REGION }, async (request) => {
  requireSuper(request.auth);
  const tenantId = readText(request.data, 'tenantId', 80);
  const amountCop = readCop(request.data, 'amountCop', false);
  const db = getFirestore();
  const tenantRef = db.collection('tenants').doc(tenantId);
  const tenant = await tenantRef.get();
  if (!tenant.exists) {
    throw new HttpsError('not-found', 'La sede no existe.');
  }
  const subscription = tenant.get('subscription') as { cycle?: BillingCycle; nextDue?: Timestamp } | undefined;
  const cycle: BillingCycle = subscription?.cycle === 'anual' ? 'anual' : 'mensual';
  const currentDue = subscription?.nextDue?.toDate() ?? new Date();
  const base = currentDue.getTime() > Date.now() ? currentDue : new Date();
  const nextDue = addCycle(base, cycle);
  await tenantRef.update({
    status: 'activo',
    'subscription.nextDue': Timestamp.fromDate(nextDue),
    'subscription.lastPaymentAt': FieldValue.serverTimestamp(),
    'subscription.amountCop': amountCop,
    updatedAt: FieldValue.serverTimestamp(),
  });
  await db.collection(`tenants/${tenantId}/billingPayments`).add({
    amountCop,
    cycle,
    nextDue: Timestamp.fromDate(nextDue),
    createdAt: FieldValue.serverTimestamp(),
  });
  await syncMemberClaims(tenantId, true);
  return { tenantId, nextDue: nextDue.toISOString() };
});

export const inviteCollector = onCall({ region: REGION }, async (request) => {
  const auth = requireOfficeAdmin(request.auth);
  const tenantId = readText(request.data, 'tenantId', 80);
  if (auth.token['tenantId'] !== tenantId) {
    throw new HttpsError('permission-denied', 'Solo puedes vincular cobradores de tu sede.');
  }
  const email = readText(request.data, 'email', 120).toLowerCase();
  const displayName = readText(request.data, 'displayName', 80);
  const phone = readOptionalText(request.data, 'phone', 30);
  const db = getFirestore();
  const tenant = await db.collection('tenants').doc(tenantId).get();
  if (!tenant.exists) {
    throw new HttpsError('not-found', 'La sede no existe.');
  }
  if (tenant.get('type') !== 'oficina') {
    throw new HttpsError('failed-precondition', 'Un independiente no administra cobradores.');
  }
  if (tenant.get('status') === 'suspendido') {
    throw new HttpsError('failed-precondition', 'La sede está suspendida.');
  }
  const user = await getAuth().getUserByEmail(email);
  assertTenantAvailable(user.customClaims, tenantId);
  await db.collection(`tenants/${tenantId}/members`).doc(user.uid).set({
    displayName,
    email,
    role: 'cobrador',
    active: true,
    phone,
    updatedAt: FieldValue.serverTimestamp(),
  });
  await applyClaims(user.uid, 'cobrador', tenantId, true);
  return { uid: user.uid };
});

export const enforceSubscriptions = onSchedule(
  { schedule: '10 0 * * *', timeZone: 'America/Bogota', region: REGION },
  async () => {
    const db = getFirestore();
    const overdue = await db
      .collection('tenants')
      .where('status', 'in', ['activo', 'trial'])
      .where('subscription.nextDue', '<', Timestamp.now())
      .get();

    for (const tenant of overdue.docs) {
      await tenant.ref.update({
        status: 'suspendido',
        updatedAt: FieldValue.serverTimestamp(),
      });
      await syncMemberClaims(tenant.id, false);
    }
  },
);

async function syncMemberClaims(tenantId: string, subscriptionActive: boolean): Promise<void> {
  const members = await getFirestore().collection(`tenants/${tenantId}/members`).get();
  await Promise.all(
    members.docs.map(async (member) => {
      const role = member.get('role');
      if (role !== 'oficina_admin' && role !== 'cobrador' && role !== 'independiente') {
        return;
      }
      const active = member.get('active') !== false && subscriptionActive;
      await applyClaims(member.id, role, tenantId, active);
    }),
  );
}

async function applyClaims(
  uid: string,
  role: StaffRole,
  tenantId: string,
  subscriptionActive: boolean,
): Promise<void> {
  const auth = getAuth();
  await auth.setCustomUserClaims(uid, { role, tenantId, subscriptionActive });
  await auth.revokeRefreshTokens(uid);
}

function requireSuper(auth: { uid: string; token: Record<string, unknown> } | undefined): AuthToken {
  if (!auth) {
    throw new HttpsError('unauthenticated', 'Debes iniciar sesión.');
  }
  if (auth.token['role'] !== 'super_admin') {
    throw new HttpsError('permission-denied', 'Solo el super administrador puede hacer esto.');
  }
  return auth;
}

function requireOfficeAdmin(auth: { uid: string; token: Record<string, unknown> } | undefined): AuthToken {
  if (!auth) {
    throw new HttpsError('unauthenticated', 'Debes iniciar sesión.');
  }
  if (auth.token['role'] !== 'oficina_admin' || typeof auth.token['tenantId'] !== 'string') {
    throw new HttpsError('permission-denied', 'Solo el administrador de la oficina puede hacer esto.');
  }
  return auth;
}

function assertTenantAvailable(claims: { [key: string]: unknown } | undefined, tenantId: string | null): void {
  const current = claims?.['tenantId'];
  if (typeof current === 'string' && current.length > 0 && current !== tenantId) {
    throw new HttpsError('failed-precondition', 'Ese usuario ya pertenece a otra sede.');
  }
}

function readText(data: unknown, key: string, max: number): string {
  const value = readRecord(data)[key];
  if (typeof value !== 'string' || value.trim().length === 0 || value.trim().length > max) {
    throw new HttpsError('invalid-argument', `Revisa el campo ${key}.`);
  }
  return value.trim();
}

function readOptionalText(data: unknown, key: string, max: number): string {
  const value = readRecord(data)[key];
  if (value == null || value === '') {
    return '';
  }
  if (typeof value !== 'string' || value.trim().length > max) {
    throw new HttpsError('invalid-argument', `Revisa el campo ${key}.`);
  }
  return value.trim();
}

function readChoice<T extends string>(data: unknown, key: string, allowed: readonly T[]): T {
  const value = readRecord(data)[key];
  if (typeof value === 'string' && allowed.includes(value as T)) {
    return value as T;
  }
  throw new HttpsError('invalid-argument', `Revisa el campo ${key}.`);
}

function readCop(data: unknown, key: string, allowZero: boolean): number {
  const value = readRecord(data)[key];
  if (typeof value !== 'number' || !Number.isInteger(value) || value < 0 || (!allowZero && value <= 0)) {
    throw new HttpsError('invalid-argument', `${key} debe ser un entero en pesos colombianos.`);
  }
  return value;
}

function readRecord(data: unknown): Record<string, unknown> {
  if (!data || typeof data !== 'object') {
    throw new HttpsError('invalid-argument', 'La solicitud no tiene datos.');
  }
  return data as Record<string, unknown>;
}

function addDays(date: Date, days: number): Date {
  return new Date(date.getTime() + days * 86_400_000);
}

function addCycle(date: Date, cycle: BillingCycle): Date {
  const next = new Date(date.getTime());
  next.setUTCMonth(next.getUTCMonth() + (cycle === 'anual' ? 12 : 1));
  return next;
}
