import { Component, effect, inject, signal } from '@angular/core';
import { FormBuilder, ReactiveFormsModule, Validators } from '@angular/forms';
import { IonicModule } from '@ionic/angular/lazy';
import { bogotaDateKey } from '../../core/domain/bogota-date';
import { buildCreditSchedule } from '../../core/domain/credit-schedule';
import { formatCop } from '../../core/domain/money';
import type { Client, CreditFrequency } from '../../core/domain/models';
import { isTenantBlocked } from '../../core/domain/models';
import { errorText, readEvidenceFile } from '../../core/media';
import { AuthService } from '../../core/services/auth.service';
import { DataService } from '../../core/services/data.service';

@Component({
  selector: 'app-credit',
  templateUrl: './credit.page.html',
  imports: [IonicModule, ReactiveFormsModule],
})
export class CreditPage {
  private readonly data = inject(DataService);
  private readonly auth = inject(AuthService);
  private readonly formBuilder = inject(FormBuilder);
  readonly clients = signal<Client[]>([]);
  readonly documents = signal<string[]>([]);
  readonly acceptanceVideo = signal<string | null>(null);
  readonly saving = signal(false);
  readonly suspended = signal(false);
  readonly errorMessage = signal('');
  readonly infoMessage = signal('');

  readonly form = this.formBuilder.nonNullable.group({
    clientId: ['', Validators.required],
    principalCop: [100000, [Validators.required, Validators.min(1)]],
    interestRatePercent: [20, [Validators.required, Validators.min(0)]],
    frequency: this.formBuilder.nonNullable.control<CreditFrequency>('semanal', Validators.required),
    installmentsCount: [12, [Validators.required, Validators.min(1), Validators.max(366)]],
    startDate: [bogotaDateKey(new Date()), Validators.required],
  });

  constructor() {
    effect(() => {
      this.data.revision();
      void this.reload();
    });
  }

  async reload(): Promise<void> {
    const session = this.auth.session();
    if (!session?.tenantId) {
      return;
    }
    this.clients.set(await this.data.clients(session.tenantId));
    const tenant = await this.data.tenant(session.tenantId);
    this.suspended.set(isTenantBlocked(tenant));
  }

  preview(): string {
    const value = this.form.getRawValue();
    try {
      const schedule = buildCreditSchedule({
        principalCop: Math.round(Number(value.principalCop)),
        interestRatePercent: Number(value.interestRatePercent),
        installmentsCount: Math.round(Number(value.installmentsCount)),
        frequency: value.frequency,
        startDate: new Date(`${value.startDate}T12:00:00`),
      });
      return `${schedule.installments.length} cuotas desde ${formatCop(schedule.installmentAmountCop)}. Total a cobrar ${formatCop(schedule.totalToCollectCop)}.`;
    } catch (error) {
      return errorText(error);
    }
  }

  async onDocuments(files: FileList | null): Promise<void> {
    if (!files) {
      this.documents.set([]);
      return;
    }
    try {
      const urls = await Promise.all(Array.from(files).map((file) => readEvidenceFile(file)));
      this.documents.set(urls);
    } catch (error) {
      this.errorMessage.set(errorText(error));
    }
  }

  async onVideo(files: FileList | null): Promise<void> {
    const file = files?.item(0);
    if (!file) {
      this.acceptanceVideo.set(null);
      return;
    }
    try {
      this.acceptanceVideo.set(await readEvidenceFile(file));
    } catch (error) {
      this.errorMessage.set(errorText(error));
    }
  }

  async save(): Promise<void> {
    const session = this.auth.session();
    if (!session?.tenantId || !session.role || this.form.invalid || this.suspended()) {
      this.form.markAllAsTouched();
      return;
    }
    const client = this.clients().find((item) => item.id === this.form.controls.clientId.value);
    if (!client) {
      this.errorMessage.set('Selecciona un cliente.');
      return;
    }
    this.saving.set(true);
    this.errorMessage.set('');
    this.infoMessage.set('');
    try {
      const value = this.form.getRawValue();
      const creditId = await this.data.createCredit(session.tenantId, {
        actorUid: session.uid,
        actorRole: session.role,
        client,
        principalCop: Math.round(Number(value.principalCop)),
        interestRatePercent: Number(value.interestRatePercent),
        frequency: value.frequency,
        installmentsCount: Math.round(Number(value.installmentsCount)),
        startDate: new Date(`${value.startDate}T12:00:00`),
        documents: this.documents(),
        acceptanceVideoUrl: this.acceptanceVideo(),
      });
      this.infoMessage.set(`Crédito creado en este teléfono (${creditId.slice(0, 8)}).`);
      this.documents.set([]);
      this.acceptanceVideo.set(null);
    } catch (error) {
      this.errorMessage.set(errorText(error));
    } finally {
      this.saving.set(false);
    }
  }
}
