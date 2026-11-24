import { addBogotaDays, addBogotaMonths, startOfBogotaDay } from './bogota-date';
import { assertCopInteger } from './money';
import type { CreditFrequency } from './models';

export interface ScheduledInstallment {
  id: string;
  number: number;
  dueDate: Date;
  amountCop: number;
}

export interface CreditSchedule {
  interestCop: number;
  totalToCollectCop: number;
  installmentAmountCop: number;
  installments: ScheduledInstallment[];
}

export interface ScheduleInput {
  principalCop: number;
  interestRatePercent: number;
  installmentsCount: number;
  frequency: CreditFrequency;
  startDate: Date;
}

/**
 * Tasa plana sobre el capital, en pesos enteros.
 * El residuo de la división se suma a la última cuota para que el total cuadre.
 * La primera cuota vence el día de inicio, en calendario de Bogotá.
 */
export function buildCreditSchedule(input: ScheduleInput): CreditSchedule {
  const principalCop = assertCopInteger(input.principalCop, 'El capital');
  if (principalCop <= 0) {
    throw new Error('El capital debe ser mayor que cero.');
  }
  if (!Number.isFinite(input.interestRatePercent) || input.interestRatePercent < 0 || input.interestRatePercent > 1000) {
    throw new Error('La tasa debe estar entre 0 % y 1000 %.');
  }
  if (!Number.isInteger(input.installmentsCount) || input.installmentsCount < 1 || input.installmentsCount > 366) {
    throw new Error('El número de cuotas debe estar entre 1 y 366.');
  }

  const interestCop = Math.round((principalCop * input.interestRatePercent) / 100);
  const totalToCollectCop = principalCop + interestCop;
  const installmentAmountCop = Math.floor(totalToCollectCop / input.installmentsCount);
  if (installmentAmountCop < 1) {
    throw new Error('La cuota quedaría por debajo de 1 peso. Reduce el número de cuotas.');
  }

  const remainder = totalToCollectCop - installmentAmountCop * input.installmentsCount;
  const start = startOfBogotaDay(input.startDate);
  const installments = Array.from({ length: input.installmentsCount }, (_, index) => {
    const number = index + 1;
    const amountCop = installmentAmountCop + (index === input.installmentsCount - 1 ? remainder : 0);
    return {
      id: `i${String(number).padStart(3, '0')}`,
      number,
      dueDate: dueDateAt(start, index, input.frequency),
      amountCop,
    };
  });

  return { interestCop, totalToCollectCop, installmentAmountCop, installments };
}

function dueDateAt(start: Date, index: number, frequency: CreditFrequency): Date {
  switch (frequency) {
    case 'diario':
      return addBogotaDays(start, index);
    case 'semanal':
      return addBogotaDays(start, index * 7);
    case 'quincenal':
      return addBogotaDays(start, index * 15);
    case 'mensual':
      return addBogotaMonths(start, index);
    default: {
      const unknown: never = frequency;
      throw new Error(`Frecuencia no soportada: ${String(unknown)}`);
    }
  }
}
