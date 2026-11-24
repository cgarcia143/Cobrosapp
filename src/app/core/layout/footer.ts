import { Component } from '@angular/core';

@Component({
  selector: 'app-footer',
  template: `
    <footer class="border-t border-cyan-400/20 bg-slate-950/80 px-4 py-3 text-center text-xs tracking-wide text-slate-400">
      © {{ year }} Arkatech Solutions. Todos los derechos reservados.
    </footer>
  `,
})
export class Footer {
  readonly year = new Date().getFullYear();
}
