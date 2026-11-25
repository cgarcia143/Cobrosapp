import { Component, computed, effect, inject, signal } from '@angular/core';
import { Router } from '@angular/router';
import { IonicModule } from '@ionic/angular/lazy';
import { formatBogotaDate } from '../../core/domain/bogota-date';
import { isTenantBlocked, type Tenant } from '../../core/domain/models';
import { AuthService } from '../../core/services/auth.service';
import { DataService } from '../../core/services/data.service';

@Component({
  selector: 'app-shell',
  templateUrl: './shell.page.html',
  imports: [IonicModule],
})
export class ShellPage {
  private readonly router = inject(Router);
  private readonly data = inject(DataService);
  readonly auth = inject(AuthService);
  readonly tenant = signal<Tenant | null>(null);
  readonly formatDate = formatBogotaDate;

  readonly links = computed(() => {
    const role = this.auth.session()?.role;
    if (role === 'super_admin') {
      return [{ path: '/plataforma', tab: 'plataforma', label: 'Plataforma' }];
    }
    const items = [{ path: '/agenda', tab: 'agenda', label: 'Ruta' }];
    if (role === 'oficina_admin' || role === 'independiente') {
      items.push(
        { path: '/clientes', tab: 'clientes', label: 'Clientes' },
        { path: '/creditos/nuevo', tab: 'creditos', label: 'Crédito' },
        { path: '/reportes', tab: 'reportes', label: 'Reportes' },
      );
    }
    if (role === 'oficina_admin') {
      items.push({ path: '/equipo', tab: 'equipo', label: 'Equipo' });
    }
    return items;
  });

  readonly suspended = computed(() => isTenantBlocked(this.tenant()));

  constructor() {
    effect(() => {
      this.data.revision();
      const tenantId = this.auth.session()?.tenantId;
      if (!tenantId) {
        this.tenant.set(null);
        return;
      }
      void this.data.tenant(tenantId).then((tenant) => this.tenant.set(tenant));
    });
  }

  signOut(): void {
    this.auth.signOut();
    void this.router.navigateByUrl('/ingreso');
  }
}
