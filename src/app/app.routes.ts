import { Routes } from '@angular/router';
import { authGuard, roleGuard, tenantGuard } from './core/guards/auth.guards';

export const routes: Routes = [
  {
    path: 'ingreso',
    loadComponent: () => import('./features/auth/login').then((module) => module.LoginPage),
  },
  {
    path: '',
    canActivate: [authGuard],
    loadComponent: () => import('./features/shell/shell').then((module) => module.ShellPage),
    children: [
      { path: '', pathMatch: 'full', redirectTo: 'agenda' },
      {
        path: 'agenda',
        canActivate: [tenantGuard],
        loadComponent: () => import('./features/agenda/agenda').then((module) => module.AgendaPage),
      },
      {
        path: 'clientes',
        canActivate: [tenantGuard, roleGuard(['oficina_admin', 'independiente'])],
        loadComponent: () => import('./features/clients/clients').then((module) => module.ClientsPage),
      },
      {
        path: 'creditos/nuevo',
        canActivate: [tenantGuard, roleGuard(['oficina_admin', 'independiente'])],
        loadComponent: () => import('./features/credits/credit-form').then((module) => module.CreditFormPage),
      },
      {
        path: 'reportes',
        canActivate: [tenantGuard, roleGuard(['oficina_admin', 'independiente'])],
        loadComponent: () => import('./features/reports/reports').then((module) => module.ReportsPage),
      },
      {
        path: 'equipo',
        canActivate: [tenantGuard, roleGuard(['oficina_admin'])],
        loadComponent: () => import('./features/team/team').then((module) => module.TeamPage),
      },
      {
        path: 'plataforma',
        canActivate: [roleGuard(['super_admin'])],
        loadComponent: () => import('./features/platform/platform').then((module) => module.PlatformPage),
      },
    ],
  },
  { path: '**', redirectTo: 'agenda' },
];
