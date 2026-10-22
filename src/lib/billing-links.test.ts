import { describe, expect, it } from 'vitest';
import { planBillingPath, planCheckoutPath, requestedBillingInterval } from './billing-links';
describe('plan billing links', () => {
 it('preserves an omitted interval for existing annual upgrade links', () => {
  expect(requestedBillingInterval('?plan=premium', 'year')).toBe('year');
  expect(requestedBillingInterval('?plan=premium&interval=month', 'year')).toBe('month');
  expect(requestedBillingInterval('?plan=premium&interval=year', 'month')).toBe('year');
 });
 it('preserves the selected annual interval when checkout redirects a subscriber to billing', () => {
  expect(planBillingPath('premium', 'year')).toBe('/settings/billing?plan=premium&interval=year');
  expect(planCheckoutPath('premium', 'year')).toBe('/settings/billing/checkout?plan=premium&interval=year');
  expect(planBillingPath('premium')).toBe('/settings/billing?plan=premium');
  expect(planBillingPath('premium', 'month')).toBe('/settings/billing?plan=premium&interval=month');
 });
});

it('keeps the recurring allowance in signup and already-subscribed redirect links', () => {
 expect(planBillingPath('pro','year',30000)).toBe('/settings/billing?plan=pro&interval=year&monthlyCredits=30000');
 expect(planCheckoutPath('pro','month',50000)).toBe('/settings/billing/checkout?plan=pro&interval=month&monthlyCredits=50000');
});
