import { addBogotaDays, bogotaDateKey, endOfBogotaDay, startOfBogotaDay } from './bogota-date';
import type { AgendaItem, AgendaStatus, Credit } from './models';

const STATUS_RANK: Record<AgendaStatus, number> = {
  en_mora: 0,
  pendiente: 1,
  pagado: 2,
};

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

export function buildAgenda(credits: readonly Credit[], today: Date, collectorUid: string | null): AgendaItem[] {
  const todayKey = bogotaDateKey(today);
  const dueLimit = endOfBogotaDay(today).getTime();
  const items = credits
    .filter((credit) => !collectorUid || credit.collectorUid === collectorUid)
    .filter((credit) => {
      const dueToday =
        (credit.status === 'activo' || credit.status === 'en_mora') &&
        credit.nextDueDate !== null &&
        credit.nextDueDate.getTime() <= dueLimit;
      return dueToday || credit.lastPaymentDate === todayKey;
    })
    .map((credit) => toAgendaItem(credit, today));

  return items.sort((left, right) => {
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
