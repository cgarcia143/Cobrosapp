import { Component, inject, signal } from '@angular/core';
import { FormBuilder, ReactiveFormsModule, Validators } from '@angular/forms';
import { Router } from '@angular/router';
import { firebaseConfigured } from '../../../environments/environment';
import { readableError } from '../../core/firestore/errors';
import { AuthService } from '../../core/services/auth.service';

@Component({
  selector: 'app-login',
  imports: [ReactiveFormsModule],
  templateUrl: './login.html',
  host: { class: 'flex flex-1 flex-col' },
})
export class LoginPage {
  private readonly auth = inject(AuthService);
  private readonly router = inject(Router);
  private readonly formBuilder = inject(FormBuilder);
  readonly configured = firebaseConfigured;
  readonly errorMessage = signal('');
  readonly saving = signal(false);

  readonly form = this.formBuilder.nonNullable.group({
    email: ['', [Validators.required, Validators.email]],
    password: ['', [Validators.required, Validators.minLength(6)]],
  });

  async submit(): Promise<void> {
    if (this.form.invalid) {
      this.form.markAllAsTouched();
      return;
    }
    this.saving.set(true);
    this.errorMessage.set('');
    try {
      const { email, password } = this.form.getRawValue();
      await this.auth.signIn(email, password);
      const session = await this.auth.ensureSession();
      await this.router.navigateByUrl(session?.role === 'super_admin' ? '/plataforma' : '/agenda');
    } catch (error) {
      this.errorMessage.set(readableError(error));
    } finally {
      this.saving.set(false);
    }
  }
}
