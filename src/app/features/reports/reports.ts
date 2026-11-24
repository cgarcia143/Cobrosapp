import { Component, inject, signal } from '@angular/core';
import { FormBuilder, ReactiveFormsModule, Validators } from '@angular/forms';
import { formatCop } from '../../core/domain/money';
import type { MonthlyReport } from '../../core/domain/models';
import { readableError } from '../../core/firestore/errors';
import { AuthService } from '../../core/services/auth.service';
import { ReportsService } from '../../core/services/reports.service';
import { TenantContext } from '../../core/services/tenant-context';

@Component({
  selector: 'app-reports',
  imports: [ReactiveFormsModule],
  templateUrl: './reports.html',
})
export class ReportsPage {
  private readonly reports = inject(ReportsService);
  private readonly auth = inject(AuthService);
  private readonly formBuilder = inject(FormBuilder);
  readonly tenantContext = inject(TenantContext);
  readonly formatCop = formatCop;
  readonly report = signal<MonthlyReport | null>(null);
  readonly errorMessage = signal('');
  readonly infoMessage = signal('');
  readonly loading = signal(false);

  readonly capitalForm = this.formBuilder.nonNullable.group({
    capitalCop: [0, [Validators.required, Validators.min(0)]],
  });

  constructor() {
    const capital = this.tenantContext.tenant()?.capitalCop ?? 0;
    this.capitalForm.controls.capitalCop.setValue(capital);
    void this.load();
  }

  async load(): Promise<void> {
    const tenantId = this.auth.session()?.tenantId;
    if (!tenantId) {
      return;
    }
    this.loading.set(true);
    this.errorMessage.set('');
    try {
      this.report.set(await this.reports.loadMonth(tenantId, new Date()));
    } catch (error) {
      this.errorMessage.set(readableError(error));
    } finally {
      this.loading.set(false);
    }
  }

  async saveCapital(): Promise<void> {
    const tenantId = this.auth.session()?.tenantId;
    if (!tenantId || this.capitalForm.invalid) {
      return;
    }
    this.errorMessage.set('');
    try {
      await this.reports.updateCapital(tenantId, Math.round(this.capitalForm.controls.capitalCop.value));
      this.infoMessage.set('Capital de la sede actualizado.');
    } catch (error) {
      this.errorMessage.set(readableError(error));
    }
  }
}
