import { Component, DestroyRef, inject, signal } from '@angular/core';
import { FormBuilder, ReactiveFormsModule, Validators } from '@angular/forms';
import { readableError } from '../../core/firestore/errors';
import { AuthService } from '../../core/services/auth.service';
import { ClientService } from '../../core/services/client.service';
import { MemberService } from '../../core/services/member.service';
import type { Client, Member } from '../../core/domain/models';

@Component({
  selector: 'app-clients',
  imports: [ReactiveFormsModule],
  templateUrl: './clients.html',
})
export class ClientsPage {
  private readonly clients = inject(ClientService);
  private readonly members = inject(MemberService);
  private readonly auth = inject(AuthService);
  private readonly formBuilder = inject(FormBuilder);

  readonly items = signal<Client[]>([]);
  readonly team = signal<Member[]>([]);
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
    const destroyRef = inject(DestroyRef);
    let stopClients: (() => void) | null = null;
    let stopMembers: (() => void) | null = null;
    destroyRef.onDestroy(() => {
      stopClients?.();
      stopMembers?.();
    });
    const session = this.auth.session();
    if (!session?.tenantId) {
      return;
    }
    stopClients = this.clients.watchActive(
      session.tenantId,
      (items) => this.items.set(items),
      (error) => this.errorMessage.set(readableError(error)),
    );
    stopMembers = this.members.watch(
      session.tenantId,
      (team) => {
        this.team.set(team.filter((member) => member.active));
        if (!this.form.controls.collectorUid.value && session.role === 'independiente') {
          this.form.controls.collectorUid.setValue(session.uid);
        }
      },
      (error) => this.errorMessage.set(readableError(error)),
    );
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
      if (this.editingId()) {
        await this.clients.update(session.tenantId, this.editingId()!, value);
        this.infoMessage.set('Cliente actualizado.');
      } else {
        await this.clients.create(session.tenantId, session.uid, value);
        this.infoMessage.set('Cliente creado.');
        this.reset();
      }
    } catch (error) {
      this.errorMessage.set(readableError(error));
    } finally {
      this.saving.set(false);
    }
  }

  async deactivate(client: Client): Promise<void> {
    const session = this.auth.session();
    if (!session?.tenantId) {
      return;
    }
    this.errorMessage.set('');
    try {
      await this.clients.deactivate(session.tenantId, client.id);
      this.infoMessage.set('Cliente desactivado. Su historial de créditos se conserva.');
    } catch (error) {
      this.errorMessage.set(readableError(error));
    }
  }
}
