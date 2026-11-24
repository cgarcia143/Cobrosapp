export type UserRole = 'super_admin' | 'oficina_admin' | 'cobrador' | 'independiente';

export type TenantType = 'oficina' | 'independiente';

export type TenantStatus = 'trial' | 'activo' | 'suspendido';

export type BillingCycle = 'mensual' | 'anual';

export type CreditFrequency = 'diario' | 'semanal' | 'quincenal' | 'mensual';

export type CreditStatus = 'activo' | 'pagado' | 'en_mora' | 'cancelado';

export type InstallmentStatus = 'pendiente' | 'parcial' | 'pagado' | 'en_mora';

export type AgendaStatus = 'pendiente' | 'pagado' | 'en_mora';

export type PaymentMethod = 'efectivo' | 'transferencia';

export interface AppSession {
  uid: string;
  email: string | null;
  displayName: string | null;
  role: UserRole | null;
  tenantId: string | null;
  subscriptionActive: boolean;
}

export interface TenantSubscription {
  plan: TenantType;
  cycle: BillingCycle;
  amountCop: number;
  nextDue: Date;
  lastPaymentAt: Date | null;
}

export interface Tenant {
  id: string;
  name: string;
  type: TenantType;
  status: TenantStatus;
  ownerUid: string;
  capitalCop: number;
  phone: string;
  city: string;
  subscription: TenantSubscription;
}

export interface Member {
  uid: string;
  displayName: string;
  email: string;
  role: Exclude<UserRole, 'super_admin'>;
  active: boolean;
  phone: string;
}

export interface Client {
  id: string;
  fullName: string;
  documentNumber: string;
  phone: string;
  address: string;
  neighborhood: string;
  notes: string;
  collectorUid: string;
  routeOrder: number;
  active: boolean;
}

export interface CreditEvidence {
  documentUrls: string[];
  acceptanceVideoUrl: string | null;
}

export interface Credit {
  id: string;
  clientId: string;
  clientName: string;
  clientPhone: string;
  clientAddress: string;
  collectorUid: string;
  routeOrder: number;
  principalCop: number;
  interestRatePercent: number;
  interestCop: number;
  totalToCollectCop: number;
  paidCop: number;
  balanceCop: number;
  frequency: CreditFrequency;
  installmentsCount: number;
  installmentAmountCop: number;
  startDate: Date;
  nextDueDate: Date | null;
  nextInstallmentId: string | null;
  nextInstallmentNumber: number | null;
  nextInstallmentAmountCop: number | null;
  lastPaymentDate: string | null;
  status: CreditStatus;
  evidence: CreditEvidence;
}

export interface Installment {
  id: string;
  number: number;
  dueDate: Date;
  amountCop: number;
  paidCop: number;
  status: InstallmentStatus;
  paidAt: Date | null;
  paymentIds: string[];
  collectorUid: string;
  creditId: string;
  clientId: string;
}

export interface AgendaItem {
  creditId: string;
  clientId: string;
  clientName: string;
  clientPhone: string;
  clientAddress: string;
  collectorUid: string;
  routeOrder: number;
  frequency: CreditFrequency;
  installmentNumber: number | null;
  installmentsCount: number;
  amountDueCop: number;
  balanceCop: number;
  dueDate: Date | null;
  status: AgendaStatus;
}

export interface AgendaSnapshot {
  items: AgendaItem[];
  fromCache: boolean;
  hasPendingWrites: boolean;
}

export interface PaymentReceipt {
  businessName: string;
  receiptNumber: string;
  paidAt: Date;
  collectorName: string;
  clientName: string;
  creditId: string;
  installmentLabel: string;
  amountCop: number;
  balanceCop: number;
  method: PaymentMethod;
}

export interface MonthlyReport {
  monthKey: string;
  capitalPrestadoCop: number;
  gananciasCop: number;
  carteraVencidaCop: number;
  capitalEnCalleCop: number;
  pagosDelMesCop: number;
  fromCache: boolean;
}

export const PLATFORM_OWNER_EMAIL = 'arkatech@gmail.com';

export const MANAGER_ROLES: readonly UserRole[] = ['oficina_admin', 'independiente'];

export function isTenantBlocked(tenant: Tenant | null | undefined): boolean {
  if (!tenant) {
    return false;
  }
  return tenant.status === 'suspendido' || tenant.subscription.nextDue.getTime() <= Date.now();
}

export function isManagerRole(role: UserRole | null): boolean {
  return role === 'oficina_admin' || role === 'independiente';
}
