import { Component, effect, inject, signal } from '@angular/core';
import { FormBuilder, ReactiveFormsModule, Validators } from '@angular/forms';
import { IonicModule } from '@ionic/angular/lazy';
import { formatCop } from '../../core/domain/money';
import type { MonthlyReport } from '../../core/domain/models';
import { errorText } from '../../core/media';
import { AuthService } from '../../core/services/auth.service';
import { DataService } from '../../core/services/data.service';

@Component({
  selector: 'app-reports',
  templateUrl: './reports.page.html',
  imports: [IonicModule, ReactiveFormsModule],
})
export class ReportsPage {
  private readonly data = inject(DataService);
  private readonly auth = inject(AuthService);
  private readonly formBuilder = inject(FormBuilder);
  readonly formatCop = formatCop;
  readonly report = signal<MonthlyReport | null>(null);
  readonly errorMessage = signal('');
  readonly infoMessage = signal('');
  readonly saving = signal(false);

  readonly capitalForm = this.formBuilder.nonNullable.group({
    capitalCop: [0, [Validators.required, Validators.min(0)]],
  });

  constructor() {
    effect(() => {
      this.data.revision();
      void this.reload();
    });
  }

  async reload(): Promise<void> {
    const tenantId = this.auth.session()?.tenantId;
    if (!tenantId) {
      return;
    }
    const tenant = await this.data.tenant(tenantId);
    if (tenant && !this.capitalForm.dirty) {
      this.capitalForm.controls.capitalCop.setValue(tenant.capitalCop);
    }
    this.report.set(await this.data.monthlyReport(tenantId, new Date()));
  }

  async saveCapital(): Promise<void> {
    const tenantId = this.auth.session()?.tenantId;
    if (!tenantId || this.capitalForm.invalid) {
      return;
    }
    this.saving.set(true);
    this.errorMessage.set('');
    try {
      await this.data.updateCapital(tenantId, Math.round(Number(this.capitalForm.controls.capitalCop.value)));
      this.capitalForm.markAsPristine();
      this.infoMessage.set('Capital de la sede actualizado en este teléfono.');
    } catch (error) {
      this.errorMessage.set(errorText(error));
    } finally {
      this.saving.set(false);
    }
  }
}
