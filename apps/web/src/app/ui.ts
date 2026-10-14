import { ChangeDetectionStrategy, Component, input, Pipe, PipeTransform } from '@angular/core';
import { formatMoney, QuoteStatus } from '@agree-first/shared';

@Component({
  selector: 'app-status',
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `<span class="quote-status" [class.ready]="status() === 'ready'" [class.paid]="status() === 'paid'"><span class="status-dot"></span>{{ label() }}</span>`,
})
export class StatusComponent {
  readonly status = input.required<QuoteStatus>();
  label(): string {
    return { draft: 'Draft', ready: 'Ready to pay', paid: 'Paid' }[this.status()];
  }
}

@Component({
  selector: 'app-section-title',
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `<div class="section-heading"><span class="section-number">{{ number() }}</span><div><h2>{{ title() }}</h2>@if (hint()) {<p>{{ hint() }}</p>}</div></div>`,
})
export class SectionTitleComponent {
  readonly number = input.required<string>();
  readonly title = input.required<string>();
  readonly hint = input('');
}

@Component({
  selector: 'app-message',
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `<p class="message" [class.error]="error()" [attr.role]="error() ? 'alert' : 'status'">{{ text() }}</p>`,
})
export class MessageComponent {
  readonly text = input.required<string>();
  readonly error = input(false);
}

@Pipe({ name: 'money' })
export class MoneyPipe implements PipeTransform {
  transform(cents: number | null): string { return formatMoney(cents); }
}
