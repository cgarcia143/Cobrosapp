import { Injectable, inject } from '@angular/core';
import { Timestamp, collection, doc, getDocs, query, updateDoc, where } from 'firebase/firestore';
import { addBogotaMonths, bogotaDateKey, startOfBogotaMonth } from '../domain/bogota-date';
import type { MonthlyReport } from '../domain/models';
import { assertCopInteger } from '../domain/money';
import { FIRESTORE } from '../firebase/firebase-providers';
import { mapCredit, readNumber } from '../firestore/mappers';

@Injectable({ providedIn: 'root' })
export class ReportsService {
  private readonly firestore = inject(FIRESTORE);

  async loadMonth(tenantId: string, month: Date): Promise<MonthlyReport> {
    const start = startOfBogotaMonth(month);
    const end = addBogotaMonths(start, 1);
    const credits = collection(this.firestore, `tenants/${tenantId}/credits`);
    const payments = collection(this.firestore, `tenants/${tenantId}/payments`);
    const [createdSnap, overdueSnap, openSnap, paymentsSnap] = await Promise.all([
      getDocs(query(credits, where('createdAt', '>=', Timestamp.fromDate(start)), where('createdAt', '<', Timestamp.fromDate(end)))),
      getDocs(query(credits, where('status', '==', 'en_mora'))),
      getDocs(query(credits, where('status', 'in', ['activo', 'en_mora']))),
      getDocs(query(payments, where('paidAt', '>=', Timestamp.fromDate(start)), where('paidAt', '<', Timestamp.fromDate(end)))),
    ]);

    const capitalPrestadoCop = createdSnap.docs.reduce((sum, item) => sum + readNumber(item.data(), 'principalCop'), 0);
    const carteraVencidaCop = overdueSnap.docs.reduce((sum, item) => sum + readNumber(item.data(), 'balanceCop'), 0);
    const capitalEnCalleCop = openSnap.docs.reduce((sum, item) => {
      const credit = mapCredit(item.id, item.data());
      if (credit.totalToCollectCop <= 0) {
        return sum;
      }
      return sum + Math.round((credit.balanceCop * credit.principalCop) / credit.totalToCollectCop);
    }, 0);
    const gananciasCop = paymentsSnap.docs.reduce((sum, item) => sum + readNumber(item.data(), 'interestCop'), 0);
    const pagosDelMesCop = paymentsSnap.docs.reduce((sum, item) => sum + readNumber(item.data(), 'amountCop'), 0);
    const fromCache = [createdSnap, overdueSnap, openSnap, paymentsSnap].some((snap) => snap.metadata.fromCache);

    return {
      monthKey: bogotaDateKey(start).slice(0, 7),
      capitalPrestadoCop,
      gananciasCop,
      carteraVencidaCop,
      capitalEnCalleCop,
      pagosDelMesCop,
      fromCache,
    };
  }

  async updateCapital(tenantId: string, capitalCop: number): Promise<void> {
    const amount = assertCopInteger(capitalCop, 'El capital');
    if (amount < 0) {
      throw new Error('El capital no puede ser negativo.');
    }
    await updateDoc(doc(this.firestore, `tenants/${tenantId}`), {
      capitalCop: amount,
      updatedAt: Timestamp.fromDate(new Date()),
    });
  }
}
