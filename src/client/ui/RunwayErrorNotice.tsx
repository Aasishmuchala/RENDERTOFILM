import { OutOfCreditsPrompt } from '@runway/bay-react/credits';
import { SignInPrompt } from '@runway/bay-react/runway-sign-in';

import { classifyRunwayError } from '../lib/runwayErrors.ts';
import { useCapabilities } from '../lib/useCapabilities.ts';
import { useOnRunwaySignedIn } from '../lib/useOnRunwaySignedIn.ts';
import { Alert } from './Alert.tsx';
import { ConsentPrompt } from './ConsentPrompt.tsx';
import { TextLink } from './Text.tsx';

export type RunwayErrorNoticeProps = {
  error: unknown;
  /** The model the failed call used, named in the plan-blocked copy. */
  modelName: string;
  /** Re-run the call that failed once the visitor has signed in. */
  onRetry?: (() => void) | undefined;
};

/**
 * The one notice a failed Runway call shows: sign in, out of credits,
 * consent, a plan that can't use the model (terminal), or the error itself.
 */
export function RunwayErrorNotice({ error, modelName, onRetry }: RunwayErrorNoticeProps) {
  const onSignedIn = useOnRunwaySignedIn();
  const { caps } = useCapabilities();
  if (!error) return null;
  const { signIn, credits, consent, message, unavailable, planBlocked } =
    classifyRunwayError(error);
  if (signIn) {
    return (
      <SignInPrompt
        reauth={signIn.reauth}
        title="Sign in to generate"
        description={
          caps.desktop
            ? `Generating uses your own ${caps.providerName} account. Connect it in Settings to continue.`
            : 'Generating uses your own Runway account and credits. Sign in with any Runway account to continue.'
        }
        onSignedIn={() => onSignedIn(onRetry)}
      />
    );
  }
  if (credits) return <OutOfCreditsPrompt error={error} />;
  if (consent) return <ConsentPrompt error={error} />;
  if (!message) return null;
  return (
    <Alert tone={planBlocked || unavailable ? 'warning' : 'error'} title={message}>
      {planBlocked && (
        <>
          This Runway account can&rsquo;t use {modelName}, so retrying can&rsquo;t succeed.
          Pick another model, or{' '}
          <TextLink external href="https://runwayml.com/pricing">
            compare plans
          </TextLink>
          .
        </>
      )}
    </Alert>
  );
}
