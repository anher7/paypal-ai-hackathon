import { ChangeDetectionStrategy, Component, input, output } from '@angular/core';
import { MatButtonModule } from '@angular/material/button';
import { WorkEstimate, EstimateTotal } from '@agree-first/shared';
import { MoneyPipe } from './ui';

export function formatWorkHours(minMinutes: number, maxMinutes: number): string {
  const hours = (minutes: number) => new Intl.NumberFormat('en-IE', { maximumFractionDigits: 2 }).format(minutes / 60);
  return minMinutes === maxMinutes ? `${hours(minMinutes)} hours` : `${hours(minMinutes)}–${hours(maxMinutes)} hours`;
}

@Component({
  selector: 'app-estimate-comparison',
  imports: [MatButtonModule, MoneyPipe],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <section class="estimate-comparison" aria-label="Work and price estimate">
      <div class="estimate-heading"><h3>Same work. Two ways to deliver.</h3><span class="estimate-source">{{ estimate().source === 'ai' ? 'AI suggestion' : 'Example estimate' }}</span></div>
      <p class="small-text">These are estimates, not a promise. Both include human review, corrections, and testing. Using an agent may take more time.</p>
      @if (stale()) {<p class="estimate-warning" role="status">The work changed. Estimate again before using a suggested price.</p>}
      @if (!hasRate()) {<p class="small-text">Add an hourly rate to see suggested prices.</p>}
      @else if (!canUse() && !stale()) {<p class="small-text">Save your hourly rate before using a suggested price.</p>}
      <div class="estimate-options">@for (option of options; track option.key) {
        <article class="estimate-option"><h4>{{ option.label }}</h4><p class="estimate-hours">{{ hours(total(option.key).minMinutes, total(option.key).maxMinutes) }}</p>
          @if (total(option.key).minPriceCents !== null) {
            <p class="estimate-price">{{ total(option.key).minPriceCents | money }}–{{ total(option.key).maxPriceCents | money }}</p>
            <div class="estimate-actions"><button mat-stroked-button type="button" [disabled]="!canUse() || stale() || !validPrice(total(option.key).minPriceCents)" (click)="usePrice.emit(total(option.key).minPriceCents!)" [attr.aria-label]="'Use low suggestion ' + option.label.toLowerCase()">Use low suggestion</button><button mat-stroked-button type="button" [disabled]="!canUse() || stale() || !validPrice(total(option.key).maxPriceCents)" (click)="usePrice.emit(total(option.key).maxPriceCents!)" [attr.aria-label]="'Use high suggestion ' + option.label.toLowerCase()">Use high suggestion</button></div>@if (!validPrice(total(option.key).minPriceCents) || !validPrice(total(option.key).maxPriceCents)) {<p class="small-text">Some suggestions are outside the allowed quote range. Choose your own positive total below.</p>}
          }
        </article>
      }</div>
      <div class="estimate-tasks"><h4>What the time covers</h4>@for (task of estimate().tasks; track $index) {
        <article class="estimate-task"><h5>{{ task.name }}</h5><div class="task-times">@for (option of options; track option.key) {<p><strong>{{ option.label }}</strong><span>{{ hours(task[option.key].minMinutes, task[option.key].maxMinutes) }}</span></p>}</div><p><strong>Agent help:</strong> {{ task.agentHelp }}</p><p><strong>Your work:</strong> {{ task.humanWork }}</p></article>
      }</div>
      @if (estimate().assumptions.length) {<h4>What this estimate assumes</h4><ul>@for (assumption of estimate().assumptions; track $index) {<li>{{ assumption }}</li>}</ul>}
      <p class="small-text estimate-footnote">{{ estimate().source === 'ai' ? 'Model: ' + estimate().model + ' · Review these suggestions before using them.' : 'Predefined example. No AI was called for this estimate.' }}</p>
    </section>
  `,
  styles: `
    :host { display: block; margin: 22px 0 28px; }
    .estimate-comparison { border: 1px solid #cdd6c4; background: #f2f5ec; padding: 20px; }
    .estimate-heading { display: flex; flex-wrap: wrap; gap: 10px; align-items: start; justify-content: space-between; }
    h3 { font-family: Georgia, serif; font-weight: 400; font-size: 23px; }
    h4 { margin: 0 0 10px; font-size: 15px; }
    h5 { margin: 0 0 10px; font-size: 14px; }
    .estimate-source { font-size: 10px; color: #426548; border: 1px solid #bccfb6; padding: 4px 7px; }
    .estimate-options { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 14px; margin: 20px 0; }
    .estimate-option { background: #fffdf7; border-top: 2px solid #55775f; padding: 15px; min-width: 0; }
    .estimate-hours { color: #24563f; font-size: 20px; margin: 0 0 7px; }
    .estimate-price { font-size: 14px; overflow-wrap: anywhere; margin-bottom: 14px; }
    .estimate-actions { display: flex; flex-direction: column; gap: 8px; }
    .estimate-actions button { white-space: normal; }
    .estimate-warning { padding: 12px; background: #f5e7ce; color: #755217; font-size: 13px; }
    .estimate-task { border-top: 1px solid #d4ddcb; padding: 16px 0; overflow-wrap: anywhere; }
    .estimate-task p, li { font-size: 12px; margin-bottom: 7px; }
    .task-times { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 12px; }
    .task-times p { display: grid; gap: 3px; }
    .estimate-footnote { margin-bottom: 0; }
    @media (max-width: 850px) { .estimate-options { grid-template-columns: minmax(0, 1fr); } .estimate-comparison { padding: 15px; } }
  `,
})
export class EstimateComparisonComponent {
  readonly estimate = input.required<WorkEstimate>();
  readonly stale = input(false);
  readonly canUse = input(false);
  readonly hasRate = input(false);
  readonly usePrice = output<number>();
  readonly options = [{ key: 'withoutAgent', label: 'Without an AI agent' }, { key: 'withAgent', label: 'With an AI agent' }] as const;
  readonly hours = formatWorkHours;
  validPrice(cents: number | null): boolean { return cents !== null && Number.isSafeInteger(cents) && cents > 0 && cents <= 999999999; }
  total(option: 'withoutAgent' | 'withAgent'): EstimateTotal { return this.estimate().totals[option]; }
}

