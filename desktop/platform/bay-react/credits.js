// @runway/bay-react/credits — the out-of-credits notice, simplified.
import { createElement as h } from 'react';

export function creditsRequiredFrom(e) {
  return e?.data?.credits ?? e?.credits ?? null;
}

export function OutOfCreditsPrompt(_props) {
  return h('div', { role: 'alert' }, "You're out of credits. Top up with your provider, then try again.");
}
