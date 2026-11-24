import { Component, DestroyRef, inject, signal } from '@angular/core';
import { FormBuilder, ReactiveFormsModule, Validators } from '@angular/forms';
import { bogotaDateKey } from '../../core/domain/bogota-date';
import { buildCreditSchedule } from '../../core/domain/credit-schedule';
import { formatCop } from '../../core/domain/money';
import type { Client, CreditFrequency } from '../../core/domain/models';
import { readableError } from '../../core/firestore/errors';
import { AuthService } from '../../core/services/auth.service';
import { ClientService } from '../../core/services/client.service';
import { CreditService } from '../../core/services/credit.service';

@Component({
  selector: 'app-credit-form',
  imports: [ReactiveFormsModule],
  templateUrl: './credit-form.html',
})
export class CreditFormPage {
  private readonly credits = inject(CreditService);
  private readonly clients = inject(ClientService);
  private readonly auth = inject(AuthService);
  private readonly formBuilder = inject(FormBuilder);

  readonly customerList = signal<Client[]>([]);
  readonly documents = signal<File[]>([]);
  readonly acceptanceVideo = signal<File | null>(null);
  readonly progress = signal(0);
  readonly saving = signal(false);
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
    const destroyRef = inject(DestroyRef);
    const session = this.auth.session();
    if (!session?.tenantId) {
      return;
    }
    const stop = this.clients.watchActive(
      session.tenantId,
      (items) => this.customerList.set(items),
      (error) => this.errorMessage.set(readableError(error)),
    );
    destroyRef.onDestroy(stop);
  }

  preview(): string {
    const value = this.form.getRawValue();
    try {
      const schedule = buildCreditSchedule({
        principalCop: Math.round(value.principalCop),
        interestRatePercent: value.interestRatePercent,
        installmentsCount: Math.round(value.installmentsCount),
        frequency: value.frequency,
        startDate: new Date(`${value.startDate}T12:00:00`),
      });
      return `${schedule.installments.length} cuotas desde ${formatCop(schedule.installmentAmountCop)}. Total a cobrar ${formatCop(schedule.totalToCollectCop)}.`;
    } catch (error) {
      return readableError(error);
    }
  }

  onDocuments(files: FileList | null): void {
    this.documents.set(files ? Array.from(files) : []);
  }

  onVideo(files: FileList | null): void {
    this.acceptanceVideo.set(files?.item(0) ?? null);
  }

  async save(): Promise<void> {
    const session = this.auth.session();
    if (!session?.tenantId || !session.role || this.form.invalid) {
      this.form.markAllAsTouched();
      return;
    }
    const client = this.customerList().find((item) => item.id === this.form.controls.clientId.value);
    if (!client) {
      this.errorMessage.set('Selecciona un cliente.');
      return;
    }
    this.saving.set(true);
    this.progress.set(0);
    this.errorMessage.set('');
    this.infoMessage.set('');
    try {
      const value = this.form.getRawValue();
      const creditId = await this.credits.createCredit({
        tenantId: session.tenantId,
        actorUid: session.uid,
        actorRole: session.role,
        client,
        principalCop: Math.round(value.principalCop),
        interestRatePercent: value.interestRatePercent,
        frequency: value.frequency,
        installmentsCount: Math.round(value.installmentsCount),
        startDate: new Date(`${value.startDate}T12:00:00`),
        documents: this.documents(),
        acceptanceVideo: this.acceptanceVideo(),
        onProgress: (ratio) => this.progress.set(Math.round(ratio * 100)),
      });
      this.infoMessage.set(`Crédito ${creditId} creado.`);
      this.documents.set([]);
      this.acceptanceVideo.set(null);
      this.progress.set(0);
    } catch (error) {
      this.errorMessage.set(readableError(error));
    } finally {
      this.saving.set(false);
    }
  }
}
