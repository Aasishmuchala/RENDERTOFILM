// @runway/bay-react/runway-sign-in — the sign-in and consent helpers. There is no
// Runway session here: providers are signed in to in Settings, so SignInPrompt is
// a notice that points there.
import { createElement as h } from 'react';

export function signInRequiredFrom(e) {
  if (typeof e?.data?.reauth === 'string') return { reauth: e.data.reauth };
  if (e?.error === 'sign_in_required' && typeof e.reauth === 'string') return { reauth: e.reauth };
  return null;
}

export function consentRequiredFrom(e) {
  if (typeof e?.data?.consent === 'string') return { consent: e.data.consent };
  if (e?.error === 'consent_required' && typeof e.consent === 'string') return { consent: e.consent };
  return null;
}

/** The URL the consent page is opened at (the mock adds nothing to it). */
export function runwayConsentNavigationUrl(consent) {
  return consent;
}

/** Opens the consent page in a new tab; 'blocked' when a popup blocker refused. */
export function goToRunwayConsent(consent) {
  const win = window.open(runwayConsentNavigationUrl(consent), '_blank');
  return win ? 'opened' : 'blocked';
}

export function SignInPrompt({ title }) {
  return h(
    'section',
    { 'aria-label': title ?? 'Sign in' },
    h('p', null, h('a', { href: '#settings' }, 'Open Settings'), ' to choose a provider and sign in.')
  );
}
