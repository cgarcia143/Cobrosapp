import { addBogotaMonths, startOfBogotaDay } from '../domain/bogota-date';
import { buildCreditSchedule } from '../domain/credit-schedule';
import type { Client, Credit, Installment, PaymentRecord, StoredUser, Tenant } from '../domain/models';

const DB_NAME = 'cobranzas-local';
const DB_VERSION = 1;

type StoreName = 'users' | 'tenants' | 'clients' | 'credits' | 'installments' | 'payments';

let databasePromise: Promise<IDBDatabase> | null = null;

function requestToPromise<T>(request: IDBRequest<T>): Promise<T> {
  return new Promise((resolve, reject) => {
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error ?? new Error('Error de IndexedDB.'));
  });
}

function transactionDone(transaction: IDBTransaction): Promise<void> {
  return new Promise((resolve, reject) => {
    transaction.oncomplete = () => resolve();
    transaction.onerror = () => reject(transaction.error ?? new Error('No se pudo guardar.'));
    transaction.onabort = () => reject(transaction.error ?? new Error('La operación se canceló.'));
  });
}

function openDatabase(): Promise<IDBDatabase> {
  databasePromise ??= new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, DB_VERSION);
    request.onupgradeneeded = () => {
      const db = request.result;
      if (!db.objectStoreNames.contains('users')) {
        const users = db.createObjectStore('users', { keyPath: 'uid' });
        users.createIndex('email', 'email', { unique: true });
      }
      if (!db.objectStoreNames.contains('tenants')) {
        db.createObjectStore('tenants', { keyPath: 'id' });
      }
      if (!db.objectStoreNames.contains('clients')) {
        const clients = db.createObjectStore('clients', { keyPath: 'id' });
        clients.createIndex('tenantId', 'tenantId');
      }
      if (!db.objectStoreNames.contains('credits')) {
        const credits = db.createObjectStore('credits', { keyPath: 'id' });
        credits.createIndex('tenantId', 'tenantId');
      }
      if (!db.objectStoreNames.contains('installments')) {
        const installments = db.createObjectStore('installments', { keyPath: 'id' });
        installments.createIndex('creditId', 'creditId');
      }
      if (!db.objectStoreNames.contains('payments')) {
        const payments = db.createObjectStore('payments', { keyPath: 'id' });
        payments.createIndex('tenantId', 'tenantId');
      }
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error ?? new Error('No se pudo abrir la base local.'));
  });
  return databasePromise;
}

async function readAll<T>(store: StoreName): Promise<T[]> {
  const db = await openDatabase();
  const transaction = db.transaction(store, 'readonly');
  const result = await requestToPromise(transaction.objectStore(store).getAll() as IDBRequest<T[]>);
  await transactionDone(transaction);
  return result;
}

async function readByIndex<T>(store: StoreName, indexName: string, value: IDBValidKey): Promise<T[]> {
  const db = await openDatabase();
  const transaction = db.transaction(store, 'readonly');
  const result = await requestToPromise(
    transaction.objectStore(store).index(indexName).getAll(value) as IDBRequest<T[]>,
  );
  await transactionDone(transaction);
  return result;
}

async function readOne<T>(store: StoreName, key: IDBValidKey): Promise<T | null> {
  const db = await openDatabase();
  const transaction = db.transaction(store, 'readonly');
  const result = await requestToPromise(transaction.objectStore(store).get(key) as IDBRequest<T | undefined>);
  await transactionDone(transaction);
  return result ?? null;
}

async function writeOne(store: StoreName, value: unknown): Promise<void> {
  const db = await openDatabase();
  const transaction = db.transaction(store, 'readwrite');
  transaction.objectStore(store).put(value);
  await transactionDone(transaction);
}

export async function sha256(text: string): Promise<string> {
  const data = new TextEncoder().encode(text);
  const digest = await crypto.subtle.digest('SHA-256', data);
  return [...new Uint8Array(digest)].map((byte) => byte.toString(16).padStart(2, '0')).join('');
}

export const localDb = {
  ready: openDatabase,

  users: () => readAll<StoredUser>('users'),
  user: (uid: string) => readOne<StoredUser>('users', uid),
  async userByEmail(email: string): Promise<StoredUser | null> {
    const rows = await readByIndex<StoredUser>('users', 'email', email);
    return rows[0] ?? null;
  },
  saveUser: (user: StoredUser) => writeOne('users', user),

  tenants: () => readAll<Tenant>('tenants'),
  tenant: (id: string) => readOne<Tenant>('tenants', id),
  saveTenant: (tenant: Tenant) => writeOne('tenants', tenant),

  clients: (tenantId: string) => readByIndex<Client>('clients', 'tenantId', tenantId),
  saveClient: (client: Client) => writeOne('clients', client),

  credits: (tenantId: string) => readByIndex<Credit>('credits', 'tenantId', tenantId),
  credit: (id: string) => readOne<Credit>('credits', id),
  saveCredit: (credit: Credit) => writeOne('credits', credit),

  installments: (creditId: string) => readByIndex<Installment>('installments', 'creditId', creditId),
  payments: (tenantId: string) => readByIndex<PaymentRecord>('payments', 'tenantId', tenantId),

  async saveCreditBundle(credit: Credit, installments: Installment[]): Promise<void> {
    const db = await openDatabase();
    const transaction = db.transaction(['credits', 'installments'], 'readwrite');
    transaction.objectStore('credits').put(credit);
    const installmentStore = transaction.objectStore('installments');
    for (const installment of installments) {
      installmentStore.put(installment);
    }
    await transactionDone(transaction);
  },

  async savePaymentBundle(payment: PaymentRecord, installment: Installment, credit: Credit): Promise<void> {
    const db = await openDatabase();
    const transaction = db.transaction(['payments', 'installments', 'credits'], 'readwrite');
    transaction.objectStore('payments').put(payment);
    transaction.objectStore('installments').put(installment);
    transaction.objectStore('credits').put(credit);
    await transactionDone(transaction);
  },
};

export async function seedLocalData(): Promise<void> {
  const existing = await localDb.users();
  if (existing.length > 0) {
    return;
  }

  const [adminHash, officeHash, collectorHash] = await Promise.all([
    sha256('Admin1234'),
    sha256('Oficina123'),
    sha256('Ruta123'),
  ]);

  const now = new Date();
  const tenantId = 'sede-local';
  const admin: StoredUser = {
    uid: 'admin-local',
    email: 'oficina@local.app',
    displayName: 'Ana Oficina',
    phone: '3000000001',
    passwordHash: officeHash,
    role: 'oficina_admin',
    tenantId,
    active: true,
  };
  const collector: StoredUser = {
    uid: 'cobrador-local',
    email: 'cobrador@local.app',
    displayName: 'Luis Cobrador',
    phone: '3000000002',
    passwordHash: collectorHash,
    role: 'cobrador',
    tenantId,
    active: true,
  };
  const superAdmin: StoredUser = {
    uid: 'super-local',
    email: 'arkatech@gmail.com',
    displayName: 'Plataforma',
    phone: '',
    passwordHash: adminHash,
    role: 'super_admin',
    tenantId: null,
    active: true,
  };

  const tenant: Tenant = {
    id: tenantId,
    name: 'Oficina local',
    type: 'oficina',
    status: 'activo',
    ownerUid: admin.uid,
    capitalCop: 5_000_000,
    phone: '6010000000',
    city: 'Bogotá',
    subscription: {
      plan: 'oficina',
      cycle: 'mensual',
      amountCop: 0,
      nextDue: addBogotaMonths(now, 12),
      lastPaymentAt: now,
    },
  };

  const client: Client = {
    id: 'cliente-demo',
    tenantId,
    fullName: 'María Pérez',
    documentNumber: '1020304050',
    phone: '3105550101',
    address: 'Calle 10 # 20-30',
    neighborhood: 'Centro',
    notes: 'Cliente de ejemplo guardado en el teléfono.',
    collectorUid: collector.uid,
    routeOrder: 1,
    active: true,
  };

  const schedule = buildCreditSchedule({
    principalCop: 100_000,
    interestRatePercent: 20,
    installmentsCount: 4,
    frequency: 'semanal',
    startDate: now,
  });
  const todayStart = startOfBogotaDay(now);
  const first = schedule.installments[0];
  if (!first) {
    throw new Error('No se pudo crear el crédito de ejemplo.');
  }
  const credit: Credit = {
    id: 'credito-demo',
    tenantId,
    clientId: client.id,
    clientName: client.fullName,
    clientPhone: client.phone,
    clientAddress: client.address,
    collectorUid: client.collectorUid,
    routeOrder: client.routeOrder,
    principalCop: 100_000,
    interestRatePercent: 20,
    interestCop: schedule.interestCop,
    totalToCollectCop: schedule.totalToCollectCop,
    paidCop: 0,
    balanceCop: schedule.totalToCollectCop,
    frequency: 'semanal',
    installmentsCount: schedule.installments.length,
    installmentAmountCop: schedule.installmentAmountCop,
    startDate: first.dueDate,
    nextDueDate: first.dueDate,
    nextInstallmentId: first.id,
    nextInstallmentNumber: first.number,
    nextInstallmentAmountCop: first.amountCop,
    lastPaymentDate: null,
    status: first.dueDate.getTime() < todayStart.getTime() ? 'en_mora' : 'activo',
    evidence: { documentUrls: [], acceptanceVideoUrl: null },
    createdAt: now,
  };
  const installments: Installment[] = schedule.installments.map((item) => ({
    id: `${credit.id}:${item.id}`,
    number: item.number,
    dueDate: item.dueDate,
    amountCop: item.amountCop,
    paidCop: 0,
    status: item.dueDate.getTime() < todayStart.getTime() ? 'en_mora' : 'pendiente',
    paidAt: null,
    paymentIds: [],
    collectorUid: client.collectorUid,
    creditId: credit.id,
    clientId: client.id,
  }));

  await localDb.saveUser(superAdmin);
  await localDb.saveUser(admin);
  await localDb.saveUser(collector);
  await localDb.saveTenant(tenant);
  await localDb.saveClient(client);
  await localDb.saveCreditBundle(credit, installments);
}
