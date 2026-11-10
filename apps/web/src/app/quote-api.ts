import { inject, Injectable } from '@angular/core';
import { HttpClient, HttpErrorResponse } from '@angular/common/http';
import { AppConfig, CheckoutRecovery, ExampleRequest, OrderResult, Quote, QuoteCreate, QuoteUpdate } from '@agree-first/shared';
import { Observable } from 'rxjs';

@Injectable({ providedIn: 'root' })
export class QuoteApi {
  private readonly http = inject(HttpClient);
  config(): Observable<AppConfig> { return this.http.get<AppConfig>('/api/config'); }
  examples(): Observable<ExampleRequest[]> { return this.http.get<ExampleRequest[]>('/api/examples'); }
  list(): Observable<Quote[]> { return this.http.get<Quote[]>('/api/quotes'); }
  get(id: string): Observable<Quote> { return this.http.get<Quote>(`/api/quotes/${encodeURIComponent(id)}`); }
  recovery(id: string): Observable<CheckoutRecovery | null> { return this.http.get<CheckoutRecovery | null>(`/api/quotes/${encodeURIComponent(id)}/checkout-recovery`); }
  create(value: QuoteCreate): Observable<Quote> { return this.http.post<Quote>('/api/quotes', value); }
  update(id: string, value: QuoteUpdate): Observable<Quote> { return this.http.put<Quote>(`/api/quotes/${encodeURIComponent(id)}`, value); }
  draft(id: string, expectedRevision: number): Observable<Quote> { return this.http.post<Quote>(`/api/quotes/${encodeURIComponent(id)}/draft`, { expectedRevision }); }
  estimate(id: string, expectedRevision: number): Observable<Quote> { return this.http.post<Quote>(`/api/quotes/${encodeURIComponent(id)}/estimate`, { expectedRevision }); }
  approve(id: string, expectedRevision: number): Observable<Quote> { return this.http.post<Quote>(`/api/quotes/${encodeURIComponent(id)}/approve`, { expectedRevision }); }
  order(id: string, approvedRevision: number): Observable<OrderResult> {
    return this.http.post<OrderResult>(`/api/quotes/${encodeURIComponent(id)}/orders`, { approvedRevision, scopeAccepted: true });
  }
  capture(id: string, orderId: string, approvedRevision: number): Observable<Quote> {
    return this.http.post<Quote>(`/api/quotes/${encodeURIComponent(id)}/orders/${encodeURIComponent(orderId)}/capture`, { approvedRevision, scopeAccepted: true });
  }
}

export function errorMessage(error: unknown): string {
  if (error instanceof HttpErrorResponse) {
    if (error.status === 0) { return 'We could not reach the server. Check your connection, then try again.'; }
    return error.error?.error?.message ?? 'That did not work. Please try again.';
  }
  return error instanceof Error ? error.message : 'That did not work. Please try again.';
}

export function errorCode(error: unknown): string | null {
  return error instanceof HttpErrorResponse ? error.error?.error?.code ?? null : null;
}


