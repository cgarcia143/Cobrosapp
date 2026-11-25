import { NgModule } from '@angular/core';
import { PreloadAllModules, RouterModule, Routes } from '@angular/router';
import { authGuard, guestGuard, roleGuard, tenantGuard } from './core/guards';

const routes: Routes = [
  {
    path: 'ingreso',
    canActivate: [guestGuard],
    loadComponent: () => import('./pages/login/login.page').then((module) => module.LoginPage),
  },
  {
    path: '',
    canActivate: [authGuard],
    loadComponent: () => import('./pages/shell/shell.page').then((module) => module.ShellPage),
    children: [
      { path: '', pathMatch: 'full', redirectTo: 'agenda' },
      {
        path: 'agenda',
        canActivate: [tenantGuard],
        loadComponent: () => import('./pages/agenda/agenda.page').then((module) => module.AgendaPage),
      },
      {
        path: 'clientes',
        canActivate: [tenantGuard, roleGuard(['oficina_admin', 'independiente'])],
        loadComponent: () => import('./pages/clients/clients.page').then((module) => module.ClientsPage),
      },
      {
        path: 'creditos/nuevo',
        canActivate: [tenantGuard, roleGuard(['oficina_admin', 'independiente'])],
        loadComponent: () => import('./pages/credits/credit.page').then((module) => module.CreditPage),
      },
      {
        path: 'reportes',
        canActivate: [tenantGuard, roleGuard(['oficina_admin', 'independiente'])],
        loadComponent: () => import('./pages/reports/reports.page').then((module) => module.ReportsPage),
      },
      {
        path: 'equipo',
        canActivate: [tenantGuard, roleGuard(['oficina_admin'])],
        loadComponent: () => import('./pages/team/team.page').then((module) => module.TeamPage),
      },
      {
        path: 'plataforma',
        canActivate: [roleGuard(['super_admin'])],
        loadComponent: () => import('./pages/platform/platform.page').then((module) => module.PlatformPage),
      },
    ],
  },
  { path: '**', redirectTo: 'agenda' },
];

@NgModule({
  imports: [RouterModule.forRoot(routes, { preloadingStrategy: PreloadAllModules })],
  exports: [RouterModule],
})
export class AppRoutingModule {}
