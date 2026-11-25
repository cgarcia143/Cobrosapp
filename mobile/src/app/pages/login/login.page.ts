import { Component, inject, signal } from '@angular/core';
import { FormBuilder, ReactiveFormsModule, Validators } from '@angular/forms';
import { Router } from '@angular/router';
import { IonicModule } from '@ionic/angular/lazy';
import { errorText } from '../../core/media';
import { AuthService } from '../../core/services/auth.service';

@Component({
  selector: 'app-login',
  templateUrl: './login.page.html',
  imports: [IonicModule, ReactiveFormsModule],
})
export class LoginPage {
  private readonly auth = inject(AuthService);
  private readonly router = inject(Router);
  private readonly formBuilder = inject(FormBuilder);
  readonly errorMessage = signal('');
  readonly saving = signal(false);

  readonly form = this.formBuilder.nonNullable.group({
    email: ['oficina@local.app', [Validators.required, Validators.email]],
    password: ['Oficina123', [Validators.required, Validators.minLength(6)]],
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
      const session = await this.auth.signIn(email, password);
      await this.router.navigateByUrl(session.role === 'super_admin' ? '/plataforma' : '/agenda');
    } catch (error) {
      this.errorMessage.set(errorText(error));
    } finally {
      this.saving.set(false);
    }
  }
}
