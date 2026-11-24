import { Injectable } from '@angular/core';
import { formatBogotaDateTime } from '../domain/bogota-date';
import { formatCop } from '../domain/money';
import type { PaymentReceipt } from '../domain/models';

const LINE_WIDTH = 32;
const CHUNK_SIZE = 180;
const PRINTER_SERVICES = [
  '000018f0-0000-1000-8000-00805f9b34fb',
  '0000ff00-0000-1000-8000-00805f9b34fb',
  '49535343-fe7d-4ae5-8fa9-9fafd205e455',
  'e7810a71-73ae-499d-8c15-faa9aef0c3f2',
];

interface WritableCharacteristic {
  properties: { write?: boolean; writeWithoutResponse?: boolean };
  writeValue(data: BufferSource): Promise<void>;
  writeValueWithoutResponse(data: BufferSource): Promise<void>;
}

interface GattService {
  getCharacteristics(): Promise<WritableCharacteristic[]>;
}

interface GattServer {
  connected: boolean;
  connect(): Promise<GattServer>;
  getPrimaryServices(): Promise<GattService[]>;
}

interface BluetoothDeviceLike {
  name?: string;
  gatt?: GattServer;
}

interface BluetoothRequest {
  requestDevice(options: { acceptAllDevices: boolean; optionalServices: string[] }): Promise<BluetoothDeviceLike>;
}

@Injectable({ providedIn: 'root' })
export class ThermalPrinterService {
  readonly bluetoothAvailable = typeof navigator !== 'undefined' && 'bluetooth' in navigator;

  async printViaBluetooth(receipt: PaymentReceipt): Promise<void> {
    const bluetooth = (navigator as Navigator & { bluetooth?: BluetoothRequest }).bluetooth;
    if (!bluetooth) {
      throw new Error('Este navegador no expone Web Bluetooth. Usa la impresión del sistema.');
    }

    const device = await bluetooth.requestDevice({
      acceptAllDevices: true,
      optionalServices: PRINTER_SERVICES,
    });
    if (!device.gatt) {
      throw new Error('La impresora no publicó un canal GATT.');
    }

    const server = await device.gatt.connect();
    const characteristic = await findWritable(server);
    await writeChunks(characteristic, encodeReceipt(receipt));
  }

  printViaBrowser(receipt: PaymentReceipt): void {
    const popup = window.open('', 'recibo', 'width=420,height=720');
    if (!popup) {
      throw new Error('El navegador bloqueó la ventana de impresión. Permite ventanas emergentes e inténtalo de nuevo.');
    }
    popup.document.open();
    popup.document.write(renderReceiptHtml(receipt));
    popup.document.close();
    popup.focus();
    popup.print();
  }
}

function encodeReceipt(receipt: PaymentReceipt): Uint8Array {
  const lines = [
    center('COBRANZAS'),
    center(receipt.businessName),
    divider(),
    pair('Recibo', receipt.receiptNumber),
    ...wrap(`Fecha ${formatBogotaDateTime(receipt.paidAt)}`),
    ...wrap(`Cobrador ${receipt.collectorName}`),
    ...wrap(`Cliente ${receipt.clientName}`),
    pair('Cuota', receipt.installmentLabel),
    pair('Pago', formatCop(receipt.amountCop)),
    pair('Saldo', formatCop(receipt.balanceCop)),
    pair('Medio', receipt.method),
    divider(),
    center('Gracias por su pago'),
    '',
    '',
    '',
  ];
  const payload = lines.map((line) => `${stripAccents(line)}\n`).join('');
  return concatBytes([new Uint8Array([0x1b, 0x40]), new TextEncoder().encode(payload)]);
}

async function findWritable(server: GattServer): Promise<WritableCharacteristic> {
  const services = await server.getPrimaryServices();
  for (const service of services) {
    const characteristics = await service.getCharacteristics();
    const match = characteristics.find(
      (item) => item.properties.writeWithoutResponse || item.properties.write,
    );
    if (match) {
      return match;
    }
  }
  throw new Error('No encontré una característica de escritura en la impresora.');
}

async function writeChunks(characteristic: WritableCharacteristic, payload: Uint8Array): Promise<void> {
  for (let offset = 0; offset < payload.length; offset += CHUNK_SIZE) {
    const chunk = payload.slice(offset, offset + CHUNK_SIZE);
    if (characteristic.properties.writeWithoutResponse) {
      await characteristic.writeValueWithoutResponse(chunk);
    } else {
      await characteristic.writeValue(chunk);
    }
    await delay(20);
  }
}

function renderReceiptHtml(receipt: PaymentReceipt): string {
  const rows = [
    ['Recibo', receipt.receiptNumber],
    ['Fecha', formatBogotaDateTime(receipt.paidAt)],
    ['Cobrador', receipt.collectorName],
    ['Cliente', receipt.clientName],
    ['Cuota', receipt.installmentLabel],
    ['Pago', formatCop(receipt.amountCop)],
    ['Saldo', formatCop(receipt.balanceCop)],
    ['Medio', receipt.method],
  ];
  const body = rows
    .map(
      ([label, value]) =>
        `<div class="row"><span>${escapeHtml(label ?? '')}</span><span>${escapeHtml(value ?? '')}</span></div>`,
    )
    .join('');
  return `<!doctype html>
<html lang="es">
<head>
  <meta charset="utf-8" />
  <title>${escapeHtml(receipt.receiptNumber)}</title>
  <style>
    @page { size: 58mm auto; margin: 2mm; }
    body { width: 58mm; margin: 0; font-family: "Courier New", monospace; font-size: 12px; color: #000; }
    h1, p { text-align: center; margin: 0 0 4px; }
    .row { display: flex; justify-content: space-between; gap: 8px; margin: 2px 0; }
    .row span:last-child { text-align: right; }
    hr { border: 0; border-top: 1px dashed #000; margin: 6px 0; }
  </style>
</head>
<body>
  <h1>COBRANZAS</h1>
  <p>${escapeHtml(receipt.businessName)}</p>
  <hr />
  ${body}
  <hr />
  <p>Gracias por su pago</p>
</body>
</html>`;
}

function center(value: string): string {
  const text = stripAccents(value).slice(0, LINE_WIDTH);
  const pad = Math.max(0, Math.floor((LINE_WIDTH - text.length) / 2));
  return `${' '.repeat(pad)}${text}`;
}

function divider(): string {
  return '-'.repeat(LINE_WIDTH);
}

function pair(label: string, value: string): string {
  const right = stripAccents(value);
  const left = stripAccents(label);
  const space = LINE_WIDTH - left.length - right.length;
  if (space >= 1) {
    return `${left}${' '.repeat(space)}${right}`;
  }
  return wrap(`${left} ${right}`).join('\n');
}

function wrap(value: string): string[] {
  const words = stripAccents(value).split(/\s+/).filter(Boolean);
  const lines: string[] = [];
  let current = '';
  for (const word of words) {
    const next = current ? `${current} ${word}` : word;
    if (next.length <= LINE_WIDTH) {
      current = next;
      continue;
    }
    if (current) {
      lines.push(current);
    }
    current = word.slice(0, LINE_WIDTH);
  }
  if (current) {
    lines.push(current);
  }
  return lines.length > 0 ? lines : [''];
}

function stripAccents(value: string): string {
  return value
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/ñ/g, 'n')
    .replace(/Ñ/g, 'N');
}

function escapeHtml(value: string): string {
  return value
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;');
}

function concatBytes(parts: Uint8Array[]): Uint8Array {
  const length = parts.reduce((sum, part) => sum + part.length, 0);
  const output = new Uint8Array(length);
  let offset = 0;
  for (const part of parts) {
    output.set(part, offset);
    offset += part.length;
  }
  return output;
}

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => {
    setTimeout(resolve, ms);
  });
}
