import { Injectable, inject } from '@angular/core';
import {
  Timestamp,
  arrayUnion,
  collection,
  doc,
  getDoc,
  getDocs,
  query,
  where,
  writeBatch,
} from 'firebase/firestore';
import { getDownloadURL, ref, uploadBytesResumable } from 'firebase/storage';
import { bogotaDateKey, startOfBogotaDay } from '../domain/bogota-date';
import { buildCreditSchedule } from '../domain/credit-schedule';
import { assertCopInteger } from '../domain/money';
import type {
  Client,
  CreditStatus,
  Installment,
  InstallmentStatus,
  PaymentMethod,
  PaymentReceipt,
  UserRole,
} from '../domain/models';
import { isManagerRole } from '../domain/models';
import { FIREBASE_STORAGE, FIRESTORE } from '../firebase/firebase-providers';
import { OfflineMediaError } from '../firestore/errors';
import { mapCredit, mapInstallment } from '../firestore/mappers';

export { buildCreditSchedule } from '../domain/credit-schedule';

export interface CreateCreditInput {
  tenantId: string;
  actorUid: string;
  actorRole: UserRole;
  client: Client;
  principalCop: number;
  interestRatePercent: number;
  frequency: 'diario' | 'semanal' | 'quincenal' | 'mensual';
  installmentsCount: number;
  startDate: Date;
  documents: File[];
  acceptanceVideo: File | null;
  onProgress?: (progress: number) => void;
}

export interface RegisterPaymentInput {
  tenantId: string;
  businessName: string;
  actorUid: string;
  actorName: string;
  actorRole: UserRole;
  creditId: string;
  amountCop: number;
  method: PaymentMethod;
  evidencePhoto?: File | null;
}

@Injectable({ providedIn: 'root' })
export class CreditService {
  private readonly firestore = inject(FIRESTORE);
  private readonly storage = inject(FIREBASE_STORAGE);

  async createCredit(input: CreateCreditInput): Promise<string> {
    if (!isManagerRole(input.actorRole)) {
      throw new Error('Solo la oficina o el independiente pueden crear créditos.');
    }
    if (!input.client.active) {
      throw new Error('El cliente está inactivo.');
    }

    const schedule = buildCreditSchedule({
      principalCop: input.principalCop,
      interestRatePercent: input.interestRatePercent,
      installmentsCount: input.installmentsCount,
      frequency: input.frequency,
      startDate: input.startDate,
    });

    const hasMedia = input.documents.length > 0 || input.acceptanceVideo !== null;
    if (hasMedia && !navigator.onLine) {
      throw new OfflineMediaError();
    }

    const creditRef = doc(collection(this.firestore, `tenants/${input.tenantId}/credits`));
    const evidence = await this.uploadEvidence(input, creditRef.id);
    const now = new Date();
    const todayStart = startOfBogotaDay(now);
    const first = schedule.installments[0];
    if (!first) {
      throw new Error('El crédito no generó cuotas.');
    }

    const creditStatus: CreditStatus = first.dueDate.getTime() < todayStart.getTime() ? 'en_mora' : 'activo';
    const batch = writeBatch(this.firestore);
    batch.set(creditRef, {
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
      startDate: Timestamp.fromDate(schedule.installments[0]?.dueDate ?? input.startDate),
      nextDueDate: Timestamp.fromDate(first.dueDate),
      nextInstallmentId: first.id,
      nextInstallmentNumber: first.number,
      nextInstallmentAmountCop: first.amountCop,
      lastPaymentDate: null,
      status: creditStatus,
      evidence,
      createdAt: Timestamp.fromDate(now),
      updatedAt: Timestamp.fromDate(now),
      createdBy: input.actorUid,
    });

    for (const installment of schedule.installments) {
      const status: InstallmentStatus =
        installment.dueDate.getTime() < todayStart.getTime() ? 'en_mora' : 'pendiente';
      batch.set(doc(creditRef, 'installments', installment.id), {
        number: installment.number,
        dueDate: Timestamp.fromDate(installment.dueDate),
        amountCop: installment.amountCop,
        paidCop: 0,
        status,
        paidAt: null,
        paymentIds: [],
        collectorUid: input.client.collectorUid,
        creditId: creditRef.id,
        clientId: input.client.id,
        createdAt: Timestamp.fromDate(now),
        updatedAt: Timestamp.fromDate(now),
      });
    }

    await batch.commit();
    return creditRef.id;
  }

  async registerPayment(input: RegisterPaymentInput): Promise<PaymentReceipt> {
    const amountCop = assertCopInteger(input.amountCop, 'El valor del pago');
    if (amountCop <= 0) {
      throw new Error('El valor del pago debe ser mayor que cero.');
    }
    if (input.evidencePhoto && !navigator.onLine) {
      throw new OfflineMediaError();
    }

    const creditRef = doc(this.firestore, `tenants/${input.tenantId}/credits/${input.creditId}`);
    const creditSnap = await getDoc(creditRef);
    if (!creditSnap.exists()) {
      throw new Error('Este crédito no está en el dispositivo. Abre la ruta con conexión al menos una vez.');
    }

    const credit = mapCredit(creditSnap.id, creditSnap.data());
    if (input.actorRole === 'cobrador' && credit.collectorUid !== input.actorUid) {
      throw new Error('Solo puedes cobrar los créditos de tu ruta.');
    }
    if (credit.status === 'pagado' || credit.balanceCop <= 0) {
      throw new Error('Este crédito ya está pagado.');
    }
    if (amountCop > credit.balanceCop) {
      throw new Error('El valor supera el saldo del crédito.');
    }

    const installmentsRef = collection(creditRef, 'installments');
    const installmentQuery =
      input.actorRole === 'cobrador'
        ? query(installmentsRef, where('collectorUid', '==', input.actorUid))
        : query(installmentsRef);
    const installmentSnap = await getDocs(installmentQuery);
    const installments = installmentSnap.docs
      .map((item) => mapInstallment(item.id, item.data()))
      .sort((left, right) => left.number - right.number);
    const target =
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
    const creditStatus: CreditStatus = !next || balanceCop <= 0
      ? 'pagado'
      : next.dueDate.getTime() < todayStart.getTime()
        ? 'en_mora'
        : 'activo';
    const interestCop = interestPortion(amountCop, credit.interestCop, credit.totalToCollectCop);
    const principalCop = amountCop - interestCop;
    const paymentRef = doc(collection(this.firestore, `tenants/${input.tenantId}/payments`));
    const receiptNumber = buildReceiptNumber(paymentRef.id, now);
    const evidenceUrl = input.evidencePhoto
      ? await this.uploadFile(
          ref(
            this.storage,
            `tenants/${input.tenantId}/payments/${paymentRef.id}/${safeFileName(input.evidencePhoto, 0)}`,
          ),
          input.evidencePhoto,
          contentTypeOf(input.evidencePhoto, 'image'),
          () => undefined,
        )
      : null;
    const batch = writeBatch(this.firestore);

    batch.set(paymentRef, {
      creditId: credit.id,
      clientId: credit.clientId,
      collectorUid: credit.collectorUid,
      collectorName: input.actorName,
      amountCop,
      interestCop,
      principalCop,
      method: input.method,
      paidAt: Timestamp.fromDate(now),
      createdAt: Timestamp.fromDate(now),
      receiptNumber,
      installmentId: target.id,
      installmentNumber: target.number,
      businessName: input.businessName,
      evidenceUrl,
    });
    batch.update(doc(installmentsRef, target.id), {
      paidCop,
      status: installmentStatus,
      paidAt: Timestamp.fromDate(now),
      paymentIds: arrayUnion(paymentRef.id),
      updatedAt: Timestamp.fromDate(now),
    });
    batch.update(creditRef, {
      paidCop: credit.paidCop + amountCop,
      balanceCop,
      status: creditStatus,
      nextDueDate: next ? Timestamp.fromDate(next.dueDate) : null,
      nextInstallmentId: next?.id ?? null,
      nextInstallmentNumber: next?.number ?? null,
      nextInstallmentAmountCop: next ? next.amountCop - next.paidCop : null,
      lastPaymentDate: bogotaDateKey(now),
      updatedAt: Timestamp.fromDate(now),
    });
    await batch.commit();

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

  private async uploadEvidence(
    input: CreateCreditInput,
    creditId: string,
  ): Promise<{ documentUrls: string[]; acceptanceVideoUrl: string | null }> {
    const files = [
      ...input.documents.map((file, index) => ({ file, kind: 'documents' as const, index })),
      ...(input.acceptanceVideo
        ? [{ file: input.acceptanceVideo, kind: 'acceptance' as const, index: 0 }]
        : []),
    ];
    const documentUrls: string[] = [];
    let acceptanceVideoUrl: string | null = null;
    let transferred = 0;
    const totalBytes = files.reduce((sum, item) => sum + item.file.size, 0);

    for (const item of files) {
      const storageRef = ref(
        this.storage,
        `tenants/${input.tenantId}/credits/${creditId}/${item.kind}/${safeFileName(item.file, item.index)}`,
      );
      const contentType = contentTypeOf(item.file, item.kind === 'documents' ? 'image' : 'video');
      const url = await this.uploadFile(storageRef, item.file, contentType, (bytes) => {
        if (totalBytes > 0) {
          input.onProgress?.(Math.min(1, (transferred + bytes) / totalBytes));
        }
      });
      transferred += item.file.size;
      if (item.kind === 'documents') {
        documentUrls.push(url);
      } else {
        acceptanceVideoUrl = url;
      }
    }

    return { documentUrls, acceptanceVideoUrl };
  }

  private uploadFile(
    storageRef: ReturnType<typeof ref>,
    file: File,
    contentType: string,
    onBytes: (bytes: number) => void,
  ): Promise<string> {
    return new Promise((resolve, reject) => {
      const task = uploadBytesResumable(storageRef, file, { contentType });
      task.on(
        'state_changed',
        (snapshot) => onBytes(snapshot.bytesTransferred),
        (error) => reject(error),
        () => {
          void getDownloadURL(task.snapshot.ref).then(resolve, reject);
        },
      );
    });
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
  return 'parcial';
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

function safeFileName(file: File, index: number): string {
  const extension = file.name.includes('.')
    ? file.name.slice(file.name.lastIndexOf('.')).toLowerCase().replace(/[^a-z0-9.]/g, '')
    : '';
  return `${Date.now()}-${index}${extension}`;
}

function contentTypeOf(file: File, kind: 'image' | 'video'): string {
  if (file.type.startsWith('image/') || file.type.startsWith('video/')) {
    return file.type;
  }
  const extension = file.name.split('.').pop()?.toLowerCase();
  if (kind === 'image') {
    if (extension === 'png') return 'image/png';
    if (extension === 'webp') return 'image/webp';
    return 'image/jpeg';
  }
  if (extension === 'webm') return 'video/webm';
  if (extension === 'mov') return 'video/quicktime';
  return 'video/mp4';
}
