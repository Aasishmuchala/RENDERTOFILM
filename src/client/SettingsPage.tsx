import { SignInPrompt } from '@runway/bay-react/runway-sign-in';
import { KeyRound, LogIn, LogOut, Play, Plug, PlugZap, RefreshCw, Trash2 } from 'lucide-react';
import { useEffect, useState } from 'react';

import type { PublicServer } from '../connections.ts';
import { Section } from './layouts/Section.tsx';
import { errorMessage } from './lib/runwayErrors.ts';
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
 * for other providers (Seevio). Credentials never come back to the browser;
 * the page only learns whether each one is connected.
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
    <div className={styles.screen}>
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
  const isPreset = server.preset !== null;
  const error = test.error ?? disconnect.error ?? remove.error ?? setToken.error;

  return (
    <div className={styles.card}>
      <div className={styles.cardHead}>
        <span className={server.connected ? styles.dotOn : styles.dotOff} aria-hidden />
        <div className={styles.cardTitle}>
          <Text>{server.name}</Text>
          <Text tone="muted" size="sm">
            {server.url}
          </Text>
        </div>
        <Text tone="secondary" size="sm">
          {server.connected
            ? server.authKind === 'bearer'
              ? 'Connected with token'
              : server.authKind === 'oauth'
                ? 'Signed in'
                : 'Connected'
            : 'Not connected'}
        </Text>
      </div>

      {!isPreset && (
        <Switch
          label="Use this server"
          hint="Off keeps it saved but stops its tools from running."
          checked={server.enabled}
          onChange={(enabled) => setEnabled.mutate({ id: server.id, enabled })}
        />
      )}

      <div className={styles.row}>
        {!server.connected || server.authKind === 'oauth' ? (
          <Button variant={server.connected ? 'default' : 'primary'} icon={<LogIn size={16} aria-hidden />} onPress={() => openSignIn(server.id)}>
            {server.connected ? 'Sign in again' : `Sign in${isPreset ? ` with ${server.name}` : ''}`}
          </Button>
        ) : null}
        {server.connected && (
          <Button icon={<RefreshCw size={16} aria-hidden />} loading={test.isPending} onPress={() => test.mutate({ id: server.id })}>
            Test connection
          </Button>
        )}
        {!server.connected && (
          <Button variant="ghost" icon={<KeyRound size={16} aria-hidden />} onPress={() => setShowToken((v) => !v)}>
            Use an access token
          </Button>
        )}
        {server.connected && (
          <Button variant="ghost" icon={<LogOut size={16} aria-hidden />} loading={disconnect.isPending} onPress={() => disconnect.mutate({ id: server.id })}>
            Sign out
          </Button>
        )}
        {!isPreset && (
          <Button
            variant="danger"
            icon={<Trash2 size={16} aria-hidden />}
            aria-label={`Remove ${server.name}`}
            loading={remove.isPending}
            onPress={() => remove.mutate({ id: server.id })}
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
            onPressEnter={() => token && setToken.mutate({ id: server.id, token })}
          />
          <Button variant="primary" disabled={!token} loading={setToken.isPending} onPress={() => setToken.mutate({ id: server.id, token })}>
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
    call.mutate({ id: server.id, name: tool, args: parsed as Record<string, unknown> });
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
        <div className={styles.row}>
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
  const submit = () => add.mutate({ name, url, token: token || undefined });

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
        placeholder="Leave empty to sign in with OAuth after adding"
        onPressEnter={submit}
      />
      <div className={styles.row}>
        <Button variant="primary" icon={<Plug size={16} aria-hidden />} loading={add.isPending} disabled={!name || !url} onPress={submit}>
          Add server
        </Button>
      </div>
      {add.error && <Alert tone="error" title={errorMessage(add.error) ?? 'The server was not added.'} />}
    </div>
  );
}

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
          <Button variant="ghost" icon={<Trash2 size={16} aria-hidden />} loading={clear.isPending} onPress={() => clear.mutate()}>
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
          onPressEnter={() => key && save.mutate({ key })}
        />
        <Button variant="primary" icon={<KeyRound size={16} aria-hidden />} disabled={!key} loading={save.isPending} onPress={() => save.mutate({ key })}>
          Save key
        </Button>
      </div>
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
