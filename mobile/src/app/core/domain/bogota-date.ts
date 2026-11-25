const BOGOTA_TIME_ZONE = 'America/Bogota';
const BOGOTA_UTC_OFFSET_HOURS = 5;

export function bogotaDateKey(date: Date): string {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: BOGOTA_TIME_ZONE,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(date);
}

export function parseBogotaDateKey(key: string): Date {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(key);
  if (!match) {
    throw new Error('La fecha debe tener formato AAAA-MM-DD.');
  }

  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  return new Date(Date.UTC(year, month - 1, day, BOGOTA_UTC_OFFSET_HOURS, 0, 0, 0));
}

export function startOfBogotaDay(date: Date): Date {
  return parseBogotaDateKey(bogotaDateKey(date));
}

export function addBogotaDays(date: Date, days: number): Date {
  const start = startOfBogotaDay(date);
  return new Date(start.getTime() + days * 86_400_000);
}

export function endOfBogotaDay(date: Date): Date {
  return new Date(addBogotaDays(date, 1).getTime() - 1);
}

export function addBogotaMonths(date: Date, months: number): Date {
  const [yearText, monthText, dayText] = bogotaDateKey(date).split('-');
  const year = Number(yearText);
  const monthIndex = Number(monthText) - 1;
  const day = Number(dayText);
  const target = monthIndex + months;
  const targetYear = year + Math.floor(target / 12);
  const targetMonth = ((target % 12) + 12) % 12;
  const lastDay = new Date(Date.UTC(targetYear, targetMonth + 1, 0)).getUTCDate();
  return new Date(Date.UTC(targetYear, targetMonth, Math.min(day, lastDay), BOGOTA_UTC_OFFSET_HOURS, 0, 0, 0));
}

export function startOfBogotaMonth(date: Date): Date {
  return parseBogotaDateKey(`${bogotaDateKey(date).slice(0, 7)}-01`);
}

export function formatBogotaDate(date: Date): string {
  return new Intl.DateTimeFormat('es-CO', {
    timeZone: BOGOTA_TIME_ZONE,
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
  }).format(date);
}

export function formatBogotaDateTime(date: Date): string {
  return new Intl.DateTimeFormat('es-CO', {
    timeZone: BOGOTA_TIME_ZONE,
    dateStyle: 'short',
    timeStyle: 'short',
  }).format(date);
}
