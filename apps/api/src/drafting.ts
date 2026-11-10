import type { DraftProvider, ExampleRequest } from '@agree-first/shared';

export const examples: ExampleRequest[] = [{
  id: 'studio-website',
  title: 'A website for a small studio',
  customerName: 'Mira Studio',
  request: 'Build a five-page website with a booking form.',
  description: 'Sample data. Review whether the booking form sends an inquiry or manages availability.',
}];

export const exampleDraftProvider: DraftProvider = {
  mode: 'examples', configured: false, model: null,
  async estimate(context) {
    const exampleScope = await exampleDraftProvider.draft(context.request);
    if (!exampleScope || ['included', 'excluded', 'needs'].some((key) =>
      JSON.stringify(context[key as 'included' | 'excluded' | 'needs']) !== JSON.stringify(exampleScope[key as 'included' | 'excluded' | 'needs']))) return null;
    const question = context.questions[0];
    const supportedAnswer = ['inquiry', 'inquiry form', 'an inquiry form only; no live calendar.', 'an inquiry form only; no live calendar'];
    if (context.questions.length !== 1 || question.sourcePhrase !== 'booking form' ||
      question.prompt !== exampleScope.questions[0].prompt ||
      (question.resolution !== 'unanswered' && !supportedAnswer.includes(question.response.trim().toLowerCase()))) return null;
    return {
      source: 'example', model: null,
      tasks: [
        { name: 'Plan pages and agree the form', withoutAgent: { minMinutes: 120, maxMinutes: 240 }, withAgent: { minMinutes: 90, maxMinutes: 180 }, agentHelp: 'Outline page structure and form questions.', humanWork: 'Review the plan with the customer.' },
        { name: 'Build five pages and an inquiry form', withoutAgent: { minMinutes: 720, maxMinutes: 1200 }, withAgent: { minMinutes: 360, maxMinutes: 720 }, agentHelp: 'Draft layouts and form code.', humanWork: 'Adapt the design, review code, and handle form delivery.' },
        { name: 'Check phones, accessibility, and delivery', withoutAgent: { minMinutes: 240, maxMinutes: 480 }, withAgent: { minMinutes: 240, maxMinutes: 420 }, agentHelp: 'Suggest checks and help find defects.', humanWork: 'Test real behavior and correct problems.' },
      ],
      assumptions: ['Illustrative example only; this is not a live AI estimate.', 'Customer supplies approved content and images. The form sends inquiries; no live calendar.', 'Human review, corrections, and testing are included. Hosting and subscriptions are excluded.'],
    };
  },
  async draft(request) {
    if (request.trim() !== examples[0].request) {
      return null;
    }
    return {
      source: 'example',
      included: ['Five website pages: Home, About, Services, Work, and Contact.', 'A layout that works on phones and larger screens.', 'A booking form, with its exact behavior agreed below.'],
      excluded: ['Website hosting and domain costs.', 'Writing page content or taking photographs.'],
      needs: ['Your logo, page text, and photographs.', 'An email address for customer inquiries.'],
      questions: [{
        id: 'booking-form',
        sourcePhrase: 'booking form',
        prompt: 'An inquiry form or live calendar availability?',
        resolution: 'unanswered',
        response: '',
      }],
    };
  },
};
