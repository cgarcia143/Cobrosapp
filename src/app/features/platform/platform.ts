import { Component, DestroyRef, inject, signal } from '@angular/core';
import { FormBuilder, ReactiveFormsModule, Validators } from '@angular/forms';
import { formatBogotaDate } from '../../core/domain/bogota-date';
import { formatCop } from '../../core/domain/money';
import type { Tenant, UserRole } from '../../core/domain/models';
import { readableError } from '../../core/firestore/errors';
import { PlatformService, type PlatformUser } from '../../core/services/platform.service';

type PanelSection = 'usuarios' | 'sedes';
type RoleChoice = 'none' | UserRole;

@Component({
  selector: 'app-platform',
  imports: [ReactiveFormsModule],
  templateUrl: './platform.html',
})
export class PlatformPage {
  private readonly platform = inject(PlatformService);
  private readonly formBuilder = inject(FormBuilder);
  readonly tenants = signal<Tenant[]>([]);
  readonly users = signal<PlatformUser[]>([]);
  readonly section = signal<PanelSection>('usuarios');
  readonly editingUserId = signal<string | null>(null);
  readonly editingTenantId = signal<string | null>(null);
  readonly roleNeedsTenant = signal(false);
  readonly errorMessage = signal('');
  readonly infoMessage = signal('');
  readonly savingUser = signal(false);
  readonly savingTenant = signal(false);
  readonly formatCop = formatCop;
  readonly formatDate = formatBogotaDate;

  readonly userForm = this.formBuilder.nonNullable.group({
    displayName: ['', Validators.required],
    email: ['', [Validators.required, Validators.email]],
    phone: [''],
    password: [''],
    role: this.formBuilder.nonNullable.control<RoleChoice>('none'),
    tenantId: [''],
    active: this.formBuilder.nonNullable.control<'activo' | 'inactivo'>('activo'),
  });

  readonly form = this.formBuilder.nonNullable.group({
    name: ['', Validators.required],
    type: this.formBuilder.nonNullable.control<'oficina' | 'independiente'>('oficina'),
    city: [''],
    phone: [''],
    capitalCop: [0, [Validators.required, Validators.min(0)]],
    cycle: this.formBuilder.nonNullable.control<'mensual' | 'anual'>('mensual'),
    amountCop: [0, [Validators.required, Validators.min(0)]],
  });

  constructor() {
    const destroyRef = inject(DestroyRef);
    const stopTenants = this.platform.watchTenants(
      (tenants) => this.tenants.set(tenants),
      (error) => this.errorMessage.set(readableError(error)),
    );
    const stopUsers = this.platform.watchUsers(
      (users) => this.users.set(users),
      (error) => this.errorMessage.set(readableError(error)),
    );
    destroyRef.onDestroy(() => {
      stopTenants();
      stopUsers();
    });
  }

  show(section: PanelSection): void {
    this.section.set(section);
  }

  syncRole(): void {
    const role = this.userForm.controls.role.value;
    const needsTenant = role === 'oficina_admin' || role === 'independiente' || role === 'cobrador';
    this.roleNeedsTenant.set(needsTenant);
    if (!needsTenant) {
      this.userForm.controls.tenantId.setValue('');
    }
  }

  editUser(user: PlatformUser): void {
    this.section.set('usuarios');
    this.editingUserId.set(user.uid);
    this.userForm.reset({
      displayName: user.displayName,
      email: user.email,
      phone: user.phone,
      password: '',
      role: user.role ?? 'none',
      tenantId: user.tenantId ?? '',
      active: user.active ? 'activo' : 'inactivo',
    });
    this.syncRole();
  }

  resetUserForm(): void {
    this.editingUserId.set(null);
    this.roleNeedsTenant.set(false);
    this.userForm.reset({
      displayName: '',
      email: '',
      phone: '',
      password: '',
      role: 'none',
      tenantId: '',
      active: 'activo',
    });
  }

  async saveUser(): Promise<void> {
    if (this.userForm.invalid) {
      this.userForm.markAllAsTouched();
      return;
    }
    this.savingUser.set(true);
    this.errorMessage.set('');
    try {
      const value = this.userForm.getRawValue();
      await this.platform.saveUser({
        uid: this.editingUserId(),
        email: value.email,
        displayName: value.displayName,
        phone: value.phone,
        password: value.password,
        role: value.role === 'none' ? null : value.role,
        tenantId: value.tenantId || null,
        active: value.active === 'activo',
      });
      this.infoMessage.set(this.editingUserId() ? 'Usuario actualizado.' : 'Usuario guardado.');
      this.resetUserForm();
    } catch (error) {
      this.errorMessage.set(readableError(error));
    } finally {
      this.savingUser.set(false);
    }
  }

  async toggleUser(user: PlatformUser): Promise<void> {
    this.errorMessage.set('');
    try {
      await this.platform.setUserActive(user, !user.active);
      this.infoMessage.set(user.active ? 'Usuario desactivado.' : 'Usuario activado.');
    } catch (error) {
      this.errorMessage.set(readableError(error));
    }
  }

  editTenant(tenant: Tenant): void {
    this.section.set('sedes');
    this.editingTenantId.set(tenant.id);
    this.form.reset({
      name: tenant.name,
      type: tenant.type,
      city: tenant.city,
      phone: tenant.phone,
      capitalCop: tenant.capitalCop,
      cycle: tenant.subscription.cycle,
      amountCop: tenant.subscription.amountCop,
    });
  }

  resetTenantForm(): void {
    this.editingTenantId.set(null);
    this.form.reset({
      type: 'oficina',
      cycle: 'mensual',
      capitalCop: 0,
      amountCop: 0,
      name: '',
      city: '',
      phone: '',
    });
  }

  async create(): Promise<void> {
    const editingId = this.editingTenantId();
    if (!editingId && this.form.invalid) {
      this.form.markAllAsTouched();
      return;
    }
    if (editingId && this.form.controls.name.invalid) {
      this.form.controls.name.markAsTouched();
      return;
    }
    this.savingTenant.set(true);
    this.errorMessage.set('');
    try {
      const value = this.form.getRawValue();
      if (editingId) {
        await this.platform.updateTenantProfile(editingId, {
          name: value.name,
          city: value.city,
          phone: value.phone,
          capitalCop: Math.round(value.capitalCop),
        });
        this.infoMessage.set('Sede actualizada.');
      } else {
        await this.platform.createTenant({
          ...value,
          capitalCop: Math.round(value.capitalCop),
          amountCop: Math.round(value.amountCop),
        });
        this.infoMessage.set('Sede creada. Asigna las personas desde Usuarios.');
      }
      this.resetTenantForm();
    } catch (error) {
      this.errorMessage.set(readableError(error));
    } finally {
      this.savingTenant.set(false);
    }
  }

  async setAccess(tenant: Tenant, status: 'activo' | 'suspendido'): Promise<void> {
    this.errorMessage.set('');
    try {
      await this.platform.setTenantAccess(tenant.id, status);
      this.infoMessage.set(status === 'suspendido' ? 'Sede suspendida.' : 'Sede habilitada.');
    } catch (error) {
      this.errorMessage.set(readableError(error));
    }
  }

  async registerPayment(tenant: Tenant): Promise<void> {
    this.errorMessage.set('');
    try {
      await this.platform.registerSubscriptionPayment(tenant.id, tenant.subscription.amountCop);
      this.infoMessage.set('Pago de suscripción registrado y vigencia extendida.');
    } catch (error) {
      this.errorMessage.set(readableError(error));
    }
  }

  roleLabel(role: UserRole | null): string {
    if (role === 'super_admin') return 'Super administrador';
    if (role === 'oficina_admin') return 'Administrador de oficina';
    if (role === 'independiente') return 'Independiente';
    if (role === 'cobrador') return 'Cobrador';
    return 'Sin rol';
  }

  tenantName(tenantId: string | null): string {
    if (!tenantId) return 'Sin sede';
    return this.tenants().find((tenant) => tenant.id === tenantId)?.name ?? 'Sede no disponible';
  }

  ownerName(tenant: Tenant): string {
    const linked = this.users().find(
      (user) =>
        user.tenantId === tenant.id && (user.role === 'oficina_admin' || user.role === 'independiente'),
    );
    return linked?.displayName || 'Sin asignar';
  }

  statusLabel(status: Tenant['status']): string {
    if (status === 'suspendido') return 'Suspendida';
    if (status === 'activo') return 'Activa';
    return 'Prueba';
  }

  typeLabel(type: Tenant['type']): string {
    return type === 'independiente' ? 'Independiente' : 'Oficina';
  }
}
