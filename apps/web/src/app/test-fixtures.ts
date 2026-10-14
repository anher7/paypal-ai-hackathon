import { Quote } from '@agree-first/shared';

export function exampleQuote(): Quote {
  return {
    id: 'quote-example', title: 'Studio website', customerName: 'Demo Studio',
    request: 'Build a five-page website with a booking form.', included: ['Five website pages'],
    excluded: ['Hosting'], needs: ['Final text'], questions: [{
      id: 'booking', sourcePhrase: 'booking form', prompt: 'An inquiry form or live calendar availability?',
      resolution: 'unanswered', response: '',
    }], draftSource: 'example', priceCents: null, currency: 'EUR', revision: 2,
    status: 'draft', approved: null, payment: null, createdAt: '2026-10-13T10:00:00Z', updatedAt: '2026-10-13T10:00:00Z',
  };
}
