import { Component, DestroyRef, computed, inject } from '@angular/core';
import { Router, RouterLink, RouterLinkActive, RouterOutlet } from '@angular/router';
import { formatBogotaDate } from '../../core/domain/bogota-date';
import { isTenantBlocked } from '../../core/domain/models';
import { AuthService } from '../../core/services/auth.service';
import { TenantContext } from '../../core/services/tenant-context';

@Component({
  selector: 'app-shell',
  imports: [RouterOutlet, RouterLink, RouterLinkActive],
  templateUrl: './shell.html',
  host: { class: 'flex flex-1 flex-col' },
})
export class ShellPage {
  private readonly router = inject(Router);
  readonly auth = inject(AuthService);
  readonly tenantContext = inject(TenantContext);
  readonly formatDate = formatBogotaDate;

  readonly links = computed(() => {
    const role = this.auth.session()?.role;
    if (role === 'super_admin') {
      return [{ path: '/plataforma', label: 'Plataforma' }];
    }
    const items = [{ path: '/agenda', label: 'Ruta' }];
    if (role === 'oficina_admin' || role === 'independiente') {
      items.push(
        { path: '/clientes', label: 'Clientes' },
        { path: '/creditos/nuevo', label: 'Crédito' },
        { path: '/reportes', label: 'Reportes' },
      );
    }
    if (role === 'oficina_admin') {
      items.push({ path: '/equipo', label: 'Equipo' });
    }
    return items;
  });

  readonly suspended = computed(() => isTenantBlocked(this.tenantContext.tenant()));

  constructor() {
    inject(DestroyRef).onDestroy(() => this.tenantContext.stop());
    const tenantId = this.auth.session()?.tenantId;
    if (tenantId) {
      this.tenantContext.watch(tenantId);
    }
  }

  async signOut(): Promise<void> {
    await this.auth.signOut();
    await this.router.navigateByUrl('/ingreso');
  }
}
