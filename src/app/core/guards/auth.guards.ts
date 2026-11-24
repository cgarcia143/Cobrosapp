import { inject } from '@angular/core';
import { CanActivateFn, Router, UrlTree } from '@angular/router';
import { firebaseConfigured } from '../../../environments/environment';
import type { UserRole } from '../domain/models';
import { AuthService } from '../services/auth.service';

export const authGuard: CanActivateFn = async (): Promise<boolean | UrlTree> => {
  const router = inject(Router);
  const auth = inject(AuthService);
  if (!firebaseConfigured) {
    return router.createUrlTree(['/ingreso']);
  }
  const session = await auth.ensureSession();
  if (!session) {
    return router.createUrlTree(['/ingreso']);
  }
  return true;
};

export const tenantGuard: CanActivateFn = async (): Promise<boolean | UrlTree> => {
  const router = inject(Router);
  const auth = inject(AuthService);
  if (!firebaseConfigured) {
    return router.createUrlTree(['/ingreso']);
  }
  const session = await auth.ensureSession();
  if (!session) {
    return router.createUrlTree(['/ingreso']);
  }
  if (session.role === 'super_admin') {
    return router.createUrlTree(['/plataforma']);
  }
  if (!session.role || !session.tenantId) {
    return router.createUrlTree(['/ingreso']);
  }
  return true;
};

export function roleGuard(allowed: readonly UserRole[]): CanActivateFn {
  return async (): Promise<boolean | UrlTree> => {
    const router = inject(Router);
    const auth = inject(AuthService);
    if (!firebaseConfigured) {
      return router.createUrlTree(['/ingreso']);
    }
    const session = await auth.ensureSession();
    if (!session) {
      return router.createUrlTree(['/ingreso']);
    }
    if (!session.role || !allowed.includes(session.role)) {
      return router.createUrlTree([session.role === 'super_admin' ? '/plataforma' : '/agenda']);
    }
    return true;
  };
}
