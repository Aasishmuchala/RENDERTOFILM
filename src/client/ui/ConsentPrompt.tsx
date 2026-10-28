import {
  consentRequiredFrom,
  goToRunwayConsent,
  runwayConsentNavigationUrl,
} from '@runway/bay-react/runway-sign-in';
import { useState } from 'react';

import { Alert } from './Alert.tsx';
import { Button } from './Button.tsx';
import styles from './ConsentPrompt.module.css';
import { TextLink } from './Text.tsx';

export type ConsentPromptProps = {
  error: unknown;
};

/** For a tRPC error or raw-route body needing the visitor's Runway consent;
 * renders nothing for any other error. */
export function ConsentPrompt({ error }: ConsentPromptProps) {
  // A published app on a brokered workspace, before this visitor allowed it
  // to use their Runway account: `data.consent` from src/trpc.ts, or
  // `403 { error: 'consent_required', consent }` from a raw route. The
  // consent page opens in this tab (a new one when framed) and returns the
  // visitor to this page.
  const [blockedUrl, setBlockedUrl] = useState<string | null>(null);
  const required = consentRequiredFrom(error);
  if (!required) return null;

  const allow = () => {
    setBlockedUrl(
      goToRunwayConsent(required.consent) === 'blocked'
        ? runwayConsentNavigationUrl(required.consent)
        : null
    );
  };

  return (
    <Alert tone="info" title="Allow this app to use your Runway account">
      <div className={styles.stack}>
        <p>
          This app needs your permission to generate with your Runway account.
          Allow it, then try again.
        </p>
        <Button variant="primary" size="sm" onPress={allow}>
          Allow access
        </Button>
        {blockedUrl && (
          <p>
            Your browser blocked the new tab.{' '}
            <TextLink external href={blockedUrl}>
              Open the permission page
            </TextLink>
            .
          </p>
        )}
      </div>
    </Alert>
  );
}
