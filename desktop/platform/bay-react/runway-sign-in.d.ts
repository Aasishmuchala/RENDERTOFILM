import type { ReactElement } from 'react';

export declare function signInRequiredFrom(e: unknown): { reauth: string } | null;
export declare function consentRequiredFrom(e: unknown): { consent: string } | null;
export declare function runwayConsentNavigationUrl(consent: string): string;
export declare function goToRunwayConsent(consent: string): 'opened' | 'blocked';
export declare function SignInPrompt(props: {
  reauth: string;
  title?: string;
  description?: string;
  onSignedIn?: () => void;
}): ReactElement;
