import { Component, DestroyRef, inject, signal } from '@angular/core';
import { FormBuilder, ReactiveFormsModule, Validators } from '@angular/forms';
import type { Member } from '../../core/domain/models';
import { readableError } from '../../core/firestore/errors';
import { AuthService } from '../../core/services/auth.service';
import { MemberService } from '../../core/services/member.service';
import { PlatformService } from '../../core/services/platform.service';

@Component({
  selector: 'app-team',
  imports: [ReactiveFormsModule],
  templateUrl: './team.html',
})
export class TeamPage {
  private readonly platform = inject(PlatformService);
  private readonly members = inject(MemberService);
  private readonly auth = inject(AuthService);
  private readonly formBuilder = inject(FormBuilder);
  readonly team = signal<Member[]>([]);
  readonly errorMessage = signal('');
  readonly infoMessage = signal('');
  readonly saving = signal(false);

  readonly form = this.formBuilder.nonNullable.group({
    displayName: ['', Validators.required],
    email: ['', [Validators.required, Validators.email]],
    phone: [''],
  });

  constructor() {
    const destroyRef = inject(DestroyRef);
    const tenantId = this.auth.session()?.tenantId;
    if (!tenantId) {
      return;
    }
    const stop = this.members.watch(
      tenantId,
      (team) => this.team.set(team),
      (error) => this.errorMessage.set(readableError(error)),
    );
    destroyRef.onDestroy(stop);
  }

  async invite(): Promise<void> {
    const tenantId = this.auth.session()?.tenantId;
    if (!tenantId || this.form.invalid) {
      this.form.markAllAsTouched();
      return;
    }
    this.saving.set(true);
    this.errorMessage.set('');
    try {
      await this.platform.inviteCollector({ tenantId, ...this.form.getRawValue() });
      this.infoMessage.set('Cobrador vinculado. El rol queda en su perfil de Firestore.');
      this.form.reset();
    } catch (error) {
      this.errorMessage.set(readableError(error));
    } finally {
      this.saving.set(false);
    }
  }
}
