import { Injectable, inject } from '@angular/core';
import { collection, onSnapshot, orderBy, query } from 'firebase/firestore';
import type { Member } from '../domain/models';
import { FIRESTORE } from '../firebase/firebase-providers';
import { mapMember } from '../firestore/mappers';

@Injectable({ providedIn: 'root' })
export class MemberService {
  private readonly firestore = inject(FIRESTORE);

  watch(tenantId: string, onData: (members: Member[]) => void, onError: (error: Error) => void): () => void {
    const membersQuery = query(collection(this.firestore, `tenants/${tenantId}/members`), orderBy('displayName'));
    return onSnapshot(
      membersQuery,
      (snapshot) => onData(snapshot.docs.map((item) => mapMember(item.id, item.data()))),
      (error) => onError(error),
    );
  }
}
