import { SignInPrompt } from '@runway/bay-react/runway-sign-in';
import { KeyRound, LogIn, LogOut, Play, Plug, PlugZap, RefreshCw, Trash2 } from 'lucide-react';
import { useEffect, useState } from 'react';

import type { AiTextProvider, PublicServer } from '../connections.ts';
import { Section } from './layouts/Section.tsx';
import { errorMessage } from './lib/runwayErrors.ts';
import { useInFlight } from './lib/useInFlight.ts';
import { useOnRunwaySignedIn } from './lib/useOnRunwaySignedIn.ts';
import { trpc } from './trpc.ts';
import { Alert } from './ui/Alert.tsx';
import { Avatar } from './ui/Avatar.tsx';
import { Button } from './ui/Button.tsx';
import { PageHeader } from './ui/PageHeader.tsx';
import { Select } from './ui/Select.tsx';
import { SkeletonBlock } from './ui/Skeleton.tsx';
import { Switch } from './ui/Switch.tsx';
import { Text, TextLink } from './ui/Text.tsx';
import { TextArea } from './ui/TextArea.tsx';
import { TextInput } from './ui/TextInput.tsx';
import styles from './SettingsPage.module.css';

const OAUTH_MESSAGE = 'render-to-film:mcp-oauth';

/**
 * Accounts and connections: the Runway sign-in that pays for generations,
 * Higgsfield (built-in MCP server, OAuth), any other MCP server, and API keys
 * for other providers (Seevio, Anthropic, OmegaPlus). Credentials never come back to the browser;
 * the page only learns whether each one is connected. No Workspace: one glass sheet over the ambient.
 */
export function SettingsPage({ active }: { active: boolean }) {
  const profile = trpc.profile.useQuery();
  const runway = trpc.settings.runway.useQuery();
  const signedIn = runway.data?.signedIn ?? false;
  const connections = trpc.settings.connections.useQuery(undefined, {
    enabled: active && !!profile.data,
  });
  const utils = trpc.useUtils();
  const onSignedIn = useOnRunwaySignedIn();
  const [notice, setNotice] = useState<{ ok: boolean; message: string } | null>(null);

  // The OAuth popup reports back here when it finishes.
  useEffect(() => {
    const onMessage = (e: MessageEvent) => {
      if (e.origin !== window.location.origin) return;
      const data = e.data as { type?: string; ok?: boolean; message?: string } | null;
      if (data?.type !== OAUTH_MESSAGE) return;
      setNotice({ ok: !!data.ok, message: data.message ?? '' });
      void utils.settings.connections.invalidate();
    };
    window.addEventListener('message', onMessage);
    return () => window.removeEventListener('message', onMessage);
  }, [utils]);

  const servers = connections.data?.servers ?? [];
  const runwayMcp = servers.find((s) => s.preset === 'runway');
  const higgsfield = servers.find((s) => s.preset === 'higgsfield');
  const custom = servers.filter((s) => s.preset === null);

  return (
    <div className={styles.sheet}>
      <div className={styles.page}>
        <PageHeader
          title="Settings"
          description="Sign in to the services this studio generates with, and connect MCP servers."
        />

        {notice && (
          <Alert tone={notice.ok ? 'success' : 'error'} title={notice.message || (notice.ok ? 'Signed in.' : 'Sign-in failed.')} />
        )}

        <Section title="Runway" description="Generations in every tab run on your own Runway account and credits.">
          {runway.isLoading ? (
            <SkeletonBlock height={64} />
          ) : signedIn && profile.data ? (
            <div className={styles.account}>
              <Avatar name={profile.data.name} src={profile.data.avatarUrl} size={36} />
              <div className={styles.accountText}>
                <Text>{profile.data.name}</Text>
                <Text tone="muted" size="sm">
                  {profile.data.email} · signed in
                </Text>
              </div>
              <TextLink external href="https://app.runwayml.com/settings">
                Manage account
              </TextLink>
            </div>
          ) : (
            <SignInPrompt
              reauth={runway.data?.signInUrl ?? undefined}
              title="Sign in to Runway"
              description="Sign in with any Runway account. Your connections below are saved to it."
              onSignedIn={() => onSignedIn()}
            />
          )}
        </Section>

        {!profile.data ? null : connections.isLoading ? (
          <SkeletonBlock height={160} />
        ) : connections.error ? (
          <Alert tone="error" title={errorMessage(connections.error) ?? 'Your connections did not load.'} />
        ) : (
          <>
            <Section
              title="Runway MCP"
              description="Runway's own MCP server: image and video generation, upscaling, edits and workflows as tools. Sign in with your Runway account; tool runs use your Runway credits."
            >
              {runwayMcp && <ServerCard server={runwayMcp} />}
            </Section>

            <Section
              title="Higgsfield"
              description="Higgsfield's MCP server. Sign in with your Higgsfield account; tool runs use your Higgsfield credits."
            >
              {higgsfield && <ServerCard server={higgsfield} />}
            </Section>

            <Section title="Seevio" description="Paste an API key from your Seevio dashboard. It is checked with Seevio, then stored on the server.">
              <SeevioKey saved={connections.data?.apiKeys.seevio ?? null} appKey={connections.data?.seevioAppKey ?? false} />
            </Section>

            <Section
              title="AI text and vision"
              description="The Storyboard and Lifestyle planners, the people check, the close-up finder and the editor read your images and write plans with this model. Runway bills Claude through your Runway account; Anthropic and OmegaPlus use your own key and your own choice of model."
            >
              <AiTextCard active={active} />
            </Section>

            <Section
              title="MCP servers"
              description="Any other remote MCP server (Streamable HTTP). Servers with OAuth sign in in a popup; others take an access token."
            >
              <div className={styles.stack}>
                {custom.map((s) => (
                  <ServerCard key={s.id} server={s} />
                ))}
                <AddServer />
              </div>
            </Section>
          </>
        )}
      </div>
    </div>
  );
}

function openSignIn(serverId: string) {
  const url = `/api/mcp/oauth/start?server=${encodeURIComponent(serverId)}`;
  const popup = window.open(url, 'mcp-oauth', 'width=520,height=720');
  // Popups blocked: fall back to this tab; the callback page says what to do.
  if (!popup) window.location.href = url;
}

function ServerCard({ server }: { server: PublicServer }) {
  const utils = trpc.useUtils();
  const refresh = () => utils.settings.connections.invalidate();
  const test = trpc.settings.test.useMutation({ onSettled: refresh });
  const disconnect = trpc.settings.disconnect.useMutation({ onSettled: refresh });
  const remove = trpc.settings.removeServer.useMutation({ onSettled: refresh });
  const setEnabled = trpc.settings.setEnabled.useMutation({ onSettled: refresh });
  const setToken = trpc.settings.setToken.useMutation({ onSuccess: () => setToken_(''), onSettled: refresh });
  const [token, setToken_] = useState('');
  const [showToken, setShowToken] = useState(false);
  // One request per press: a double-click's second press lands before `isPending` shows.
  const guard = useInFlight();
  const once = (send: () => Promise<unknown>) => void guard.wrap(() => send().catch(() => undefined))();
  const saveToken = () => {
    if (token) once(() => setToken.mutateAsync({ id: server.id, token }));
  };
  const isPreset = server.preset !== null;
  const error = test.error ?? disconnect.error ?? remove.error ?? setToken.error;

  return (
    <div className={styles.card}>
      <div className={styles.serverHead}>
        <span className={server.connected ? styles.dotOn : styles.dotOff} aria-hidden />
        <Text className={styles.serverName}>{server.name}</Text>
        <Text tone="secondary" size="sm" className={styles.status}>
          {server.connected
            ? server.authKind === 'bearer'
              ? 'Connected with token'
              : server.authKind === 'oauth'
                ? 'Signed in'
                : 'Connected'
            : 'Not connected'}
        </Text>
        {/* One line, cut with an ellipsis; the full address is the title. */}
        <span className={styles.url} title={server.url}>
          {server.url}
        </span>
      </div>

      {!isPreset && (
        <Switch
          label="Use this server"
          hint="Off keeps it saved but stops its tools from running."
          checked={server.enabled}
          onChange={(enabled) => setEnabled.mutate({ id: server.id, enabled })}
        />
      )}

      <div className={styles.actions}>
        {!server.connected || server.authKind === 'oauth' ? (
          <Button
            size="sm"
            variant={server.connected ? 'default' : 'primary'}
            icon={<LogIn size={14} aria-hidden />}
            onPress={() => openSignIn(server.id)}
          >
            {server.connected ? 'Sign in again' : `Sign in${isPreset ? ` with ${server.name}` : ''}`}
          </Button>
        ) : null}
        {server.connected && (
          <Button size="sm" icon={<RefreshCw size={14} aria-hidden />} loading={test.isPending} onPress={() => once(() => test.mutateAsync({ id: server.id }))}>
            Test connection
          </Button>
        )}
        {!server.connected && (
          <Button size="sm" variant="ghost" icon={<KeyRound size={14} aria-hidden />} onPress={() => setShowToken((v) => !v)}>
            Use an access token
          </Button>
        )}
        {server.connected && (
          <Button size="sm" variant="ghost" icon={<LogOut size={14} aria-hidden />} loading={disconnect.isPending} onPress={() => once(() => disconnect.mutateAsync({ id: server.id }))}>
            Sign out
          </Button>
        )}
        {!isPreset && (
          <Button
            size="sm"
            variant="danger"
            icon={<Trash2 size={14} aria-hidden />}
            aria-label={`Remove ${server.name}`}
            loading={remove.isPending}
            onPress={() => once(() => remove.mutateAsync({ id: server.id }))}
          />
        )}
      </div>

      {showToken && !server.connected && (
        <div className={styles.row}>
          <TextInput
            className={styles.grow}
            type="password"
            label="Access token"
            value={token}
            onChange={setToken_}
            placeholder="Paste a bearer token"
            onPressEnter={saveToken}
          />
          <Button
            className={styles.fieldButton}
            variant="primary"
            disabled={!token}
            loading={setToken.isPending}
            onPress={saveToken}
          >
            Save token
          </Button>
        </div>
      )}

      {test.data && (
        <Alert tone="success" title={`${test.data.serverName ?? server.name} answered with ${test.data.toolCount} tools.`} />
      )}
      {error ? (
        <Alert tone="error" title={errorMessage(error) ?? 'That did not work.'} />
      ) : server.lastError && !test.data ? (
        <Alert tone="warning" title={server.lastError} />
      ) : null}

      {server.connected && server.tools.length > 0 && <ToolRunner server={server} />}
    </div>
  );
}

/** Pick one of the server's tools, give it JSON arguments, run it. */
function ToolRunner({ server }: { server: PublicServer }) {
  const [tool, setTool] = useState(server.tools[0]?.name ?? '');
  const [args, setArgs] = useState('{}');
  const [parseError, setParseError] = useState<string | null>(null);
  const call = trpc.settings.callTool.useMutation();
  // A tool can spend credits (Runway MCP makes images): one call per press.
  const guard = useInFlight();
  const schema = trpc.settings.toolSchema.useQuery({ id: server.id, name: tool }, { enabled: !!tool, staleTime: 5 * 60_000 });

  const run = () => {
    let parsed: unknown;
    try {
      parsed = JSON.parse(args || '{}');
    } catch {
      setParseError('The arguments are not valid JSON.');
      return;
    }
    if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) {
      setParseError('The arguments must be a JSON object, like {"prompt": "…"}.');
      return;
    }
    setParseError(null);
    const input = { id: server.id, name: tool, args: parsed as Record<string, unknown> };
    void guard.wrap(() => call.mutateAsync(input).catch(() => undefined))();
  };

  return (
    <details className={styles.tools}>
      <summary>
        <PlugZap size={14} aria-hidden /> {server.tools.length} tools
      </summary>
      <div className={styles.stack}>
        <Select
          label="Tool"
          value={tool}
          onChange={(name) => {
            setTool(name);
            call.reset();
          }}
          options={server.tools.map((t) => ({ id: t.name, name: t.name, hint: t.description }))}
          showHint
        />
        {schema.data != null && (
          <pre className={styles.code} aria-label="Argument schema">
            {JSON.stringify(schema.data, null, 2)}
          </pre>
        )}
        <TextArea label="Arguments (JSON)" rows={4} value={args} onChange={setArgs} />
        <div className={styles.actions}>
          <Button variant="primary" icon={<Play size={16} aria-hidden />} loading={call.isPending} disabled={!server.enabled} onPress={run}>
            Run {tool}
          </Button>
          {server.preset !== null && (
            <Text tone="muted" size="sm">
              Generations spend your {server.preset === 'runway' ? 'Runway' : 'Higgsfield'} credits.
            </Text>
          )}
        </div>
        {parseError && <Alert tone="error" title={parseError} />}
        {call.error && <Alert tone="error" title={errorMessage(call.error) ?? 'The tool call failed.'} />}
        {call.data && (
          <pre className={styles.code} aria-label="Tool result">
            {JSON.stringify(call.data.structuredContent ?? call.data.content, null, 2)}
          </pre>
        )}
      </div>
    </details>
  );
}

function AddServer() {
  const utils = trpc.useUtils();
  const [name, setName] = useState('');
  const [url, setUrl] = useState('');
  const [token, setToken] = useState('');
  const add = trpc.settings.addServer.useMutation({
    onSuccess: () => {
      setName('');
      setUrl('');
      setToken('');
    },
    onSettled: () => utils.settings.connections.invalidate(),
  });
  // One server per press: a double-click's second press lands before `isPending` shows.
  const guard = useInFlight();
  const submit = () => void guard.wrap(() => add.mutateAsync({ name, url, token: token || undefined }).catch(() => undefined))();

  return (
    <div className={styles.card}>
      <Text>Add an MCP server</Text>
      <div className={styles.row}>
        <TextInput className={styles.grow} label="Name" value={name} onChange={setName} placeholder="My tools" />
        <TextInput className={styles.grow} type="url" label="Server URL" value={url} onChange={setUrl} placeholder="https://example.com/mcp" />
      </div>
      <TextInput
        type="password"
        label="Access token (optional)"
        value={token}
        onChange={setToken}
        placeholder="Optional. Leave empty for OAuth"
        onPressEnter={submit}
      />
      <div className={styles.actions}>
        <Button variant="primary" icon={<Plug size={16} aria-hidden />} loading={add.isPending} disabled={!name || !url} onPress={submit}>
          Add server
        </Button>
      </div>
      {add.error && <Alert tone="error" title={errorMessage(add.error) ?? 'The server was not added.'} />}
    </div>
  );
}

/** The server's bounds for an API key, after trimming (`settings.setSeevioKey`, `settings.setAiTextKey`). */
const API_KEY_MIN = 8;
const API_KEY_MAX = 512;

function SeevioKey({
  saved,
  appKey,
}: {
  saved: { last4: string; savedAt: string; verifiedAt: string | null } | null;
  appKey: boolean;
}) {
  const utils = trpc.useUtils();
  const [key, setKey] = useState('');
  const refresh = () => utils.settings.connections.invalidate();
  const save = trpc.settings.setSeevioKey.useMutation({ onSuccess: () => setKey(''), onSettled: refresh });
  const clear = trpc.settings.clearSeevioKey.useMutation({ onSettled: refresh });
  // Spaces around a pasted key are dropped, as the server does, so a key of
  // only spaces never counts as one.
  const trimmed = key.trim();
  const plausible = trimmed.length >= API_KEY_MIN && trimmed.length <= API_KEY_MAX;
  // One save (one check with Seevio) per press, however fast the second click comes.
  const guard = useInFlight();
  const submit = () => {
    if (plausible) void guard.wrap(() => save.mutateAsync({ key: trimmed }).catch(() => undefined))();
  };

  return (
    <div className={styles.card}>
      <div className={styles.cardHead}>
        <span className={saved || appKey ? styles.dotOn : styles.dotOff} aria-hidden />
        <div className={styles.cardTitle}>
          <Text>{saved ? `Key ending ${saved.last4}` : appKey ? "Using the app's shared key" : 'No key saved'}</Text>
          <Text tone="muted" size="sm">
            {saved
              ? `Saved ${new Date(saved.savedAt).toLocaleDateString()}${saved.verifiedAt ? ' · accepted by Seevio' : ''}`
              : appKey
                ? 'Set as the SEEVIO_API_KEY secret in Runway App Studio. Paste your own to use your account instead.'
                : 'api.seevio.ai'}
          </Text>
        </div>
        {saved && (
          <Button size="sm" variant="ghost" icon={<Trash2 size={14} aria-hidden />} loading={clear.isPending} onPress={() => void guard.wrap(() => clear.mutateAsync().catch(() => undefined))()}>
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
          placeholder="Paste your Seevio API key"
          onPressEnter={submit}
        />
        <Button className={styles.fieldButton} variant="primary" icon={<KeyRound size={16} aria-hidden />} disabled={!plausible} loading={save.isPending} onPress={submit}>
          Save key
        </Button>
      </div>
      {key.length > 0 && !plausible && (
        <Text tone="muted" size="sm" as="p">
          {trimmed.length > API_KEY_MAX
            ? `That is too long for a Seevio key (${API_KEY_MAX} characters at most).`
            : `A Seevio key is at least ${API_KEY_MIN} characters, not counting spaces around it.`}
        </Text>
      )}
      <Text tone="muted" size="sm" as="p">
        Create one in your{' '}
        <TextLink external href="https://seevio.ai/docs">
          Seevio dashboard
        </TextLink>
        . Seevio shows the full key only once.
      </Text>
      {save.error && <Alert tone="error" title={errorMessage(save.error) ?? 'The key was not saved.'} />}
      {clear.error && <Alert tone="error" title={errorMessage(clear.error) ?? 'The key was not removed.'} />}
    </div>
  );
}

type SavedKey = { last4: string; savedAt: string; verifiedAt: string | null } | null;
type Usage = { calls: number; inputTokens: number; outputTokens: number; usd: number } | null;

/** "12 calls · 34,000 in / 5,000 out tokens", plus dollars when the provider's price is known (Anthropic). */
function usageLine(usage: Usage) {
  if (!usage || usage.calls === 0) return 'No calls yet';
  const usd = usage.usd > 0 ? ` · ${usage.usd < 0.01 ? 'under $0.01' : `about $${usage.usd.toFixed(2)}`}` : '';
  return `${usage.calls} ${usage.calls === 1 ? 'call' : 'calls'} · ${usage.inputTokens.toLocaleString()} in / ${usage.outputTokens.toLocaleString()} out tokens${usd}`;
}

const PROVIDER_NAMES = { runway: 'Runway', anthropic: 'Anthropic', omegaplus: 'OmegaPlus' } as const;

type ModelLists = {
  anthropicModels: readonly { id: string; name: string }[];
  omegaModels: readonly { id: string; name: string }[];
};

/** "OmegaPlus · Claude Opus 5.5", or Runway's own line; a model the lists don't name shows as its id. */
function usingLabel(provider: AiTextProvider, model: string | null, lists: ModelLists) {
  if (provider === 'runway') return 'Runway (Claude via your Runway account)';
  if (!model) return PROVIDER_NAMES[provider];
  const list = provider === 'anthropic' ? lists.anthropicModels : lists.omegaModels;
  return `${PROVIDER_NAMES[provider]} · ${list.find((m) => m.id === model)?.name ?? model}`;
}

const MODEL_LIST_NOTE = {
  live: 'Model list: live from OmegaPlus',
  cache: 'Model list: cached',
  fallback: 'Model list: built-in list (OmegaPlus did not answer)',
} as const;

/**
 * Who answers the app's text-and-vision calls: Claude through Runway (the
 * default), or the visitor's own Anthropic or OmegaPlus key with a model of
 * their choosing. A provider without a saved key can be picked; the server
 * says to save one first.
 */
function AiTextCard({ active }: { active: boolean }) {
  const ai = trpc.settings.aiText.useQuery(undefined, { enabled: active });
  const utils = trpc.useUtils();
  const choose = trpc.settings.setAiText.useMutation({ onSettled: () => utils.settings.aiText.invalidate() });

  if (ai.error) return <Alert tone="error" title={errorMessage(ai.error) ?? 'Your AI text settings did not load.'} />;
  if (!ai.data) return <SkeletonBlock height={160} />;
  const { provider, model, keys, anthropicModels, omegaModels, omegaSource, usageByProvider } = ai.data;

  const providers = [
    { id: 'runway', name: 'Runway (default)' },
    { id: 'anthropic', name: `Anthropic${keys.anthropic ? '' : ': add a key below'}` },
    { id: 'omegaplus', name: `OmegaPlus${keys.omegaplus ? '' : ': add a key below'}` },
  ];
  const models =
    provider === 'anthropic'
      ? anthropicModels.map((m) => ({ id: m.id, name: m.name }))
      : omegaModels.map((m) => ({ id: m.id, name: m.owner ? `${m.name} · ${m.owner}` : m.name }));
  // The page knows only the chosen provider's model; another one starts on its default (the server picks it).
  const currentModelFor = (p: AiTextProvider) => (p === provider ? (model ?? undefined) : undefined);
  const describe = (p: AiTextProvider, m: string | null) => usingLabel(p, m, { anthropicModels, omegaModels });

  return (
    <div className={styles.stack}>
      <div className={styles.card}>
        <div className={styles.cardHead}>
          <div className={styles.cardTitle}>
            <Text>Using {describe(provider, model)}</Text>
            {provider !== 'runway' && (
              <Text tone="muted" size="sm">
                {usageLine(usageByProvider[provider])}
              </Text>
            )}
          </div>
        </div>
        <div className={styles.row}>
          <div className={styles.grow}>
            <Select
              label="Provider"
              options={providers}
              value={choose.isPending && choose.variables ? choose.variables.provider : provider}
              disabled={choose.isPending}
              onChange={(id) => {
                const next = id as AiTextProvider;
                if (next !== provider) choose.mutate({ provider: next, model: currentModelFor(next) });
              }}
            />
          </div>
          {provider !== 'runway' && (
            <div className={styles.grow}>
              <Select
                label="Model"
                options={models}
                value={model ?? ''}
                disabled={choose.isPending}
                onChange={(id) => {
                  if (id !== model) choose.mutate({ provider, model: id });
                }}
              />
            </div>
          )}
        </div>
        {provider === 'omegaplus' && (
          <Text tone="muted" size="sm">
            {MODEL_LIST_NOTE[omegaSource]}
          </Text>
        )}
        {choose.error && <Alert tone="error" title={errorMessage(choose.error) ?? 'That choice was not saved.'} />}
      </div>

      <KeyCard
        provider="anthropic"
        saved={keys.anthropic}
        acceptedBy="Anthropic"
        usage={usageByProvider.anthropic}
        describe={describe}
        placeholder="Paste your Anthropic API key"
        docsHref="https://console.anthropic.com/settings/keys"
        docsLabel="Anthropic Console"
      />
      <KeyCard
        provider="omegaplus"
        saved={keys.omegaplus}
        acceptedBy="OmegaPlus"
        usage={usageByProvider.omegaplus}
        describe={describe}
        placeholder="Paste your OmegaPlus API key"
        docsHref="https://omegaplusapi.com/customer"
        docsLabel="OmegaPlus customer area"
      />
      <Text tone="muted" size="sm" as="p">
        OmegaPlus is a gateway: a model's public name does not guarantee a particular upstream model, and DeepSeek, Qwen and GLM see images through a text bridge. For faithful image reads, pick one of the Claude models.
      </Text>
    </div>
  );
}

/**
 * The Seevio card's twin for an AI text provider: checked with the provider on
 * save, stored server side. A first key saved while Runway answers puts its
 * provider to work, and the card says so.
 */
function KeyCard({
  provider,
  saved,
  acceptedBy,
  usage,
  describe,
  placeholder,
  docsHref,
  docsLabel,
}: {
  provider: 'anthropic' | 'omegaplus';
  saved: SavedKey;
  acceptedBy: string;
  usage: Usage;
  describe: (provider: AiTextProvider, model: string | null) => string;
  placeholder: string;
  docsHref: string;
  docsLabel: string;
}) {
  const utils = trpc.useUtils();
  const [key, setKey] = useState('');
  const refresh = () => utils.settings.aiText.invalidate();
  const save = trpc.settings.setAiTextKey.useMutation({ onSuccess: () => setKey(''), onSettled: refresh });
  const clear = trpc.settings.clearAiTextKey.useMutation({ onSuccess: () => save.reset(), onSettled: refresh });
  // Same rule as the Seevio card: a key of only spaces is not a key.
  const trimmed = key.trim();
  const plausible = trimmed.length >= API_KEY_MIN && trimmed.length <= API_KEY_MAX;
  // One save (one check with the provider) per press, however fast the second click comes.
  const guard = useInFlight();
  const submit = () => {
    if (plausible) void guard.wrap(() => save.mutateAsync({ provider, key: trimmed }).catch(() => undefined))();
  };
  const inUse = save.data;
  const savedNote = !inUse
    ? null
    : inUse.switched
      ? `Saved. AI text and vision now uses ${describe(inUse.provider, inUse.model)}.`
      : inUse.provider === provider
        ? `Saved. ${describe(inUse.provider, inUse.model)} now answers with this key.`
        : `Saved. AI text and vision still uses ${describe(inUse.provider, inUse.model)}; pick ${acceptedBy} under Provider to use this key.`;

  return (
    <div className={styles.card}>
      <div className={styles.cardHead}>
        <span className={saved ? styles.dotOn : styles.dotOff} aria-hidden />
        <div className={styles.cardTitle}>
          <Text>{acceptedBy} API key</Text>
          <Text tone="muted" size="sm">
            {saved
              ? `Key ending ${saved.last4} · saved ${new Date(saved.savedAt).toLocaleDateString()}${saved.verifiedAt ? ` · accepted by ${acceptedBy}` : ''}`
              : 'No key saved'}
          </Text>
          {usage && usage.calls > 0 && (
            <Text tone="muted" size="sm">
              {usageLine(usage)}
            </Text>
          )}
        </div>
        {saved && (
          <Button size="sm" variant="ghost" icon={<Trash2 size={14} aria-hidden />} loading={clear.isPending} onPress={() => void guard.wrap(() => clear.mutateAsync({ provider }).catch(() => undefined))()}>
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
          placeholder={placeholder}
          onPressEnter={submit}
        />
        <Button className={styles.fieldButton} variant="primary" icon={<KeyRound size={16} aria-hidden />} disabled={!plausible} loading={save.isPending} onPress={submit}>
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
        Create one in your{' '}
        <TextLink external href={docsHref}>
          {docsLabel}
        </TextLink>
        .
      </Text>
      {savedNote && <Alert tone="success" title={savedNote} />}
      {save.error && <Alert tone="error" title={errorMessage(save.error) ?? 'The key was not saved.'} />}
      {clear.error && <Alert tone="error" title={errorMessage(clear.error) ?? 'The key was not removed.'} />}
    </div>
  );
}
