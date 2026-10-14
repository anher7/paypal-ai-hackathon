import { randomUUID } from 'node:crypto';
import {
  currency, parseEuroPrice, calculateWorkEstimateTotals, workEstimateResultSchema, type Quote, type QuoteCreate, type QuoteUpdate,
  type DraftProvider, type ApprovalSnapshot, type OrderResult, type CheckoutRecovery,
} from '@agree-first/shared';
import { AppError } from './errors.js';
import type { PaymentAttempt, QuoteStore } from './store.js';
import type { PaymentProvider, PaypalOrder } from './paypal.js';

const retryWindowMilliseconds = 5 * 60 * 60 * 1000;

export function createQuoteService(store: QuoteStore, drafting: DraftProvider, payments: PaymentProvider) {
  const busyQuotes = new Set<string>();
  const now = () => new Date().toISOString();

  function findQuote(id: string): Quote {
    const quote = store.getQuote(id);
    if (!quote) {
      throw new AppError('QUOTE_NOT_FOUND', 'This quote could not be found.', 404);
    }
    return quote;
  }

  async function exclusive<T>(id: string, action: () => Promise<T> | T): Promise<T> {
    if (busyQuotes.has(id)) {
      throw new AppError('QUOTE_BUSY', 'This quote is being updated. Try again in a moment.', 409);
    }
    busyQuotes.add(id);
    try {
      return await action();
    } finally {
      busyQuotes.delete(id);
    }
  }

  function editableQuote(id: string, expectedRevision: number): Quote {
    const quote = findQuote(id);
    if (quote.status === 'paid') {
      throw new AppError('QUOTE_PAID', 'Paid quotes cannot be changed.', 409);
    }
    if (quote.revision !== expectedRevision) {
      throw new AppError('QUOTE_CHANGED', 'This quote changed. Reload it before continuing.', 409);
    }
    if (store.getAttempt(id, quote.revision)?.state === 'capturing') {
      throw new AppError('PAYMENT_UNCERTAIN', 'Check the current payment again before changing this quote.', 409);
    }
    return quote;
  }

  function approvedQuote(id: string, revision: number): Quote & { approved: ApprovalSnapshot } {
    const quote = findQuote(id);
    if (!quote.approved || quote.approved.revision !== revision || quote.revision !== revision || quote.status === 'draft') {
      throw new AppError('APPROVAL_CHANGED', 'This quote needs approval again before checkout.', 409);
    }
    return quote as Quote & { approved: ApprovalSnapshot };
  }

  function requireSetup() {
    if (!payments.configured) {
      throw new AppError('PAYPAL_NOT_CONFIGURED', 'Sandbox checkout needs setup.', 503);
    }
  }

  function validateOrder(order: PaypalOrder, quote: Quote & { approved: ApprovalSnapshot }, attempt: PaymentAttempt): void {
    const unit = order.purchase_units[0];
    const amount = unit && parseEuroPrice(unit.amount.value);
    if (order.purchase_units.length !== 1 || !unit ||
      (attempt.orderId && order.id !== attempt.orderId) ||
      (order.intent !== undefined && order.intent !== 'CAPTURE') ||
      unit.reference_id !== quote.id || unit.custom_id !== `${quote.id}:${quote.approved.revision}` ||
      unit.amount.currency_code !== currency || amount !== quote.approved.priceCents ||
      (attempt.merchantId && unit.payee.merchant_id !== attempt.merchantId) ||
      (payments.merchantId && unit.payee.merchant_id !== payments.merchantId)) {
      throw new AppError('PAYMENT_MISMATCH', 'This payment does not match the approved quote. No payment was recorded.', 409);
    }
  }

  function expiredCheckout(order: PaypalOrder, attempt: PaymentAttempt): never {
    if ((order.purchase_units[0].payments?.captures?.length ?? 0) > 0) {
      throw new AppError('PAYMENT_UNCERTAIN', 'This payment needs a manual sandbox check before the quote can change.', 409);
    }
    store.saveAttempt({ ...attempt, state: 'created', captureStartedAt: null });
    throw new AppError('CHECKOUT_EXPIRED', 'This checkout expired. Save and approve the quote again to start a new checkout.', 409);
  }
  function finishPayment(order: PaypalOrder, quote: Quote & { approved: ApprovalSnapshot }, attempt: PaymentAttempt): Quote {
    validateOrder(order, quote, attempt);
    const captures = order.purchase_units[0].payments?.captures ?? [];
    const capture = captures[0];
    if (order.status !== 'COMPLETED' || captures.length !== 1 || !capture || capture.status !== 'COMPLETED' ||
      capture.final_capture === false || capture.amount.currency_code !== currency ||
      parseEuroPrice(capture.amount.value) !== quote.approved.priceCents) {
      throw new AppError('PAYMENT_NOT_COMPLETED', 'PayPal has not confirmed a completed payment. Check this payment again.', 409);
    }
    const updated: Quote = {
      ...quote,
      status: 'paid',
      payment: {
        orderId: order.id, captureId: capture.id, priceCents: quote.approved.priceCents,
        currency, paidAt: now(),
      },
      updatedAt: now(),
    };
    store.transaction(() => {
      store.saveQuote(updated);
      store.saveAttempt({ ...attempt, state: 'paid' });
    });
    return updated;
  }

  return {
    list: () => store.listQuotes(),
    get: findQuote,
    recovery(id: string): CheckoutRecovery | null {
      const quote = findQuote(id);
      if (quote.status !== 'ready' || !quote.approved || quote.approved.revision !== quote.revision) {
        return null;
      }
      const attempt = store.getAttempt(id, quote.revision);
      return attempt?.state === 'capturing' && attempt.orderId
        ? { orderId: attempt.orderId, approvedRevision: quote.approved.revision }
        : null;
    },
    create(input: QuoteCreate): Quote {
      const timestamp = now();
      const quote: Quote = {
        ...input, id: randomUUID(), included: [], excluded: [], needs: [], questions: [],
        draftSource: 'manual', hourlyRateCents: null, workEstimate: null, priceCents: null, currency, revision: 1, status: 'draft',
        approved: null, payment: null, createdAt: timestamp, updatedAt: timestamp,
      };
      store.saveQuote(quote);
      return quote;
    },
    update(id: string, input: QuoteUpdate) {
      return exclusive(id, () => {
        const quote = editableQuote(id, input.expectedRevision);
        if (input.questions.some((question) => !input.request.toLowerCase().includes(question.sourcePhrase.toLowerCase()))) {
          throw new AppError('QUESTION_PHRASE_MISSING', 'Each question must point to words in the customer request.');
        }
        const { expectedRevision: _expectedRevision, price, hourlyRate = '', ...scope } = input;
        const hourlyRateCents = hourlyRate === '' ? null : parseEuroPrice(hourlyRate);
        const scopeChanged = ['request', 'included', 'excluded', 'needs', 'questions'].some((key) =>
          JSON.stringify(quote[key as keyof Quote]) !== JSON.stringify(scope[key as keyof typeof scope]));
        const workEstimate = quote.workEstimate ? {
          ...quote.workEstimate, stale: quote.workEstimate.stale || scopeChanged,
          totals: calculateWorkEstimateTotals(quote.workEstimate.tasks, hourlyRateCents),
        } : null;
        const updated: Quote = {
          ...quote, ...scope, hourlyRateCents, workEstimate, priceCents: price === '' ? null : parseEuroPrice(price),
          revision: quote.revision + 1, status: 'draft', approved: null, updatedAt: now(),
        };
        store.saveQuote(updated);
        return updated;
      });
    },
    draft(id: string, expectedRevision: number) {
      return exclusive(id, async () => {
        const quote = editableQuote(id, expectedRevision);
        const result = await drafting.draft(quote.request);
        if (!result) {
          throw new AppError('AI_NOT_CONNECTED', 'Live AI is not connected. You can write the scope yourself or try the labeled example.', 503);
        }
        const updated: Quote = {
          ...quote, included: result.included, excluded: result.excluded, needs: result.needs,
          questions: result.questions, draftSource: result.source,
          workEstimate: quote.workEstimate ? { ...quote.workEstimate, stale: true } : null,
          revision: quote.revision + 1, status: 'draft', approved: null, updatedAt: now(),
        };
        store.saveQuote(updated);
        return updated;
      });
    },
    estimate(id: string, expectedRevision: number) {
      return exclusive(id, async () => {
        const quote = editableQuote(id, expectedRevision);
        if (quote.included.length === 0) {
          throw new AppError('ESTIMATE_SCOPE_NEEDED', 'Add what the customer will get before estimating the work.');
        }
        const result = drafting.estimate ? await drafting.estimate({
          request: quote.request, included: quote.included, excluded: quote.excluded,
          needs: quote.needs, questions: quote.questions,
        }) : null;
        if (!result) {
          throw new AppError('AI_NOT_CONNECTED', 'Connect AI to estimate this request, or try the labeled example.', 503);
        }
        const checked = workEstimateResultSchema.safeParse(result);
        if (!checked.success) throw new AppError('AI_INVALID_RESPONSE', 'The AI estimate did not match the required format.', 502);
        const updated: Quote = {
          ...quote, workEstimate: {
            ...checked.data, generatedAt: now(), stale: false,
            totals: calculateWorkEstimateTotals(checked.data.tasks, quote.hourlyRateCents ?? null),
          },
          revision: quote.revision + 1, status: 'draft', approved: null, updatedAt: now(),
        };
        store.saveQuote(updated);
        return updated;
      });
    },
    approve(id: string, expectedRevision: number) {
      return exclusive(id, () => {
        const quote = editableQuote(id, expectedRevision);
        if (quote.included.length === 0 || quote.priceCents === null || quote.priceCents <= 0) {
          throw new AppError('QUOTE_INCOMPLETE', 'Add what the customer will get and enter a price before approval.');
        }
        if (quote.questions.some((question) => question.resolution === 'unanswered' || !question.response.trim())) {
          throw new AppError('QUESTIONS_UNRESOLVED', 'Answer every question or write an assumption before approval.');
        }
        const approved: ApprovalSnapshot = {
          revision: quote.revision, title: quote.title, customerName: quote.customerName,
          request: quote.request, included: [...quote.included], excluded: [...quote.excluded],
          needs: [...quote.needs], questions: structuredClone(quote.questions),
          priceCents: quote.priceCents, currency, approvedAt: now(),
        };
        const updated: Quote = { ...quote, approved, status: 'ready', updatedAt: now() };
        store.saveQuote(updated);
        return updated;
      });
    },
    createOrder(id: string, revision: number): Promise<OrderResult> {
      return exclusive(id, async () => {
        requireSetup();
        const quote = approvedQuote(id, revision);
        if (quote.status === 'paid') {
          throw new AppError('QUOTE_PAID', 'This quote has already been paid.', 409);
        }
        let attempt = store.getAttempt(id, revision);
        if (attempt?.orderId) {
          const currentOrder = await payments.getOrder(attempt.orderId);
          validateOrder(currentOrder, quote, attempt);
          if (currentOrder.status === 'COMPLETED') {
            finishPayment(currentOrder, quote, attempt);
            throw new AppError('QUOTE_PAID', 'This quote has already been paid.', 409);
          }
          if (currentOrder.status === 'VOIDED') {
            expiredCheckout(currentOrder, attempt);
          }
          if (!['CREATED', 'PAYER_ACTION_REQUIRED', 'APPROVED'].includes(currentOrder.status) ||
            (currentOrder.purchase_units[0].payments?.captures?.length ?? 0) > 0) {
            throw new AppError('PAYMENT_UNCERTAIN', 'Check the current payment again before starting checkout.', 409);
          }
          return { orderId: attempt.orderId, revision };
        }
        if (!attempt) {
          attempt = {
            id: randomUUID(), quoteId: id, revision, createRequestId: randomUUID(),
            captureRequestId: randomUUID(), orderId: null, merchantId: null,
            createdAt: now(), captureStartedAt: null, state: 'creating',
          };
          store.saveAttempt(attempt);
        }
        if (Date.now() - Date.parse(attempt.createdAt) > retryWindowMilliseconds) {
          throw new AppError('PAYMENT_REVIEW_NEEDED', 'An earlier checkout needs a manual sandbox check before another attempt.', 409);
        }
        const order = await payments.createOrder(id, quote.approved, attempt.createRequestId);
        validateOrder(order, quote, attempt);
        if (!['CREATED', 'PAYER_ACTION_REQUIRED', 'APPROVED'].includes(order.status)) {
          throw new AppError('PAYMENT_NOT_READY', 'PayPal did not create a checkout ready for approval.', 409);
        }
        store.saveAttempt({ ...attempt, orderId: order.id, merchantId: order.purchase_units[0].payee.merchant_id, state: 'created' });
        return { orderId: order.id, revision };
      });
    },
    capture(id: string, orderId: string, revision: number): Promise<Quote> {
      return exclusive(id, async () => {
        const quote = approvedQuote(id, revision);
        const attempt = store.getAttemptByOrder(orderId);
        if (!attempt || attempt.quoteId !== id || attempt.revision !== revision) {
          throw new AppError('ORDER_NOT_FOUND', 'This checkout does not belong to the approved quote.', 409);
        }
        if (quote.status === 'paid') {
          if (quote.payment?.orderId !== orderId) {
            throw new AppError('QUOTE_PAID', 'This quote has already been paid.', 409);
          }
          return quote;
        }
        requireSetup();
        const currentOrder = await payments.getOrder(orderId);
        validateOrder(currentOrder, quote, attempt);
        if (currentOrder.status === 'COMPLETED') {
          return finishPayment(currentOrder, quote, attempt);
        }
        if (currentOrder.status === 'VOIDED') {
          expiredCheckout(currentOrder, attempt);
        }
        if ((currentOrder.purchase_units[0].payments?.captures?.length ?? 0) > 0) {
          throw new AppError('PAYMENT_NOT_COMPLETED', 'PayPal has not confirmed a completed payment. Check this payment again.', 409);
        }
        if (currentOrder.status !== 'APPROVED') {
          throw new AppError('CUSTOMER_APPROVAL_NEEDED', 'Approve the payment in PayPal before completing checkout.', 409);
        }
        if (attempt.captureStartedAt && Date.now() - Date.parse(attempt.captureStartedAt) > retryWindowMilliseconds) {
          throw new AppError('PAYMENT_REVIEW_NEEDED', 'An earlier payment needs a manual sandbox check before another attempt.', 409);
        }
        const capturing: PaymentAttempt = {
          ...attempt, state: 'capturing', captureStartedAt: attempt.captureStartedAt ?? now(),
        };
        store.saveAttempt(capturing);
        const result = await payments.captureOrder(orderId, attempt.captureRequestId);
        return finishPayment(result, quote, capturing);
      });
    },
  };
}

export type QuoteService = ReturnType<typeof createQuoteService>;
