import { Injectable, inject, signal } from '@angular/core';
import { doc, onSnapshot } from 'firebase/firestore';
import type { Tenant } from '../domain/models';
import { FIRESTORE } from '../firebase/firebase-providers';
import { mapTenant } from '../firestore/mappers';

@Injectable({ providedIn: 'root' })
export class TenantContext {
  private readonly firestore = inject(FIRESTORE);
  readonly tenant = signal<Tenant | null>(null);
  readonly fromCache = signal(false);
  private stopListener: (() => void) | null = null;
  private currentId: string | null = null;

  watch(tenantId: string): void {
    if (this.currentId === tenantId && this.stopListener) {
      return;
    }
    this.stop();
    this.currentId = tenantId;
    this.stopListener = onSnapshot(
      doc(this.firestore, `tenants/${tenantId}`),
      { includeMetadataChanges: true },
      (snapshot) => {
        this.fromCache.set(snapshot.metadata.fromCache);
        this.tenant.set(snapshot.exists() ? mapTenant(snapshot.id, snapshot.data()) : null);
      },
    );
  }

  stop(): void {
    this.stopListener?.();
    this.stopListener = null;
    this.currentId = null;
    this.tenant.set(null);
  }
}
