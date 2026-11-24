import { Injectable, inject } from '@angular/core';
import {
  Timestamp,
  collection,
  doc,
  onSnapshot,
  orderBy,
  query,
  serverTimestamp,
  setDoc,
  updateDoc,
  where,
} from 'firebase/firestore';
import type { Client } from '../domain/models';
import { FIRESTORE } from '../firebase/firebase-providers';
import { mapClient } from '../firestore/mappers';

export interface ClientInput {
  fullName: string;
  documentNumber: string;
  phone: string;
  address: string;
  neighborhood: string;
  notes: string;
  collectorUid: string;
  routeOrder: number;
}

@Injectable({ providedIn: 'root' })
export class ClientService {
  private readonly firestore = inject(FIRESTORE);

  watchActive(tenantId: string, onData: (clients: Client[]) => void, onError: (error: Error) => void): () => void {
    const clientsQuery = query(
      collection(this.firestore, `tenants/${tenantId}/clients`),
      where('active', '==', true),
      orderBy('fullName'),
    );
    return onSnapshot(
      clientsQuery,
      (snapshot) => {
        onData(snapshot.docs.map((item) => mapClient(item.id, item.data())));
      },
      (error) => onError(error),
    );
  }

  async create(tenantId: string, actorUid: string, input: ClientInput): Promise<string> {
    const clientRef = doc(collection(this.firestore, `tenants/${tenantId}/clients`));
    await setDoc(clientRef, {
      ...normalize(input),
      active: true,
      createdAt: Timestamp.fromDate(new Date()),
      updatedAt: serverTimestamp(),
      createdBy: actorUid,
    });
    return clientRef.id;
  }

  async update(tenantId: string, clientId: string, input: ClientInput): Promise<void> {
    await updateDoc(doc(this.firestore, `tenants/${tenantId}/clients/${clientId}`), {
      ...normalize(input),
      updatedAt: serverTimestamp(),
    });
  }

  async deactivate(tenantId: string, clientId: string): Promise<void> {
    await updateDoc(doc(this.firestore, `tenants/${tenantId}/clients/${clientId}`), {
      active: false,
      updatedAt: serverTimestamp(),
    });
  }
}

function normalize(input: ClientInput): ClientInput {
  const fullName = input.fullName.trim();
  const documentNumber = input.documentNumber.trim();
  if (fullName.length < 3) {
    throw new Error('El nombre del cliente es demasiado corto.');
  }
  if (documentNumber.length < 5) {
    throw new Error('El documento del cliente es demasiado corto.');
  }
  if (!Number.isInteger(input.routeOrder)) {
    throw new Error('El orden de la ruta debe ser un número entero.');
  }
  return {
    fullName,
    documentNumber,
    phone: input.phone.trim(),
    address: input.address.trim(),
    neighborhood: input.neighborhood.trim(),
    notes: input.notes.trim(),
    collectorUid: input.collectorUid.trim(),
    routeOrder: input.routeOrder,
  };
}
