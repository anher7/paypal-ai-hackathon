import { ComponentFixture, TestBed } from '@angular/core/testing';
import { WorkEstimate } from '@agree-first/shared';
import { EstimateComparisonComponent, formatWorkHours } from './estimate-comparison.component';

describe('Work estimate comparison', () => {
  let fixture: ComponentFixture<EstimateComparisonComponent>;
  const estimate: WorkEstimate = {
    source: 'example', model: null, stale: false, generatedAt: '2026-10-14T10:00:00Z',
    tasks: [{ name: 'Review the work', withoutAgent: { minMinutes: 30, maxMinutes: 60 }, withAgent: { minMinutes: 45, maxMinutes: 90 }, agentHelp: 'Draft a checklist.', humanWork: 'Check and correct the result.' }],
    assumptions: ['Same deliverable in both options.'],
    totals: { withoutAgent: { minMinutes: 30, maxMinutes: 60, minPriceCents: 2500, maxPriceCents: 5000 }, withAgent: { minMinutes: 45, maxMinutes: 90, minPriceCents: 3750, maxPriceCents: 7500 } },
  };
  beforeEach(async () => {
    await TestBed.configureTestingModule({ imports: [EstimateComparisonComponent] }).compileComponents();
    fixture = TestBed.createComponent(EstimateComparisonComponent);
    fixture.componentRef.setInput('estimate', estimate);
    fixture.componentRef.setInput('hasRate', true);
    fixture.componentRef.setInput('canUse', true);
    fixture.detectChanges();
    await fixture.whenStable();
  });

  it('shows both options without assuming the agent is faster and emits the chosen price', () => {
    const selected = vi.fn();
    fixture.componentInstance.usePrice.subscribe(selected);
    const button = fixture.nativeElement.querySelector('[aria-label="Use high suggestion with an ai agent"]') as HTMLButtonElement;
    button.click();
    expect(selected).toHaveBeenCalledWith(7500);
    expect(fixture.nativeElement.textContent).toContain('Using an agent may take more time.');
    expect(fixture.nativeElement.textContent).toContain('Predefined example. No AI was called');
    expect(formatWorkHours(45, 90)).toBe('0.75–1.5 hours');
  });

  it('disables every suggestion for stale work and hides prices without a rate', async () => {
    fixture.componentRef.setInput('stale', true);
    fixture.detectChanges();
    await fixture.whenStable();
    expect(Array.from(fixture.nativeElement.querySelectorAll('button') as NodeListOf<HTMLButtonElement>).every((button) => button.disabled)).toBe(true);
    fixture.componentRef.setInput('hasRate', false);
    fixture.componentRef.setInput('estimate', { ...estimate, totals: { withoutAgent: { ...estimate.totals.withoutAgent, minPriceCents: null, maxPriceCents: null }, withAgent: { ...estimate.totals.withAgent, minPriceCents: null, maxPriceCents: null } } });
    fixture.detectChanges();
    await fixture.whenStable();
    expect(fixture.nativeElement.textContent).toContain('Add an hourly rate');
    expect(fixture.nativeElement.querySelectorAll('button').length).toBe(0);
  });

  it('cannot copy zero or oversized suggestions into a quote', async () => {
    fixture.componentRef.setInput('estimate', { ...estimate, totals: { ...estimate.totals, withoutAgent: { ...estimate.totals.withoutAgent, minPriceCents: 0, maxPriceCents: 1000000000 } } });
    fixture.detectChanges();
    await fixture.whenStable();
    expect((fixture.nativeElement.querySelector('[aria-label="Use low suggestion without an ai agent"]') as HTMLButtonElement).disabled).toBe(true);
    expect((fixture.nativeElement.querySelector('[aria-label="Use high suggestion without an ai agent"]') as HTMLButtonElement).disabled).toBe(true);
    expect(fixture.nativeElement.textContent).toContain('outside the allowed quote range');
  });
});
