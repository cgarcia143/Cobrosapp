import { Injectable, inject } from '@angular/core';
import {
  Query,
  Timestamp,
  collection,
  onSnapshot,
  query,
  where,
} from 'firebase/firestore';
import { bogotaDateKey, endOfBogotaDay } from '../domain/bogota-date';
import type { AgendaItem, AgendaSnapshot, AgendaStatus, UserRole } from '../domain/models';
import { FIRESTORE } from '../firebase/firebase-providers';
import { mapCredit, toAgendaItem } from '../firestore/mappers';

const STATUS_RANK: Record<AgendaStatus, number> = {
  en_mora: 0,
  pendiente: 1,
  pagado: 2,
};

@Injectable({ providedIn: 'root' })
export class AgendaService {
  private readonly firestore = inject(FIRESTORE);

  /**
   * La caché persistente se activa al iniciar Firestore (IndexedDB, varias pestañas).
   * onSnapshot entrega primero los documentos locales y marca metadata.fromCache.
   * Los pagos hechos sin red quedan en cola y metadata.hasPendingWrites permanece en true.
   */
  watch(params: {
    tenantId: string;
    role: UserRole;
    actorUid: string;
    collectorUid: string | null;
    onData: (snapshot: AgendaSnapshot) => void;
    onError: (error: Error) => void;
  }): () => void {
    const collectorFilter = params.role === 'cobrador' ? params.actorUid : params.collectorUid;
    const today = new Date();
    const todayKey = bogotaDateKey(today);
    const todayEnd = Timestamp.fromDate(endOfBogotaDay(today));
    const credits = collection(this.firestore, `tenants/${params.tenantId}/credits`);

    let pendingItems: AgendaItem[] = [];
    let paidItems: AgendaItem[] = [];
    let pendingFromCache = true;
    let paidFromCache = true;
    let pendingWrites = false;
    let paidWrites = false;
    let seenPending = false;
    let seenPaid = false;

    const emit = () => {
      if (!seenPending || !seenPaid) {
        return;
      }
      const items = mergeAgenda(pendingItems, paidItems);
      params.onData({
        items,
        fromCache: pendingFromCache || paidFromCache,
        hasPendingWrites: pendingWrites || paidWrites,
      });
    };

    const dueLimit = todayEnd.toDate().getTime();
    const pendingUnsub = onSnapshot(
      pendingQuery(credits, collectorFilter),
      { includeMetadataChanges: true },
      (snapshot) => {
        seenPending = true;
        pendingFromCache = snapshot.metadata.fromCache;
        pendingWrites = snapshot.metadata.hasPendingWrites;
        pendingItems = snapshot.docs
          .map((item) => mapCredit(item.id, item.data()))
          .filter(
            (credit) =>
              (credit.status === 'activo' || credit.status === 'en_mora') &&
              credit.nextDueDate !== null &&
              credit.nextDueDate.getTime() <= dueLimit,
          )
          .map((credit) => toAgendaItem(credit, today));
        emit();
      },
      (error) => params.onError(error),
    );

    const paidUnsub = onSnapshot(
      paidQuery(credits, collectorFilter, todayKey),
      { includeMetadataChanges: true },
      (snapshot) => {
        seenPaid = true;
        paidFromCache = snapshot.metadata.fromCache;
        paidWrites = snapshot.metadata.hasPendingWrites;
        paidItems = snapshot.docs
          .map((item) => mapCredit(item.id, item.data()))
          .filter((credit) => credit.lastPaymentDate === todayKey)
          .map((credit) => toAgendaItem(credit, today));
        emit();
      },
      (error) => params.onError(error),
    );

    return () => {
      pendingUnsub();
      paidUnsub();
    };
  }
}

function pendingQuery(credits: ReturnType<typeof collection>, collectorUid: string | null): Query {
  if (collectorUid) {
    return query(credits, where('collectorUid', '==', collectorUid));
  }
  return query(credits, where('status', 'in', ['activo', 'en_mora']));
}

function paidQuery(credits: ReturnType<typeof collection>, collectorUid: string | null, todayKey: string): Query {
  if (collectorUid) {
    return query(credits, where('collectorUid', '==', collectorUid));
  }
  return query(credits, where('lastPaymentDate', '==', todayKey));
}

function mergeAgenda(pending: AgendaItem[], paid: AgendaItem[]): AgendaItem[] {
  const merged = new Map<string, AgendaItem>();
  for (const item of paid) {
    merged.set(item.creditId, item);
  }
  for (const item of pending) {
    merged.set(item.creditId, item);
  }
  return [...merged.values()].sort((left, right) => {
    const byStatus = STATUS_RANK[left.status] - STATUS_RANK[right.status];
    if (byStatus !== 0) {
      return byStatus;
    }
    if (left.routeOrder !== right.routeOrder) {
      return left.routeOrder - right.routeOrder;
    }
    return left.clientName.localeCompare(right.clientName, 'es');
  });
}
