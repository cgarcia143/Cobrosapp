import { DocumentData, Timestamp } from 'firebase/firestore';
import {
  addBogotaDays,
  bogotaDateKey,
  startOfBogotaDay,
} from '../domain/bogota-date';
import type {
  AgendaItem,
  Client,
  Credit,
  CreditEvidence,
  CreditFrequency,
  CreditStatus,
  Installment,
  InstallmentStatus,
  Member,
  Tenant,
  TenantStatus,
  TenantType,
  UserRole,
} from '../domain/models';

export function readString(data: DocumentData, key: string): string {
  const value = data[key];
  return typeof value === 'string' ? value : '';
}

export function readNumber(data: DocumentData, key: string): number {
  const value = data[key];
  return typeof value === 'number' && Number.isFinite(value) ? value : 0;
}

export function readBoolean(data: DocumentData, key: string): boolean {
  return data[key] === true;
}

export function readDate(data: DocumentData, key: string): Date | null {
  const value = data[key];
  if (value instanceof Timestamp) {
    return value.toDate();
  }
  return null;
}

export function mapTenant(id: string, data: DocumentData): Tenant {
  const subscription = isRecord(data['subscription']) ? data['subscription'] : {};
  const status = readTenantStatus(data['status']);
  const type = data['type'] === 'independiente' ? 'independiente' : 'oficina';
  return {
    id,
    name: readString(data, 'name'),
    type,
    status,
    ownerUid: readString(data, 'ownerUid'),
    capitalCop: readNumber(data, 'capitalCop'),
    phone: readString(data, 'phone'),
    city: readString(data, 'city'),
    subscription: {
      plan: subscription['plan'] === 'independiente' ? 'independiente' : 'oficina',
      cycle: subscription['cycle'] === 'anual' ? 'anual' : 'mensual',
      amountCop: typeof subscription['amountCop'] === 'number' ? subscription['amountCop'] : 0,
      nextDue: subscription['nextDue'] instanceof Timestamp ? subscription['nextDue'].toDate() : new Date(),
      lastPaymentAt:
        subscription['lastPaymentAt'] instanceof Timestamp ? subscription['lastPaymentAt'].toDate() : null,
    },
  };
}

export function mapMember(id: string, data: DocumentData): Member {
  return {
    uid: id,
    displayName: readString(data, 'displayName'),
    email: readString(data, 'email'),
    role: readMemberRole(data['role']),
    active: data['active'] !== false,
    phone: readString(data, 'phone'),
  };
}

export function mapClient(id: string, data: DocumentData): Client {
  return {
    id,
    fullName: readString(data, 'fullName'),
    documentNumber: readString(data, 'documentNumber'),
    phone: readString(data, 'phone'),
    address: readString(data, 'address'),
    neighborhood: readString(data, 'neighborhood'),
    notes: readString(data, 'notes'),
    collectorUid: readString(data, 'collectorUid'),
    routeOrder: readNumber(data, 'routeOrder'),
    active: data['active'] !== false,
  };
}

export function mapCredit(id: string, data: DocumentData): Credit {
  return {
    id,
    clientId: readString(data, 'clientId'),
    clientName: readString(data, 'clientName'),
    clientPhone: readString(data, 'clientPhone'),
    clientAddress: readString(data, 'clientAddress'),
    collectorUid: readString(data, 'collectorUid'),
    routeOrder: readNumber(data, 'routeOrder'),
    principalCop: readNumber(data, 'principalCop'),
    interestRatePercent: readNumber(data, 'interestRatePercent'),
    interestCop: readNumber(data, 'interestCop'),
    totalToCollectCop: readNumber(data, 'totalToCollectCop'),
    paidCop: readNumber(data, 'paidCop'),
    balanceCop: readNumber(data, 'balanceCop'),
    frequency: readFrequency(data['frequency']),
    installmentsCount: readNumber(data, 'installmentsCount'),
    installmentAmountCop: readNumber(data, 'installmentAmountCop'),
    startDate: readDate(data, 'startDate') ?? new Date(0),
    nextDueDate: readDate(data, 'nextDueDate'),
    nextInstallmentId: optionalString(data['nextInstallmentId']),
    nextInstallmentNumber: optionalNumber(data['nextInstallmentNumber']),
    nextInstallmentAmountCop: optionalNumber(data['nextInstallmentAmountCop']),
    lastPaymentDate: optionalString(data['lastPaymentDate']),
    status: readCreditStatus(data['status']),
    evidence: readEvidence(data),
  };
}

export function mapInstallment(id: string, data: DocumentData): Installment {
  const paymentIds = data['paymentIds'];
  return {
    id,
    number: readNumber(data, 'number'),
    dueDate: readDate(data, 'dueDate') ?? new Date(0),
    amountCop: readNumber(data, 'amountCop'),
    paidCop: readNumber(data, 'paidCop'),
    status: readInstallmentStatus(data['status']),
    paidAt: readDate(data, 'paidAt'),
    paymentIds: Array.isArray(paymentIds)
      ? paymentIds.filter((item): item is string => typeof item === 'string')
      : [],
    collectorUid: readString(data, 'collectorUid'),
    creditId: readString(data, 'creditId'),
    clientId: readString(data, 'clientId'),
  };
}

export function toAgendaItem(credit: Credit, today: Date): AgendaItem {
  const todayStart = startOfBogotaDay(today);
  const tomorrow = addBogotaDays(todayStart, 1);
  const paidToday = credit.lastPaymentDate === bogotaDateKey(todayStart);
  const due = credit.nextDueDate;
  let status: AgendaItem['status'] = 'pendiente';

  if (credit.status === 'pagado' || (paidToday && (!due || due.getTime() >= tomorrow.getTime()))) {
    status = 'pagado';
  } else if ((due && due.getTime() < todayStart.getTime()) || credit.status === 'en_mora') {
    status = 'en_mora';
  }

  return {
    creditId: credit.id,
    clientId: credit.clientId,
    clientName: credit.clientName,
    clientPhone: credit.clientPhone,
    clientAddress: credit.clientAddress,
    collectorUid: credit.collectorUid,
    routeOrder: credit.routeOrder,
    frequency: credit.frequency,
    installmentNumber: credit.nextInstallmentNumber,
    installmentsCount: credit.installmentsCount,
    amountDueCop: credit.nextInstallmentAmountCop ?? 0,
    balanceCop: credit.balanceCop,
    dueDate: due,
    status,
  };
}

function readEvidence(data: DocumentData): CreditEvidence {
  const value = data['evidence'];
  if (!isRecord(value)) {
    return { documentUrls: [], acceptanceVideoUrl: null };
  }
  const urls = value['documentUrls'];
  const video = value['acceptanceVideoUrl'];
  return {
    documentUrls: Array.isArray(urls) ? urls.filter((item): item is string => typeof item === 'string') : [],
    acceptanceVideoUrl: typeof video === 'string' ? video : null,
  };
}

function readFrequency(value: unknown): CreditFrequency {
  if (value === 'diario' || value === 'semanal' || value === 'quincenal' || value === 'mensual') {
    return value;
  }
  return 'semanal';
}

function readCreditStatus(value: unknown): CreditStatus {
  if (value === 'activo' || value === 'pagado' || value === 'en_mora' || value === 'cancelado') {
    return value;
  }
  return 'activo';
}

function readInstallmentStatus(value: unknown): InstallmentStatus {
  if (value === 'pendiente' || value === 'parcial' || value === 'pagado' || value === 'en_mora') {
    return value;
  }
  return 'pendiente';
}

function readTenantStatus(value: unknown): TenantStatus {
  if (value === 'trial' || value === 'activo' || value === 'suspendido') {
    return value;
  }
  return 'trial';
}

function readMemberRole(value: unknown): Member['role'] {
  if (value === 'oficina_admin' || value === 'cobrador' || value === 'independiente') {
    return value;
  }
  return 'cobrador';
}

function optionalString(value: unknown): string | null {
  return typeof value === 'string' && value.length > 0 ? value : null;
}

function optionalNumber(value: unknown): number | null {
  return typeof value === 'number' && Number.isFinite(value) ? value : null;
}

function isRecord(value: unknown): value is DocumentData {
  return typeof value === 'object' && value !== null;
}

export function isUserRole(value: unknown): value is UserRole {
  return (
    value === 'super_admin' ||
    value === 'oficina_admin' ||
    value === 'cobrador' ||
    value === 'independiente'
  );
}

export function isTenantType(value: unknown): value is TenantType {
  return value === 'oficina' || value === 'independiente';
}
