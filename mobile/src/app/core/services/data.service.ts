import { Injectable, signal } from '@angular/core';
import { buildAgenda } from '../domain/agenda';
import { addBogotaMonths, bogotaDateKey, startOfBogotaDay, startOfBogotaMonth } from '../domain/bogota-date';
import { buildCreditSchedule } from '../domain/credit-schedule';
import { assertCopInteger } from '../domain/money';
import type {
  AgendaItem,
  BillingCycle,
  Client,
  Credit,
  CreditFrequency,
  CreditStatus,
  Installment,
  InstallmentStatus,
  MonthlyReport,
  PaymentMethod,
  PaymentReceipt,
  PaymentRecord,
  StoredUser,
  Tenant,
  TenantType,
  UserRole,
} from '../domain/models';
import { isManagerRole } from '../domain/models';
import { localDb, sha256 } from '../db/local-db';

export interface ClientInput {
  fullName: string;
  documentNumber: string;
  phone: string;
  address: string;
  neighborhood: string;
  notes: string;
  collectorUid: string;
  routeOrder: number;
}

export interface CreditInput {
  actorUid: string;
  actorRole: UserRole;
  client: Client;
  principalCop: number;
  interestRatePercent: number;
  frequency: CreditFrequency;
  installmentsCount: number;
  startDate: Date;
  documents: string[];
  acceptanceVideoUrl: string | null;
}

export interface PaymentInput {
  tenantId: string;
  businessName: string;
  actorUid: string;
  actorName: string;
  actorRole: UserRole;
  creditId: string;
  amountCop: number;
  method: PaymentMethod;
  evidenceDataUrl?: string | null;
}

@Injectable({ providedIn: 'root' })
export class DataService {
  readonly revision = signal(0);

  private touch(): void {
    this.revision.update((value) => value + 1);
  }

  tenant(id: string): Promise<Tenant | null> {
    return localDb.tenant(id);
  }

  tenants(): Promise<Tenant[]> {
    return localDb.tenants();
  }

  users(): Promise<StoredUser[]> {
    return localDb.users();
  }

  async team(tenantId: string): Promise<StoredUser[]> {
    const users = await localDb.users();
    return users
      .filter((user) => user.tenantId === tenantId)
      .sort((left, right) => left.displayName.localeCompare(right.displayName, 'es'));
  }

  async clients(tenantId: string): Promise<Client[]> {
    const clients = await localDb.clients(tenantId);
    return clients
      .filter((client) => client.active)
      .sort((left, right) => left.routeOrder - right.routeOrder || left.fullName.localeCompare(right.fullName, 'es'));
  }

  async agenda(tenantId: string, collectorUid: string | null): Promise<AgendaItem[]> {
    const credits = await localDb.credits(tenantId);
    return buildAgenda(credits, new Date(), collectorUid);
  }

  async saveClient(tenantId: string, actorUid: string, input: ClientInput, clientId?: string): Promise<void> {
    const fullName = input.fullName.trim();
    const documentNumber = input.documentNumber.trim();
    if (fullName.length < 3) {
      throw new Error('El nombre del cliente es muy corto.');
    }
    if (documentNumber.length < 5) {
      throw new Error('El documento del cliente es muy corto.');
    }
    if (!input.collectorUid) {
      throw new Error('Asigna un cobrador.');
    }
    const routeOrder = Math.round(input.routeOrder);
    if (!Number.isInteger(routeOrder) || routeOrder < 1) {
      throw new Error('El orden de ruta debe ser 1 o más.');
    }

    const client: Client = {
      id: clientId ?? crypto.randomUUID(),
      tenantId,
      fullName,
      documentNumber,
      phone: input.phone.trim(),
      address: input.address.trim(),
      neighborhood: input.neighborhood.trim(),
      notes: input.notes.trim(),
      collectorUid: input.collectorUid,
      routeOrder,
      active: true,
    };
    await localDb.saveClient(client);

    if (clientId) {
      const credits = await localDb.credits(tenantId);
      for (const credit of credits.filter((item) => item.clientId === clientId && item.status !== 'pagado')) {
        await localDb.saveCredit({
          ...credit,
          clientName: client.fullName,
          clientPhone: client.phone,
          clientAddress: client.address,
          collectorUid: client.collectorUid,
          routeOrder: client.routeOrder,
        });
      }
    }
    void actorUid;
    this.touch();
  }

  async deactivateClient(tenantId: string, clientId: string): Promise<void> {
    const clients = await localDb.clients(tenantId);
    const client = clients.find((item) => item.id === clientId);
    if (!client) {
      throw new Error('Ese cliente no está en este teléfono.');
    }
    await localDb.saveClient({ ...client, active: false });
    this.touch();
  }

  async createCredit(tenantId: string, input: CreditInput): Promise<string> {
    if (!isManagerRole(input.actorRole)) {
      throw new Error('Solo la oficina o el independiente pueden crear créditos.');
    }
    if (!input.client.active || input.client.tenantId !== tenantId) {
      throw new Error('El cliente está inactivo.');
    }

    const schedule = buildCreditSchedule({
      principalCop: input.principalCop,
      interestRatePercent: input.interestRatePercent,
      installmentsCount: input.installmentsCount,
      frequency: input.frequency,
      startDate: input.startDate,
    });
    const now = new Date();
    const todayStart = startOfBogotaDay(now);
    const first = schedule.installments[0];
    if (!first) {
      throw new Error('El crédito no generó cuotas.');
    }
    const creditId = crypto.randomUUID();
    const creditStatus: CreditStatus = first.dueDate.getTime() < todayStart.getTime() ? 'en_mora' : 'activo';
    const credit: Credit = {
      id: creditId,
      tenantId,
      clientId: input.client.id,
      clientName: input.client.fullName,
      clientPhone: input.client.phone,
      clientAddress: input.client.address,
      collectorUid: input.client.collectorUid,
      routeOrder: input.client.routeOrder,
      principalCop: input.principalCop,
      interestRatePercent: input.interestRatePercent,
      interestCop: schedule.interestCop,
      totalToCollectCop: schedule.totalToCollectCop,
      paidCop: 0,
      balanceCop: schedule.totalToCollectCop,
      frequency: input.frequency,
      installmentsCount: schedule.installments.length,
      installmentAmountCop: schedule.installmentAmountCop,
      startDate: first.dueDate,
      nextDueDate: first.dueDate,
      nextInstallmentId: first.id,
      nextInstallmentNumber: first.number,
      nextInstallmentAmountCop: first.amountCop,
      lastPaymentDate: null,
      status: creditStatus,
      evidence: {
        documentUrls: input.documents,
        acceptanceVideoUrl: input.acceptanceVideoUrl,
      },
      createdAt: now,
    };
    const installments: Installment[] = schedule.installments.map((item) => ({
      id: `${creditId}:${item.id}`,
      number: item.number,
      dueDate: item.dueDate,
      amountCop: item.amountCop,
      paidCop: 0,
      status: item.dueDate.getTime() < todayStart.getTime() ? 'en_mora' : 'pendiente',
      paidAt: null,
      paymentIds: [],
      collectorUid: input.client.collectorUid,
      creditId,
      clientId: input.client.id,
    }));
    await localDb.saveCreditBundle(credit, installments);
    this.touch();
    return creditId;
  }

  async registerPayment(input: PaymentInput): Promise<PaymentReceipt> {
    const amountCop = assertCopInteger(input.amountCop, 'El valor del pago');
    if (amountCop <= 0) {
      throw new Error('El valor del pago debe ser mayor que cero.');
    }
    const credit = await localDb.credit(input.creditId);
    if (!credit || credit.tenantId !== input.tenantId) {
      throw new Error('Este crédito no está en el teléfono.');
    }
    if (input.actorRole === 'cobrador' && credit.collectorUid !== input.actorUid) {
      throw new Error('Solo puedes cobrar los créditos de tu ruta.');
    }
    if (credit.status === 'pagado' || credit.balanceCop <= 0) {
      throw new Error('Este crédito ya está pagado.');
    }
    if (amountCop > credit.balanceCop) {
      throw new Error('El valor supera el saldo del crédito.');
    }

    const installments = (await localDb.installments(credit.id)).sort((left, right) => left.number - right.number);
    const target =
      installments.find((item) => item.id.endsWith(`:${credit.nextInstallmentId}`) && item.status !== 'pagado') ??
      installments.find((item) => item.id === credit.nextInstallmentId && item.status !== 'pagado') ??
      installments.find((item) => item.status !== 'pagado');
    if (!target) {
      throw new Error('No hay cuotas pendientes.');
    }
    const remaining = target.amountCop - target.paidCop;
    if (amountCop > remaining) {
      throw new Error('El abono supera esta cuota. Regístrala completa y luego la siguiente.');
    }

    const now = new Date();
    const todayStart = startOfBogotaDay(now);
    const paidCop = target.paidCop + amountCop;
    const installmentStatus = nextInstallmentStatus(paidCop, target.amountCop, target.dueDate, todayStart);
    const updatedTarget: Installment = {
      ...target,
      paidCop,
      status: installmentStatus,
      paidAt: now,
    };
    const open = installments
      .map((item) => (item.id === target.id ? updatedTarget : item))
      .filter((item) => item.status !== 'pagado');
    const next = open[0] ?? null;
    const balanceCop = credit.balanceCop - amountCop;
    const creditStatus: CreditStatus =
      !next || balanceCop <= 0 ? 'pagado' : next.dueDate.getTime() < todayStart.getTime() ? 'en_mora' : 'activo';
    const interestCop = interestPortion(amountCop, credit.interestCop, credit.totalToCollectCop);
    const paymentId = crypto.randomUUID();
    const receiptNumber = buildReceiptNumber(paymentId, now);
    const payment: PaymentRecord = {
      id: paymentId,
      tenantId: input.tenantId,
      creditId: credit.id,
      clientId: credit.clientId,
      collectorUid: credit.collectorUid,
      collectorName: input.actorName,
      amountCop,
      interestCop,
      principalCop: amountCop - interestCop,
      method: input.method,
      paidAt: now,
      receiptNumber,
      installmentId: target.id,
      installmentNumber: target.number,
      businessName: input.businessName,
      evidenceDataUrl: input.evidenceDataUrl ?? null,
    };
    const nextId = next ? next.id.split(':').pop() ?? next.id : null;
    await localDb.savePaymentBundle(
      payment,
      { ...updatedTarget, paymentIds: [...updatedTarget.paymentIds, paymentId] },
      {
        ...credit,
        paidCop: credit.paidCop + amountCop,
        balanceCop,
        status: creditStatus,
        nextDueDate: next ? next.dueDate : null,
        nextInstallmentId: nextId,
        nextInstallmentNumber: next?.number ?? null,
        nextInstallmentAmountCop: next ? next.amountCop - next.paidCop : null,
        lastPaymentDate: bogotaDateKey(now),
      },
    );
    this.touch();
    return {
      businessName: input.businessName,
      receiptNumber,
      paidAt: now,
      collectorName: input.actorName,
      clientName: credit.clientName,
      creditId: credit.id,
      installmentLabel: `${target.number}/${credit.installmentsCount}`,
      amountCop,
      balanceCop,
      method: input.method,
    };
  }

  async monthlyReport(tenantId: string, month: Date): Promise<MonthlyReport> {
    const start = startOfBogotaMonth(month);
    const end = addBogotaMonths(start, 1);
    const credits = await localDb.credits(tenantId);
    const payments = await localDb.payments(tenantId);
    const created = credits.filter((credit) => credit.createdAt >= start && credit.createdAt < end);
    const overdue = credits.filter((credit) => credit.status === 'en_mora');
    const open = credits.filter((credit) => credit.status === 'activo' || credit.status === 'en_mora');
    const monthPayments = payments.filter((payment) => payment.paidAt >= start && payment.paidAt < end);
    return {
      monthKey: bogotaDateKey(start).slice(0, 7),
      capitalPrestadoCop: created.reduce((sum, credit) => sum + credit.principalCop, 0),
      gananciasCop: monthPayments.reduce((sum, payment) => sum + payment.interestCop, 0),
      carteraVencidaCop: overdue.reduce((sum, credit) => sum + credit.balanceCop, 0),
      capitalEnCalleCop: open.reduce((sum, credit) => {
        if (credit.totalToCollectCop <= 0) {
          return sum;
        }
        return sum + Math.round((credit.balanceCop * credit.principalCop) / credit.totalToCollectCop);
      }, 0),
      pagosDelMesCop: monthPayments.reduce((sum, payment) => sum + payment.amountCop, 0),
    };
  }

  async updateCapital(tenantId: string, capitalCop: number): Promise<void> {
    const amount = assertCopInteger(capitalCop, 'El capital');
    if (amount < 0) {
      throw new Error('El capital no puede ser negativo.');
    }
    const tenant = await this.requireTenant(tenantId);
    await localDb.saveTenant({ ...tenant, capitalCop: amount });
    this.touch();
  }

  async createCollector(tenantId: string, input: { displayName: string; email: string; phone: string; password: string }): Promise<void> {
    await this.createUser({
      displayName: input.displayName,
      email: input.email,
      phone: input.phone,
      password: input.password,
      role: 'cobrador',
      tenantId,
      active: true,
    });
  }

  async createUser(input: {
    displayName: string;
    email: string;
    phone: string;
    password: string;
    role: UserRole | null;
    tenantId: string | null;
    active: boolean;
    uid?: string;
  }): Promise<void> {
    const email = input.email.trim().toLowerCase();
    const displayName = input.displayName.trim();
    if (!displayName) {
      throw new Error('El nombre es obligatorio.');
    }
    if (!email.includes('@')) {
      throw new Error('El correo no es válido.');
    }
    const needsTenant = input.role === 'oficina_admin' || input.role === 'independiente' || input.role === 'cobrador';
    if (needsTenant && !input.tenantId) {
      throw new Error('Ese rol necesita una sede.');
    }
    if (input.tenantId) {
      await this.requireTenant(input.tenantId);
    }

    const current = input.uid ? await localDb.user(input.uid) : null;
    if (!current && input.password.trim().length < 6) {
      throw new Error('La contraseña debe tener al menos 6 caracteres.');
    }
    const duplicate = await localDb.userByEmail(email);
    if (duplicate && duplicate.uid !== current?.uid) {
      throw new Error('Ya existe un usuario con ese correo en este teléfono.');
    }

    const user: StoredUser = {
      uid: current?.uid ?? crypto.randomUUID(),
      email,
      displayName,
      phone: input.phone.trim(),
      passwordHash: input.password.trim() ? await sha256(input.password.trim()) : current?.passwordHash ?? '',
      role: input.role,
      tenantId: needsTenant ? input.tenantId : null,
      active: input.active,
    };
    if (!user.passwordHash) {
      throw new Error('Define una contraseña.');
    }
    await localDb.saveUser(user);
    this.touch();
  }

  async saveTenant(input: {
    id?: string;
    name: string;
    type: TenantType;
    city: string;
    phone: string;
    capitalCop: number;
    cycle: BillingCycle;
    amountCop: number;
    ownerUid?: string;
    status?: Tenant['status'];
  }): Promise<void> {
    const name = input.name.trim();
    if (!name) {
      throw new Error('La sede necesita un nombre.');
    }
    const capitalCop = assertCopInteger(Math.round(input.capitalCop), 'El capital');
    const amountCop = assertCopInteger(Math.round(input.amountCop), 'El valor de la suscripción');
    const current = input.id ? await localDb.tenant(input.id) : null;
    const now = new Date();
    const tenant: Tenant = {
      id: current?.id ?? crypto.randomUUID(),
      name,
      type: input.type,
      status: input.status ?? current?.status ?? 'activo',
      ownerUid: input.ownerUid ?? current?.ownerUid ?? '',
      capitalCop,
      phone: input.phone.trim(),
      city: input.city.trim(),
      subscription: {
        plan: input.type,
        cycle: input.cycle,
        amountCop,
        nextDue: current?.subscription.nextDue ?? addBogotaMonths(now, input.cycle === 'anual' ? 12 : 1),
        lastPaymentAt: current?.subscription.lastPaymentAt ?? null,
      },
    };
    await localDb.saveTenant(tenant);
    this.touch();
  }

  async setTenantAccess(tenantId: string, status: 'activo' | 'suspendido'): Promise<void> {
    const tenant = await this.requireTenant(tenantId);
    await localDb.saveTenant({ ...tenant, status });
    this.touch();
  }

  async registerSubscriptionPayment(tenantId: string, cycle: BillingCycle): Promise<void> {
    const tenant = await this.requireTenant(tenantId);
    const base = tenant.subscription.nextDue.getTime() > Date.now() ? tenant.subscription.nextDue : new Date();
    await localDb.saveTenant({
      ...tenant,
      status: 'activo',
      subscription: {
        ...tenant.subscription,
        cycle,
        lastPaymentAt: new Date(),
        nextDue: addBogotaMonths(base, cycle === 'anual' ? 12 : 1),
      },
    });
    this.touch();
  }

  private async requireTenant(tenantId: string): Promise<Tenant> {
    const tenant = await localDb.tenant(tenantId);
    if (!tenant) {
      throw new Error('La sede no existe en este teléfono.');
    }
    return tenant;
  }
}

function nextInstallmentStatus(
  paidCop: number,
  amountCop: number,
  dueDate: Date,
  todayStart: Date,
): InstallmentStatus {
  if (paidCop >= amountCop) {
    return 'pagado';
  }
  if (dueDate.getTime() < todayStart.getTime()) {
    return 'en_mora';
  }
  return paidCop > 0 ? 'parcial' : 'pendiente';
}

function interestPortion(amountCop: number, interestCop: number, totalToCollectCop: number): number {
  if (totalToCollectCop <= 0) {
    return 0;
  }
  const portion = Math.round((amountCop * interestCop) / totalToCollectCop);
  return Math.min(amountCop, Math.max(0, portion));
}

function buildReceiptNumber(paymentId: string, paidAt: Date): string {
  const key = bogotaDateKey(paidAt).replaceAll('-', '');
  return `RC-${key}-${paymentId.slice(0, 6).toUpperCase()}`;
}
