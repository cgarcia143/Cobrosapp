import { Component, effect, inject, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { IonicModule } from '@ionic/angular/lazy';
import { formatBogotaDate, formatBogotaDateTime } from '../../core/domain/bogota-date';
import { formatCop } from '../../core/domain/money';
import { isTenantBlocked, type AgendaItem, type PaymentMethod, type PaymentReceipt, type StoredUser } from '../../core/domain/models';
import { errorText, readEvidenceFile } from '../../core/media';
import { AuthService } from '../../core/services/auth.service';
import { DataService } from '../../core/services/data.service';

@Component({
  selector: 'app-agenda',
  templateUrl: './agenda.page.html',
  imports: [IonicModule, FormsModule],
})
export class AgendaPage {
  private readonly data = inject(DataService);
  private readonly auth = inject(AuthService);
  readonly formatCop = formatCop;
  readonly formatDate = formatBogotaDate;
  readonly formatDateTime = formatBogotaDateTime;
  readonly items = signal<AgendaItem[]>([]);
  readonly team = signal<StoredUser[]>([]);
  readonly collectorFilter = signal('');
  readonly amounts = signal<Record<string, number>>({});
  readonly methods = signal<Record<string, PaymentMethod>>({});
  readonly photos = signal<Record<string, string | null>>({});
  readonly savingId = signal<string | null>(null);
  readonly errorMessage = signal('');
  readonly infoMessage = signal('');
  readonly lastReceipt = signal<PaymentReceipt | null>(null);
  readonly suspended = signal(false);

  constructor() {
    effect(() => {
      this.data.revision();
      void this.reload();
    });
  }

  async reload(): Promise<void> {
    const session = this.auth.session();
    if (!session?.tenantId) {
      this.errorMessage.set('No hay una sede activa en este teléfono.');
      return;
    }
    const tenant = await this.data.tenant(session.tenantId);
    this.suspended.set(isTenantBlocked(tenant));
    const collectorUid = session.role === 'cobrador' ? session.uid : this.collectorFilter() || null;
    const items = await this.data.agenda(session.tenantId, collectorUid);
    this.items.set(items);
    this.amounts.update((current) => {
      const next = { ...current };
      for (const item of items) {
        if (next[item.creditId] === undefined) {
          next[item.creditId] = item.amountDueCop;
        }
      }
      return next;
    });
    if (session.role !== 'cobrador') {
      const team = await this.data.team(session.tenantId);
      this.team.set(team.filter((member) => member.active));
    }
  }

  isCollector(): boolean {
    return this.auth.session()?.role === 'cobrador';
  }

  onCollectorChange(value: string | null | undefined): void {
    const next = !value || value === 'todos' ? '' : value;
    if (next === this.collectorFilter()) {
      return;
    }
    this.collectorFilter.set(next);
    void this.reload();
  }

  amountOf(item: AgendaItem): number {
    return this.amounts()[item.creditId] ?? item.amountDueCop;
  }

  methodOf(item: AgendaItem): PaymentMethod {
    return this.methods()[item.creditId] ?? 'efectivo';
  }

  setAmount(creditId: string, value: string | number | null | undefined): void {
    const parsed = Number(value);
    this.amounts.update((current) => ({ ...current, [creditId]: Number.isFinite(parsed) ? Math.round(parsed) : 0 }));
  }

  setMethod(creditId: string, value: string | null | undefined): void {
    const method: PaymentMethod = value === 'transferencia' ? 'transferencia' : 'efectivo';
    this.methods.update((current) => ({ ...current, [creditId]: method }));
  }

  async setPhoto(creditId: string, files: FileList | null): Promise<void> {
    const file = files?.item(0);
    if (!file) {
      this.photos.update((current) => ({ ...current, [creditId]: null }));
      return;
    }
    try {
      const dataUrl = await readEvidenceFile(file);
      this.photos.update((current) => ({ ...current, [creditId]: dataUrl }));
      this.errorMessage.set('');
    } catch (error) {
      this.errorMessage.set(errorText(error));
    }
  }

  async collect(item: AgendaItem): Promise<void> {
    const session = this.auth.session();
    if (!session?.tenantId || !session.role || this.suspended()) {
      return;
    }
    this.savingId.set(item.creditId);
    this.errorMessage.set('');
    this.infoMessage.set('');
    try {
      const tenant = await this.data.tenant(session.tenantId);
      const receipt = await this.data.registerPayment({
        tenantId: session.tenantId,
        businessName: tenant?.name || 'Cobranzas',
        actorUid: session.uid,
        actorName: session.displayName || session.email || 'Cobrador',
        actorRole: session.role,
        creditId: item.creditId,
        amountCop: this.amountOf(item),
        method: this.methodOf(item),
        evidenceDataUrl: this.photos()[item.creditId] ?? null,
      });
      this.lastReceipt.set(receipt);
      this.infoMessage.set(`Pago guardado en este teléfono. Recibo ${receipt.receiptNumber}.`);
    } catch (error) {
      this.errorMessage.set(errorText(error));
    } finally {
      this.savingId.set(null);
    }
  }

  printReceipt(): void {
    const receipt = this.lastReceipt();
    if (!receipt) {
      return;
    }
    const popup = window.open('', '_blank', 'noopener,width=420,height=640');
    const body = `
      <h1>${receipt.businessName}</h1>
      <p>Recibo ${receipt.receiptNumber}</p>
      <p>${formatBogotaDateTime(receipt.paidAt)}</p>
      <p>Cliente: ${receipt.clientName}</p>
      <p>Cuota: ${receipt.installmentLabel}</p>
      <p>Valor: ${formatCop(receipt.amountCop)}</p>
      <p>Saldo: ${formatCop(receipt.balanceCop)}</p>
      <p>Medio: ${receipt.method}</p>
      <p>Cobrador: ${receipt.collectorName}</p>
    `;
    if (!popup) {
      this.infoMessage.set(`${receipt.receiptNumber} · ${receipt.clientName} · ${formatCop(receipt.amountCop)}`);
      return;
    }
    popup.document.write(`<html><head><title>${receipt.receiptNumber}</title></head><body>${body}<script>print()<\/script></body></html>`);
    popup.document.close();
  }

  statusColor(status: AgendaItem['status']): string {
    if (status === 'pagado') return 'success';
    if (status === 'en_mora') return 'warning';
    return 'primary';
  }

  statusLabel(status: AgendaItem['status']): string {
    if (status === 'pagado') return 'Pagado';
    if (status === 'en_mora') return 'En mora';
    return 'Pendiente';
  }
}
