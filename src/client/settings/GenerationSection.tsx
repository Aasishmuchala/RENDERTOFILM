import { FolderOpen, KeyRound, LogIn, LogOut, Trash2 } from 'lucide-react';
import { useState } from 'react';

import { Section } from '../layouts/Section.tsx';
import { errorMessage } from '../lib/runwayErrors.ts';
import { useInFlight } from '../lib/useInFlight.ts';
import { trpc } from '../trpc.ts';
import { Alert } from '../ui/Alert.tsx';
import { Button } from '../ui/Button.tsx';
import { NumberInput } from '../ui/NumberInput.tsx';
import { Select } from '../ui/Select.tsx';
import { SkeletonBlock } from '../ui/Skeleton.tsx';
import { Text, TextLink } from '../ui/Text.tsx';
import { TextInput } from '../ui/TextInput.tsx';
import styles from '../SettingsPage.module.css';
import own from './GenerationSection.module.css';

declare global {
  interface Window {
    /** The desktop app's preload; the web app has none. */
    rtfDesktop?: { version: string; platform: string; revealDataDir: () => Promise<unknown> } | undefined;
  }
}

/** The server's bounds for a key, after trimming (`settings.setRunwayApiKey`). */
const API_KEY_MIN = 8;
const API_KEY_MAX = 512;
/** The server's bound for a daily budget (`settings.setGeneration`). */
const BUDGET_MAX = 100_000;
const RELEASES_URL = 'https://github.com/Aasishmuchala/RENDERTOFILM/releases';

const PROVIDER_HINTS: Partial<Record<string, string>> = {
  higgsfield: 'Your Higgsfield account and its credits',
  runway: 'Your own API key and its API credits',
  simulator: 'Timers and sample images, nothing is billed',
};

type Account = { label: string; email?: string | undefined; credits?: number | undefined; signedIn: boolean } | null;

/** "Signed in as a@b.c · 120 credits". The credits are this provider's own, so the line sits under its name. */
function accountLine(account: Account) {
  if (!account?.signedIn) return 'Not signed in';
  const who = account.email ? `Signed in as ${account.email}` : `Connected to ${account.label}`;
  return account.credits === undefined ? who : `${who} · ${account.credits.toLocaleString()} credits`;
}

/**
 * The desktop app's stand-in for the Runway sign-in: who generates (one
 * provider per person, on their own account or key) and the account behind
 * it. Switching provider keeps every saved model; a page whose model the new
 * provider hides says so until the model is changed or the provider is
 * switched back.
 */
export function GenerationSection({ active }: { active: boolean }) {
  const generation = trpc.settings.generation.useQuery(undefined, { enabled: active });
  const utils = trpc.useUtils();
  const refresh = () =>
    Promise.all([utils.settings.generation.invalidate(), utils.settings.capabilities.invalidate()]);
  const choose = trpc.settings.setGeneration.useMutation({ onSettled: refresh });

  const data = generation.data;
  const provider = choose.isPending && choose.variables ? choose.variables.provider : data?.provider;
  const account = data?.account ?? null;

  return (
    <Section
      title="Generation"
      description="Stills and clips run on the provider you choose here, on your own account. Switching keeps the models you picked."
    >
      {generation.error ? (
        <Alert tone="error" title={errorMessage(generation.error) ?? 'Your generation settings did not load.'} />
      ) : !data ? (
        <SkeletonBlock height={160} />
      ) : (
        <div className={styles.stack}>
          <div className={styles.card}>
            <div className={styles.cardHead}>
              <span className={account?.signedIn ? styles.dotOn : styles.dotOff} aria-hidden />
              <div className={styles.cardTitle}>
                <Text>{accountLine(account)}</Text>
              </div>
            </div>
            <Select
              label="Provider"
              options={data.options.map((o) => ({ ...o, hint: PROVIDER_HINTS[o.id] }))}
              value={provider ?? ''}
              disabled={choose.isPending}
              onChange={(id) => {
                const next = data.options.find((o) => o.id === id);
                if (next && next.id !== data.provider) choose.mutate({ provider: next.id });
              }}
            />
            {choose.error && <Alert tone="error" title={errorMessage(choose.error) ?? 'That choice was not saved.'} />}
          </div>
          {data.provider === 'higgsfield' && (
            <HiggsfieldCard signedIn={account?.signedIn ?? false} budget={data.budget} active={active} />
          )}
          {data.provider === 'runway' && <RunwayKeyCard active={active} />}
        </div>
      )}
    </Section>
  );
}

/** Sign-in is the CLI's own, in the system browser; the app never sees it. */
function HiggsfieldCard({ signedIn, budget, active }: { signedIn: boolean; budget: number; active: boolean }) {
  const status = trpc.settings.higgsfieldStatus.useQuery(undefined, { enabled: active });
  const utils = trpc.useUtils();
  const refresh = () =>
    Promise.all([utils.settings.generation.invalidate(), utils.settings.higgsfieldStatus.invalidate()]);
  const login = trpc.settings.higgsfieldLogin.useMutation({ onSettled: refresh });
  const logout = trpc.settings.higgsfieldLogout.useMutation({ onSettled: refresh });
  const saveBudget = trpc.settings.setGeneration.useMutation({ onSettled: refresh });
  // One browser sign-in per press, however fast the second click comes.
  const guard = useInFlight();
  const once = (send: () => Promise<unknown>) => void guard.wrap(() => send().catch(() => undefined))();
  const cli = status.data;
  const error = login.error ?? logout.error ?? saveBudget.error;

  return (
    <div className={styles.card}>
      <div className={`${styles.cardHead} ${own.cliRow}`}>
        <div className={styles.cardTitle}>
          {cli?.supported && 'version' in cli && (
            <Text tone="muted" size="sm">
              Higgsfield CLI {cli.version}
              {cli.bundled ? ' (bundled)' : ''}
            </Text>
          )}
          {cli?.supported && 'missing' in cli && (
            <Text tone="muted" size="sm">
              The Higgsfield CLI is missing from this app. Install it with{' '}
              <code className={own.command}>{cli.install}</code>, then reopen Render to Film.
            </Text>
          )}
        </div>
        {signedIn ? (
          <Button
            size="sm"
            variant="ghost"
            icon={<LogOut size={14} aria-hidden />}
            loading={logout.isPending}
            onPress={() => once(() => logout.mutateAsync())}
          >
            Sign out
          </Button>
        ) : (
          <Button
            size="sm"
            variant="primary"
            icon={<LogIn size={14} aria-hidden />}
            loading={login.isPending}
            disabled={cli?.supported === true && 'missing' in cli}
            onPress={() => once(() => login.mutateAsync())}
          >
            {login.isPending ? 'Finish signing in in your browser' : 'Sign in with Higgsfield'}
          </Button>
        )}
      </div>
      <div className={own.budget}>
        <NumberInput
          label="Daily Higgsfield budget"
          value={saveBudget.isPending ? (saveBudget.variables.budget ?? budget) : budget}
          min={0}
          max={BUDGET_MAX}
          step={1}
          unit="credits"
          onChange={(next) => {
            if (next !== budget) saveBudget.mutate({ provider: 'higgsfield', budget: next });
          }}
        />
      </div>
      <Text tone="muted" size="sm" as="p">
        New runs stop for the day once their quotes reach this. Higgsfield credits are separate from any other account.
      </Text>
      {error && <Alert tone="error" title={errorMessage(error) ?? 'That did not work.'} />}
    </div>
  );
}

/** The Seevio key field's twin: checked with the Runway API, sealed on this computer, shown only by its last four. */
function RunwayKeyCard({ active }: { active: boolean }) {
  const connections = trpc.settings.connections.useQuery(undefined, { enabled: active });
  const saved = connections.data?.apiKeys.runwayapi ?? null;
  const utils = trpc.useUtils();
  const [key, setKey] = useState('');
  const refresh = () =>
    Promise.all([utils.settings.connections.invalidate(), utils.settings.generation.invalidate()]);
  const save = trpc.settings.setRunwayApiKey.useMutation({ onSuccess: () => setKey(''), onSettled: refresh });
  const clear = trpc.settings.clearRunwayApiKey.useMutation({ onSuccess: () => save.reset(), onSettled: refresh });
  // Spaces around a pasted key are dropped, as the server does, so a key of
  // only spaces never counts as one.
  const trimmed = key.trim();
  const plausible = trimmed.length >= API_KEY_MIN && trimmed.length <= API_KEY_MAX;
  // One save (one check with the Runway API) per press, however fast the second click comes.
  const guard = useInFlight();
  const submit = () => {
    if (plausible) void guard.wrap(() => save.mutateAsync({ key: trimmed }).catch(() => undefined))();
  };

  return (
    <div className={styles.card}>
      <div className={styles.cardHead}>
        <span className={saved ? styles.dotOn : styles.dotOff} aria-hidden />
        <div className={styles.cardTitle}>
          <Text>{saved ? `Key ending ${saved.last4}` : 'No key saved'}</Text>
          <Text tone="muted" size="sm">
            {saved
              ? `Saved ${new Date(saved.savedAt).toLocaleDateString()}${saved.verifiedAt ? ' · accepted by the Runway API' : ''}`
              : 'api.dev.runwayml.com'}
          </Text>
        </div>
        {saved && (
          <Button
            size="sm"
            variant="ghost"
            icon={<Trash2 size={14} aria-hidden />}
            loading={clear.isPending}
            onPress={() => void guard.wrap(() => clear.mutateAsync().catch(() => undefined))()}
          >
            Remove key
          </Button>
        )}
      </div>
      <div className={styles.row}>
        <TextInput
          className={styles.grow}
          type="password"
          label={saved ? 'Replace API key' : 'API key'}
          value={key}
          onChange={setKey}
          placeholder="Paste your Runway API key"
          onPressEnter={submit}
        />
        <Button
          className={styles.fieldButton}
          variant="primary"
          icon={<KeyRound size={16} />}
          disabled={!plausible}
          loading={save.isPending}
          onPress={submit}
        >
          Save key
        </Button>
      </div>
      {key.length > 0 && !plausible && (
        <Text tone="muted" size="sm" as="p">
          {trimmed.length > API_KEY_MAX
            ? `That is too long for an API key (${API_KEY_MAX} characters at most).`
            : `An API key is at least ${API_KEY_MIN} characters, not counting spaces around it.`}
        </Text>
      )}
      <Text tone="muted" size="sm" as="p">
        <TextLink external href="https://dev.runwayml.com">
          Get a key at dev.runwayml.com
        </TextLink>
        . Runs are billed to that account's API credits.
      </Text>
      {save.error && <Alert tone="error" title={errorMessage(save.error) ?? 'The key was not saved.'} />}
      {clear.error && <Alert tone="error" title={errorMessage(clear.error) ?? 'The key was not removed.'} />}
    </div>
  );
}

/** The sheet's last line in the desktop app: which version, where the work lives, where updates come from. */
export function DesktopFooter() {
  const desktop = window.rtfDesktop;
  return (
    <footer className={own.footer}>
      <Text tone="muted" size="sm" as="p">
        Render to Film{desktop?.version ? ` ${desktop.version}` : ''} · Your work is stored on this computer
      </Text>
      <div className={styles.actions}>
        {desktop && (
          <Button
            size="sm"
            variant="ghost"
            icon={<FolderOpen size={14} aria-hidden />}
            onPress={() => void desktop.revealDataDir()}
          >
            Show folder
          </Button>
        )}
        <TextLink external href={RELEASES_URL}>
          Check for updates
        </TextLink>
      </div>
    </footer>
  );
}
