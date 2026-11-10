import { z } from 'zod';

export const currency = 'EUR' as const;

const shortText = z.string().trim().min(1).max(160);
const scopeItems = z.array(z.string().trim().min(1).max(1000)).max(30);

export const questionSchema = z.object({
  id: z.string().min(1).max(80),
  sourcePhrase: z.string().trim().min(1).max(200),
  prompt: z.string().trim().min(1).max(500),
  resolution: z.enum(['unanswered', 'answer', 'assumption']),
  response: z.string().trim().max(1000),
}).strict();

export const quoteCreateSchema = z.object({
  title: shortText,
  customerName: shortText,
  request: z.string().trim().min(1).max(10000),
}).strict();

export const quoteUpdateSchema = quoteCreateSchema.extend({
  expectedRevision: z.number().int().positive(),
  included: scopeItems,
  excluded: scopeItems,
  needs: scopeItems,
  questions: z.array(questionSchema).max(30),
  price: z.string().trim().max(20),
  hourlyRate: z.string().trim().max(20).optional().default(''),
}).strict().superRefine((value, context) => {
  if (new Set(value.questions.map((question) => question.id)).size !== value.questions.length) {
    context.addIssue({ code: 'custom', path: ['questions'], message: 'Give each question a different identifier.' });
  }
  if (value.hourlyRate !== '' && parseEuroPrice(value.hourlyRate) === null) {
    context.addIssue({ code: 'custom', path: ['hourlyRate'], message: 'Enter an hourly rate such as 50 or 50.50.' });
  }
  if (value.price !== '' && parseEuroPrice(value.price) === null) {
    context.addIssue({ code: 'custom', path: ['price'], message: 'Enter a price such as 450 or 450.50.' });
  }
});

export const revisionSchema = z.object({
  expectedRevision: z.number().int().positive(),
}).strict();

export const checkoutSchema = z.object({
  approvedRevision: z.number().int().positive(),
  scopeAccepted: z.literal(true),
}).strict();

export function parseEuroPrice(value: string): number | null {
  const normalized = value.trim();
  if (!/^\d{1,7}(?:\.\d{1,2})?$/.test(normalized)) {
    return null;
  }
  const [whole, fraction = ''] = normalized.split('.');
  const cents = Number(whole) * 100 + Number(fraction.padEnd(2, '0'));
  return Number.isSafeInteger(cents) && cents > 0 && cents <= 999999999 ? cents : null;
}

export function priceToInput(cents: number | null): string {
  return cents === null ? '' : (cents / 100).toFixed(2);
}

export function formatMoney(cents: number | null): string {
  return cents === null ? 'No price yet' : new Intl.NumberFormat('en-IE', {
    style: 'currency', currency,
  }).format(cents / 100);
}

export type ScopeQuestion = z.infer<typeof questionSchema>;
export type QuoteCreate = z.infer<typeof quoteCreateSchema>;
export type QuoteUpdate = Omit<z.infer<typeof quoteUpdateSchema>, 'hourlyRate'> & { hourlyRate?: string };
export type QuoteStatus = 'draft' | 'ready' | 'paid';
export type DraftSource = 'manual' | 'example' | 'ai';

export interface DraftResult {
  included: string[];
  excluded: string[];
  needs: string[];
  questions: ScopeQuestion[];
  source: 'example' | 'ai';
}

export interface DraftProvider {
  mode?: 'examples' | 'live';
  configured?: boolean;
  model?: string | null;
  draft(request: string): Promise<DraftResult | null>;
  estimate?(context: WorkEstimateContext): Promise<WorkEstimateResult | null>;
}

export interface ApprovalSnapshot {
  revision: number;
  title: string;
  customerName: string;
  request: string;
  included: string[];
  excluded: string[];
  needs: string[];
  questions: ScopeQuestion[];
  priceCents: number;
  currency: typeof currency;
  approvedAt: string;
}

export interface PaymentReceipt {
  orderId: string;
  captureId: string;
  priceCents: number;
  currency: typeof currency;
  paidAt: string;
}

export interface Quote {
  id: string;
  title: string;
  customerName: string;
  request: string;
  included: string[];
  excluded: string[];
  needs: string[];
  questions: ScopeQuestion[];
  draftSource: DraftSource;
  hourlyRateCents?: number | null;
  workEstimate?: WorkEstimate | null;
  priceCents: number | null;
  currency: typeof currency;
  revision: number;
  status: QuoteStatus;
  approved: ApprovalSnapshot | null;
  payment: PaymentReceipt | null;
  createdAt: string;
  updatedAt: string;
}

export interface ExampleRequest extends QuoteCreate {
  id: string;
  description: string;
}

export interface AppConfig {
  currency: typeof currency;
  paypalConfigured: boolean;
  paypalClientId: string | null;
  aiMode: 'examples' | 'live';
  aiConfigured?: boolean;
  aiModel?: string | null;
  localOnly: boolean;
  customerSharing?: boolean;
}

export type AgreementView = Pick<Quote, 'id' | 'status' | 'payment'> & {
  approved: Omit<ApprovalSnapshot, 'request'> | null;
};

export interface CustomerLink {
  token: string;
  expiresAt: string;
  revision: number;
}

export interface OrderResult {
  orderId: string;
  revision: number;
}

export interface ApiError {
  error: { code: string; message: string };
}


export interface CheckoutRecovery {
  orderId: string;
  approvedRevision: number;
}

const effortRangeSchema = z.object({
  minMinutes: z.number().int().min(0).max(525600),
  maxMinutes: z.number().int().min(0).max(525600),
}).strict().refine((range) => range.minMinutes <= range.maxMinutes, {
  message: 'The minimum effort must not exceed the maximum effort.',
});

export const workEstimateTaskSchema = z.object({
  name: z.string().trim().min(1).max(200),
  withoutAgent: effortRangeSchema,
  withAgent: effortRangeSchema,
  agentHelp: z.string().trim().min(1).max(1000),
  humanWork: z.string().trim().min(1).max(1000),
}).strict();

export const workEstimateResultSchema = z.object({
  source: z.enum(['example', 'ai']),
  model: z.string().trim().min(1).max(120).nullable(),
  tasks: z.array(workEstimateTaskSchema).min(1).max(30),
  assumptions: z.array(z.string().trim().min(1).max(1000)).min(1).max(20),
}).strict();

const estimateTotalSchema = z.object({
  minMinutes: z.number().int().min(0).max(15768000),
  maxMinutes: z.number().int().min(0).max(15768000),
  minPriceCents: z.number().int().min(0).max(Number.MAX_SAFE_INTEGER).nullable(),
  maxPriceCents: z.number().int().min(0).max(Number.MAX_SAFE_INTEGER).nullable(),
}).strict();

export const workEstimateSchema = workEstimateResultSchema.extend({
  generatedAt: z.iso.datetime(),
  stale: z.boolean(),
  totals: z.object({ withoutAgent: estimateTotalSchema, withAgent: estimateTotalSchema }).strict(),
}).strict();

export type WorkEstimateTask = z.infer<typeof workEstimateTaskSchema>;
export type WorkEstimateResult = z.infer<typeof workEstimateResultSchema>;
export type EstimateTotal = z.infer<typeof estimateTotalSchema>;
export type WorkEstimate = z.infer<typeof workEstimateSchema>;

export interface WorkEstimateContext {
  request: string;
  included: string[];
  excluded: string[];
  needs: string[];
  questions: ScopeQuestion[];
}

export function calculateWorkEstimateTotals(tasks: WorkEstimateTask[], hourlyRateCents: number | null) {
  const checkedTasks = z.array(workEstimateTaskSchema).min(1).max(30).parse(tasks);
  const rate = hourlyRateCents === null ? null : z.number().int().positive().max(999999999).parse(hourlyRateCents);
  function total(option: 'withoutAgent' | 'withAgent'): EstimateTotal {
    const minMinutes = checkedTasks.reduce((sum, task) => sum + task[option].minMinutes, 0);
    const maxMinutes = checkedTasks.reduce((sum, task) => sum + task[option].maxMinutes, 0);
    // Round each complete range up once, using integers so no cents are lost.
    const price = (minutes: number) => rate === null ? null : Number((BigInt(minutes) * BigInt(rate) + 59n) / 60n);
    return { minMinutes, maxMinutes, minPriceCents: price(minMinutes), maxPriceCents: price(maxMinutes) };
  }
  return { withoutAgent: total('withoutAgent'), withAgent: total('withAgent') };
}
