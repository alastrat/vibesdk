import { afterEach, describe, expect, it, vi } from 'vitest';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { MemoryRouter } from 'react-router';
import { CONTACT_FAILED_MESSAGE, CONTACT_LIMITED_MESSAGE, LEGAL_CONTACT } from '@/api-types';
import { applyAccountLocale, t } from '@/lib/i18n';
import { formatCredits } from '@/lib/i18n/public-pricing';
import { ContactForm } from './ContactForm';

const submission = vi.hoisted(() => ({ error: null as Error | null, isPending: false, mutate: vi.fn() }));
vi.mock('@/hooks/use-contact', () => ({ useSubmitContact: () => submission }));

afterEach(async () => { submission.error = null; await applyAccountLocale('en'); });
const renderError = (message: string) => {
 submission.error = new Error(message);
 return renderToStaticMarkup(createElement(MemoryRouter, null, createElement(ContactForm)));
};

describe('contact feedback', () => {
 for (const locale of ['es', 'pt-BR'] as const) {
  it(`translates rate limits, delivery failures and validation in ${locale}`, async () => {
   await applyAccountLocale(locale);
   for (const [message, key] of [
    [CONTACT_FAILED_MESSAGE, "Couldn't send your message. Please try again, or email {email}."],
    [CONTACT_LIMITED_MESSAGE, 'Too many requests. Please try again in an hour, or email {email}.'],
   ]) {
    const html = renderError(message);
    expect(t(key)).not.toBe(key);
    expect(html).toContain(t(key, { email: LEGAL_CONTACT.support }));
    expect(html).toContain(LEGAL_CONTACT.support);
    expect(html).not.toContain(message);
   }
   const html = renderError('Enter a valid work email');
   expect(html).toContain(t('Enter a valid work email'));
   expect(html).not.toContain('Enter a valid work email');
   expect(renderError('Keep the message under 2,000 characters')).toContain(t('Keep the message under {limit} characters', { limit: formatCredits(2000) }));
  });
 }
 it('keeps English responses intact and treats unknown messages as plain text', async () => {
  expect(renderError(CONTACT_LIMITED_MESSAGE)).toContain(CONTACT_LIMITED_MESSAGE);
  const unknown = 'Unknown <script>alert(1)</script> {email}';
  await applyAccountLocale('es');
  const html = renderError(unknown);
  expect(html).toContain('Unknown &lt;script&gt;alert(1)&lt;/script&gt; {email}');
  expect(html).not.toContain('<script>');
 });
});
