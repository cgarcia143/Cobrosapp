import { Component, DestroyRef, inject, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { formatBogotaDate } from '../../core/domain/bogota-date';
import { formatCop } from '../../core/domain/money';
import type { AgendaItem, Member, PaymentMethod, PaymentReceipt } from '../../core/domain/models';
import { isTenantBlocked } from '../../core/domain/models';
import { readableError } from '../../core/firestore/errors';
import { AgendaService } from '../../core/services/agenda.service';
import { AuthService } from '../../core/services/auth.service';
import { CreditService } from '../../core/services/credit.service';
import { MemberService } from '../../core/services/member.service';
import { TenantContext } from '../../core/services/tenant-context';
import { ThermalPrinterService } from '../../core/services/thermal-printer.service';

@Component({
  selector: 'app-agenda',
  imports: [FormsModule],
  templateUrl: './agenda.html',
})
export class AgendaPage {
  private readonly agenda = inject(AgendaService);
  private readonly credits = inject(CreditService);
  private readonly members = inject(MemberService);
  private readonly auth = inject(AuthService);
  private readonly tenantContext = inject(TenantContext);
  readonly printer = inject(ThermalPrinterService);
  readonly formatCop = formatCop;
  readonly formatDate = formatBogotaDate;

  readonly items = signal<AgendaItem[]>([]);
  readonly fromCache = signal(false);
  readonly hasPendingWrites = signal(false);
  readonly loading = signal(true);
  readonly errorMessage = signal('');
  readonly infoMessage = signal('');
  readonly team = signal<Member[]>([]);
  readonly collectorFilter = signal('');
  readonly amounts = signal<Record<string, number>>({});
  readonly methods = signal<Record<string, PaymentMethod>>({});
  readonly savingId = signal<string | null>(null);
  readonly photos = signal<Record<string, File | null>>({});
  readonly lastReceipt = signal<PaymentReceipt | null>(null);

  readonly suspended = () => isTenantBlocked(this.tenantContext.tenant());
  readonly isCollector = () => this.auth.session()?.role === 'cobrador';

  constructor() {
    const destroyRef = inject(DestroyRef);
    let stopAgenda: (() => void) | null = null;
    let stopMembers: (() => void) | null = null;
    destroyRef.onDestroy(() => {
      stopAgenda?.();
      stopMembers?.();
    });

    void this.auth.ensureSession().then((session) => {
      if (!session?.tenantId || !session.role) {
        this.loading.set(false);
        this.errorMessage.set('No hay una sede activa en la sesión.');
        return;
      }
      const tenantId = session.tenantId;
      const role = session.role;
      const actorUid = session.uid;

      const listen = () => {
        stopAgenda?.();
        stopAgenda = this.agenda.watch({
          tenantId,
          role,
          actorUid,
          collectorUid: role === 'cobrador' ? actorUid : this.collectorFilter() || null,
          onData: (snapshot) => {
            this.items.set(snapshot.items);
            this.fromCache.set(snapshot.fromCache);
            this.hasPendingWrites.set(snapshot.hasPendingWrites);
            this.loading.set(false);
            this.amounts.update((current) => {
              const next = { ...current };
              for (const item of snapshot.items) {
                if (next[item.creditId] === undefined) {
                  next[item.creditId] = item.amountDueCop;
                }
              }
              return next;
            });
          },
          onError: (error) => {
            this.loading.set(false);
            this.errorMessage.set(readableError(error));
          },
        });
      };

      listen();
      this.collectorFilter.set('');
      if (role !== 'cobrador') {
        stopMembers = this.members.watch(
          tenantId,
          (team) => this.team.set(team.filter((member) => member.active)),
          (error) => this.errorMessage.set(readableError(error)),
        );
      }
      this.listen = listen;
    });
  }

  private listen: () => void = () => undefined;

  onCollectorChange(collectorUid: string): void {
    this.collectorFilter.set(collectorUid);
    this.loading.set(true);
    this.listen();
  }

  amountOf(item: AgendaItem): number {
    return this.amounts()[item.creditId] ?? item.amountDueCop;
  }

  methodOf(item: AgendaItem): PaymentMethod {
    return this.methods()[item.creditId] ?? 'efectivo';
  }

  setAmount(creditId: string, value: string): void {
    const parsed = Number(value);
    this.amounts.update((current) => ({ ...current, [creditId]: Number.isFinite(parsed) ? Math.round(parsed) : 0 }));
  }

  setPhoto(creditId: string, files: FileList | null): void {
    this.photos.update((current) => ({ ...current, [creditId]: files?.item(0) ?? null }));
  }

  setMethod(creditId: string, value: string): void {
    const method: PaymentMethod = value === 'transferencia' ? 'transferencia' : 'efectivo';
    this.methods.update((current) => ({ ...current, [creditId]: method }));
  }

  async collect(item: AgendaItem): Promise<void> {
    const session = this.auth.session();
    const tenant = this.tenantContext.tenant();
    if (!session?.tenantId || !session.role || this.suspended()) {
      return;
    }
    this.savingId.set(item.creditId);
    this.errorMessage.set('');
    this.infoMessage.set('');
    try {
      const receipt = await this.credits.registerPayment({
        tenantId: session.tenantId,
        businessName: tenant?.name || 'Cobranzas',
        actorUid: session.uid,
        actorName: session.displayName || session.email || 'Cobrador',
        actorRole: session.role,
        creditId: item.creditId,
        amountCop: this.amountOf(item),
        method: this.methodOf(item),
        evidencePhoto: this.photos()[item.creditId] ?? null,
      });
      this.lastReceipt.set(receipt);
      this.infoMessage.set(
        this.fromCache()
          ? 'Pago guardado en este dispositivo. Se sincronizará al recuperar la conexión.'
          : `Pago registrado. Recibo ${receipt.receiptNumber}.`,
      );
    } catch (error) {
      this.errorMessage.set(readableError(error));
    } finally {
      this.savingId.set(null);
    }
  }

  async printBluetooth(): Promise<void> {
    const receipt = this.lastReceipt();
    if (!receipt) {
      return;
    }
    this.errorMessage.set('');
    try {
      await this.printer.printViaBluetooth(receipt);
    } catch (error) {
      this.errorMessage.set(readableError(error));
    }
  }

  printBrowser(): void {
    const receipt = this.lastReceipt();
    if (!receipt) {
      return;
    }
    try {
      this.printer.printViaBrowser(receipt);
    } catch (error) {
      this.errorMessage.set(readableError(error));
    }
  }

  statusClass(status: AgendaItem['status']): string {
    if (status === 'pagado') return 'chip chip-ok';
    if (status === 'en_mora') return 'chip chip-warn';
    return 'chip chip-info';
  }

  statusLabel(status: AgendaItem['status']): string {
    if (status === 'pagado') return 'Pagado';
    if (status === 'en_mora') return 'En mora';
    return 'Pendiente';
  }
}
