import { inject } from '@angular/core';
import { CanActivateFn, Router } from '@angular/router';
import type { UserRole } from './domain/models';
import { AuthService } from './services/auth.service';

export const authGuard: CanActivateFn = () => {
  const auth = inject(AuthService);
  const router = inject(Router);
  if (auth.session()) {
    return true;
  }
  return router.createUrlTree(['/ingreso']);
};

export const guestGuard: CanActivateFn = () => {
  const auth = inject(AuthService);
  const router = inject(Router);
  const session = auth.session();
  if (!session) {
    return true;
  }
  return router.createUrlTree([session.role === 'super_admin' ? '/plataforma' : '/agenda']);
};

export function roleGuard(roles: readonly UserRole[]): CanActivateFn {
  return () => {
    const auth = inject(AuthService);
    const router = inject(Router);
    const role = auth.session()?.role;
    if (role && roles.includes(role)) {
      return true;
    }
    return router.createUrlTree([role === 'super_admin' ? '/plataforma' : '/agenda']);
  };
}

export const tenantGuard: CanActivateFn = () => {
  const auth = inject(AuthService);
  const router = inject(Router);
  const session = auth.session();
  if (session?.role === 'super_admin') {
    return router.createUrlTree(['/plataforma']);
  }
  return true;
};
