import { Component, effect, inject, signal } from '@angular/core';
import { FormBuilder, ReactiveFormsModule, Validators } from '@angular/forms';
import { IonicModule } from '@ionic/angular/lazy';
import { formatBogotaDate } from '../../core/domain/bogota-date';
import { formatCop } from '../../core/domain/money';
import type { BillingCycle, StoredUser, Tenant, TenantType, UserRole } from '../../core/domain/models';
import { errorText } from '../../core/media';
import { DataService } from '../../core/services/data.service';

type RoleChoice = 'none' | UserRole;

@Component({
  selector: 'app-platform',
  templateUrl: './platform.page.html',
  imports: [IonicModule, ReactiveFormsModule],
})
export class PlatformPage {
  private readonly data = inject(DataService);
  private readonly formBuilder = inject(FormBuilder);
  readonly tenants = signal<Tenant[]>([]);
  readonly users = signal<StoredUser[]>([]);
  readonly section = signal<'usuarios' | 'sedes'>('usuarios');
  readonly errorMessage = signal('');
  readonly infoMessage = signal('');
  readonly saving = signal(false);
  readonly formatCop = formatCop;
  readonly formatDate = formatBogotaDate;

  readonly userForm = this.formBuilder.nonNullable.group({
    displayName: ['', Validators.required],
    email: ['', [Validators.required, Validators.email]],
    phone: [''],
    password: ['', Validators.minLength(6)],
    role: this.formBuilder.nonNullable.control<RoleChoice>('oficina_admin'),
    tenantId: [''],
  });

  readonly tenantForm = this.formBuilder.nonNullable.group({
    name: ['', Validators.required],
    type: this.formBuilder.nonNullable.control<TenantType>('oficina'),
    city: [''],
    phone: [''],
    capitalCop: [0, [Validators.required, Validators.min(0)]],
    cycle: this.formBuilder.nonNullable.control<BillingCycle>('mensual'),
    amountCop: [0, [Validators.required, Validators.min(0)]],
  });

  constructor() {
    effect(() => {
      this.data.revision();
      void this.reload();
    });
  }

  async reload(): Promise<void> {
    this.tenants.set(await this.data.tenants());
    this.users.set(await this.data.users());
  }

  show(section: 'usuarios' | 'sedes'): void {
    this.section.set(section);
  }

  async saveUser(): Promise<void> {
    if (this.userForm.invalid) {
      this.userForm.markAllAsTouched();
      return;
    }
    this.saving.set(true);
    this.errorMessage.set('');
    try {
      const value = this.userForm.getRawValue();
      const role = value.role === 'none' ? null : value.role;
      await this.data.createUser({
        displayName: value.displayName,
        email: value.email,
        phone: value.phone,
        password: value.password,
        role,
        tenantId: value.tenantId || null,
        active: true,
      });
      this.infoMessage.set('Usuario guardado en este teléfono.');
      this.userForm.reset({ displayName: '', email: '', phone: '', password: '', role: 'oficina_admin', tenantId: '' });
    } catch (error) {
      this.errorMessage.set(errorText(error));
    } finally {
      this.saving.set(false);
    }
  }

  async saveTenant(): Promise<void> {
    if (this.tenantForm.invalid) {
      this.tenantForm.markAllAsTouched();
      return;
    }
    this.saving.set(true);
    this.errorMessage.set('');
    try {
      const value = this.tenantForm.getRawValue();
      await this.data.saveTenant({
        ...value,
        capitalCop: Number(value.capitalCop),
        amountCop: Number(value.amountCop),
      });
      this.infoMessage.set('Sede guardada en este teléfono.');
      this.tenantForm.reset({ name: '', type: 'oficina', city: '', phone: '', capitalCop: 0, cycle: 'mensual', amountCop: 0 });
    } catch (error) {
      this.errorMessage.set(errorText(error));
    } finally {
      this.saving.set(false);
    }
  }

  async toggle(tenant: Tenant): Promise<void> {
    try {
      await this.data.setTenantAccess(tenant.id, tenant.status === 'suspendido' ? 'activo' : 'suspendido');
      this.infoMessage.set(tenant.status === 'suspendido' ? 'Sede habilitada.' : 'Sede suspendida.');
    } catch (error) {
      this.errorMessage.set(errorText(error));
    }
  }

  async renew(tenant: Tenant): Promise<void> {
    try {
      await this.data.registerSubscriptionPayment(tenant.id, tenant.subscription.cycle);
      this.infoMessage.set('Suscripción renovada en este teléfono.');
    } catch (error) {
      this.errorMessage.set(errorText(error));
    }
  }
}
