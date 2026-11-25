const copFormatter = new Intl.NumberFormat('es-CO', {
  style: 'currency',
  currency: 'COP',
  maximumFractionDigits: 0,
});

export function formatCop(value: number): string {
  return copFormatter.format(Math.round(value));
}

export function assertCopInteger(value: number, field: string): number {
  if (!Number.isInteger(value)) {
    throw new Error(`${field} debe ser un valor entero en pesos colombianos.`);
  }
  return value;
}
