import { Component, effect, inject, signal } from '@angular/core';
import { FormBuilder, ReactiveFormsModule, Validators } from '@angular/forms';
import { IonicModule } from '@ionic/angular/lazy';
import type { StoredUser } from '../../core/domain/models';
import { errorText } from '../../core/media';
import { AuthService } from '../../core/services/auth.service';
import { DataService } from '../../core/services/data.service';

@Component({
  selector: 'app-team',
  templateUrl: './team.page.html',
  imports: [IonicModule, ReactiveFormsModule],
})
export class TeamPage {
  private readonly data = inject(DataService);
  private readonly auth = inject(AuthService);
  private readonly formBuilder = inject(FormBuilder);
  readonly team = signal<StoredUser[]>([]);
  readonly errorMessage = signal('');
  readonly infoMessage = signal('');
  readonly saving = signal(false);

  readonly form = this.formBuilder.nonNullable.group({
    displayName: ['', Validators.required],
    email: ['', [Validators.required, Validators.email]],
    phone: [''],
    password: ['', [Validators.required, Validators.minLength(6)]],
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
    this.team.set(await this.data.team(tenantId));
  }

  async invite(): Promise<void> {
    const tenantId = this.auth.session()?.tenantId;
    if (!tenantId || this.form.invalid) {
      this.form.markAllAsTouched();
      return;
    }
    this.saving.set(true);
    this.errorMessage.set('');
    try {
      await this.data.createCollector(tenantId, this.form.getRawValue());
      this.infoMessage.set('Cobrador creado en este teléfono. Comparte la contraseña con esa persona.');
      this.form.reset();
    } catch (error) {
      this.errorMessage.set(errorText(error));
    } finally {
      this.saving.set(false);
    }
  }
}
