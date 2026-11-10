import { Component } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { provideRouter, Router } from '@angular/router';
import { of } from 'rxjs';
import { AppComponent } from './app.component';
import { QuoteApi } from './quote-api';

@Component({ template: '' })
class EmptyPage {}

describe('Customer agreement shell', () => {
  beforeEach(async () => {
    await TestBed.configureTestingModule({ imports: [AppComponent], providers: [provideRouter([{ path: '', component: EmptyPage }, { path: 'customer', component: EmptyPage }]), { provide: QuoteApi, useValue: { config: () => of({ localOnly: false }) } }] }).compileComponents();
  });

  it('removes the workspace home link and identifies customer context after navigation', async () => {
    const fixture = TestBed.createComponent(AppComponent);
    await TestBed.inject(Router).navigateByUrl(`/customer#${'a'.repeat(64)}`);
    fixture.detectChanges(); await fixture.whenStable();
    const page = fixture.nativeElement as HTMLElement;
    expect(page.querySelector('header a[href="/"]')).toBeNull();
    expect(page.textContent).toContain('Your customer agreement');
    expect(page.textContent).toContain('Private customer link');
    await TestBed.inject(Router).navigateByUrl('/');
    fixture.detectChanges(); await fixture.whenStable();
    expect(page.querySelector('header a[href="/"]')).not.toBeNull();
    expect(page.textContent).toContain('Private demo workspace');
  });
});
