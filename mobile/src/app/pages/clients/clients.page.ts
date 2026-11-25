import { Component, effect, inject, signal } from '@angular/core';
import { FormBuilder, ReactiveFormsModule, Validators } from '@angular/forms';
import { IonicModule } from '@ionic/angular/lazy';
import type { Client, StoredUser } from '../../core/domain/models';
import { errorText } from '../../core/media';
import { AuthService } from '../../core/services/auth.service';
import { DataService } from '../../core/services/data.service';

@Component({
  selector: 'app-clients',
  templateUrl: './clients.page.html',
  imports: [IonicModule, ReactiveFormsModule],
})
export class ClientsPage {
  private readonly data = inject(DataService);
  private readonly auth = inject(AuthService);
  private readonly formBuilder = inject(FormBuilder);
  readonly items = signal<Client[]>([]);
  readonly team = signal<StoredUser[]>([]);
  readonly errorMessage = signal('');
  readonly infoMessage = signal('');
  readonly saving = signal(false);
  readonly editingId = signal<string | null>(null);

  readonly form = this.formBuilder.nonNullable.group({
    fullName: ['', [Validators.required, Validators.minLength(3)]],
    documentNumber: ['', [Validators.required, Validators.minLength(5)]],
    phone: [''],
    address: [''],
    neighborhood: [''],
    notes: [''],
    collectorUid: ['', Validators.required],
    routeOrder: [1, [Validators.required, Validators.min(1)]],
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
    this.items.set(await this.data.clients(session.tenantId));
    const team = (await this.data.team(session.tenantId)).filter((member) => member.active);
    this.team.set(team);
    if (!this.form.controls.collectorUid.value && session.role === 'independiente') {
      this.form.controls.collectorUid.setValue(session.uid);
    }
  }

  edit(client: Client): void {
    this.editingId.set(client.id);
    this.form.setValue({
      fullName: client.fullName,
      documentNumber: client.documentNumber,
      phone: client.phone,
      address: client.address,
      neighborhood: client.neighborhood,
      notes: client.notes,
      collectorUid: client.collectorUid,
      routeOrder: client.routeOrder,
    });
  }

  reset(): void {
    this.editingId.set(null);
    this.form.reset({
      fullName: '',
      documentNumber: '',
      phone: '',
      address: '',
      neighborhood: '',
      notes: '',
      collectorUid: this.auth.session()?.role === 'independiente' ? this.auth.session()?.uid ?? '' : '',
      routeOrder: 1,
    });
  }

  async save(): Promise<void> {
    const session = this.auth.session();
    if (!session?.tenantId || this.form.invalid) {
      this.form.markAllAsTouched();
      return;
    }
    this.saving.set(true);
    this.errorMessage.set('');
    try {
      const value = this.form.getRawValue();
      await this.data.saveClient(session.tenantId, session.uid, {
        ...value,
        routeOrder: Number(value.routeOrder),
      }, this.editingId() ?? undefined);
      this.infoMessage.set(this.editingId() ? 'Cliente actualizado.' : 'Cliente creado.');
      if (!this.editingId()) {
        this.reset();
      }
    } catch (error) {
      this.errorMessage.set(errorText(error));
    } finally {
      this.saving.set(false);
    }
  }

  async deactivate(client: Client): Promise<void> {
    const session = this.auth.session();
    if (!session?.tenantId) {
      return;
    }
    try {
      await this.data.deactivateClient(session.tenantId, client.id);
      this.infoMessage.set('Cliente desactivado. Su historial de créditos se conserva.');
    } catch (error) {
      this.errorMessage.set(errorText(error));
    }
  }
}
