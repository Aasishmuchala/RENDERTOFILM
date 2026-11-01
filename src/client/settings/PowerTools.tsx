import { CircleAlert, CircleCheck, CircleDashed, Download, FolderOpen, Trash2 } from 'lucide-react';
import { useState } from 'react';

import type { SidecarRow } from '../../settings-api.ts';
import { SIDECAR_LABELS } from '../../sidecars.ts';
import { Section } from '../layouts/Section.tsx';
import { errorMessage } from '../lib/runwayErrors.ts';
import { useInFlight } from '../lib/useInFlight.ts';
import { trpc } from '../trpc.ts';
import { Alert } from '../ui/Alert.tsx';
import { Button } from '../ui/Button.tsx';
import { ConfirmDialog } from '../ui/ConfirmDialog.tsx';
import { SkeletonBlock } from '../ui/Skeleton.tsx';
import { Text } from '../ui/Text.tsx';
import { TextInput } from '../ui/TextInput.tsx';
import styles from '../SettingsPage.module.css';
import own from './PowerTools.module.css';

const POLL_MS = 2000;
/** What `status()` says of a pin with no build for this computer: no download to offer. */
const NOT_OFFERED = 'Not available for this platform yet.';

/** The pinned release's page. Both tools live at `storytold/<id>`, tagged `v<version>` (desktop/platform/sidecars.js). */
const releaseUrl = (sidecar: SidecarRow) => `https://github.com/storytold/${sidecar.id}/releases/tag/v${sidecar.pinned}`;

const megabytes = (bytes: number) => `${(bytes / 1_000_000).toFixed(1)} MB`;

/** The row's sentence: the download while one runs, else what `status()` found. */
function statusLine({ download, message }: SidecarRow) {
  if (!download) return message;
  if (!download.received) return 'Downloading…';
  const of = download.total ? ` of ${megabytes(download.total)}` : '';
  return `Downloading… ${megabytes(download.received)}${of}`;
}

/** The shape that says a tool's state, so no state rests on colour. */
function glyphOf({ download, ok, installed }: SidecarRow) {
  if (download) return Download;
  if (ok) return CircleCheck;
  return installed ? CircleAlert : CircleDashed;
}

/**
 * The optional command-line editors, desktop only: what is here against the
 * pinned version, and the user's three ways to change that. The app works
 * without them, and nothing downloads until the confirm dialog gets a yes.
 */
export function PowerTools({ active }: { active: boolean }) {
  const sidecars = trpc.settings.sidecars.useQuery(undefined, {
    enabled: active,
    // Only during a download: every answer runs each tool it finds with `--version`.
    refetchInterval: (query) => (query.state.data?.some((s) => s.download) ? POLL_MS : false),
  });

  return (
    <Section
      title="Power tools"
      description="Optional command-line editors, each at one pinned version. The app works without them, and nothing downloads unless you ask."
    >
      {sidecars.error ? (
        <Alert tone="error" title={errorMessage(sidecars.error) ?? 'Your power tools did not load.'} />
      ) : !sidecars.data ? (
        <SkeletonBlock height={160} />
      ) : (
        <div className={styles.stack}>
          {sidecars.data.map((sidecar) => (
            <Sidecar key={sidecar.id} sidecar={sidecar} />
          ))}
          <Text className={own.note} tone="muted" size="sm" as="p">
            Their licences are listed in <code className={own.file}>THIRD_PARTY_NOTICES.md</code>.
          </Text>
        </div>
      )}
    </Section>
  );
}

function Sidecar({ sidecar }: { sidecar: SidecarRow }) {
  const { id, pinned, installed, ok, message, download, downloadError } = sidecar;
  const label = SIDECAR_LABELS[id];
  const utils = trpc.useUtils();
  const refresh = () => utils.settings.sidecars.invalidate();
  const [asking, setAsking] = useState(false);
  const [choosing, setChoosing] = useState(false);
  const [file, setFile] = useState('');
  const remove = trpc.settings.sidecarRemove.useMutation({ onSettled: refresh });
  const save = trpc.settings.sidecarSetPath.useMutation({
    onSuccess: (found) => {
      if (!found.ok) return;
      setChoosing(false);
      setFile('');
    },
    onSettled: refresh,
  });
  const start = trpc.settings.sidecarDownload.useMutation({
    onSuccess: () => {
      setAsking(false);
      // Whatever Save and Remove last said was about the state this download replaces.
      save.reset();
      remove.reset();
    },
    onSettled: refresh,
  });
  // One request per press: a double-click's second press lands before `isPending` shows.
  const guard = useInFlight();
  const once = (send: () => Promise<unknown>) => void guard.wrap(() => send().catch(() => undefined))();
  const chosen = file.trim();
  // Enter takes this path too, and a download's end would replace the choice.
  const canSave = !!chosen && !download;
  const submit = () => {
    if (canSave) once(() => save.mutateAsync({ id, path: chosen }));
  };
  const Glyph = glyphOf(sidecar);
  const kept = remove.data?.installed && remove.data.path === sidecar.path ? remove.data.path : null;
  const error = remove.error ?? save.error;

  return (
    <div className={styles.card}>
      <div className={styles.cardHead}>
        <Glyph className={own.glyph} size={16} aria-hidden />
        <div className={styles.cardTitle}>
          <Text>{label}</Text>
          <Text tone="muted" size="sm">
            Pinned to {pinned} · {statusLine(sidecar)}
          </Text>
        </div>
      </div>
      <div className={styles.actions}>
        {!ok && message !== NOT_OFFERED && (
          <Button
            size="sm"
            variant="primary"
            icon={<Download size={14} aria-hidden />}
            loading={!!download}
            disabled={remove.isPending || save.isPending}
            onPress={() => setAsking(true)}
          >
            Download {pinned}
          </Button>
        )}
        <Button
          size="sm"
          icon={<FolderOpen size={14} aria-hidden />}
          onPress={() => {
            setChoosing((open) => !open);
            save.reset();
          }}
        >
          Choose file…
        </Button>
        {installed && (
          <Button
            size="sm"
            variant="ghost"
            icon={<Trash2 size={14} aria-hidden />}
            aria-label={`Remove ${label}`}
            loading={remove.isPending}
            disabled={!!download}
            onPress={() => once(() => remove.mutateAsync({ id }))}
          >
            Remove
          </Button>
        )}
      </div>
      {choosing && (
        <div className={styles.row}>
          <TextInput
            className={styles.grow}
            label={`Path to ${id}-cli`}
            value={file}
            onChange={setFile}
            placeholder={`/usr/local/bin/${id}-cli`}
            onPressEnter={submit}
          />
          <Button className={styles.fieldButton} variant="primary" disabled={!canSave} loading={save.isPending} onPress={submit}>
            Save
          </Button>
        </div>
      )}
      {save.data && !save.data.ok && <Alert tone="warning" title={save.data.message} />}
      {kept && (
        <Text tone="muted" size="sm" as="p">
          {kept} is your own file, so it stays where it is.
        </Text>
      )}
      {downloadError && <Alert tone="error" title={downloadError} />}
      {error && <Alert tone="error" title={errorMessage(error) ?? 'That did not work.'} />}
      <ConfirmDialog
        isOpen={asking}
        title={`Download ${label} ${pinned}?`}
        confirmLabel="Download"
        loading={start.isPending}
        error={start.error ? (errorMessage(start.error) ?? 'The download did not start.') : undefined}
        onConfirm={() => once(() => start.mutateAsync({ id }))}
        onCancel={() => {
          setAsking(false);
          start.reset();
        }}
      >
        <Text tone="secondary" as="p">
          This fetches the pinned release from <span className={own.url}>{releaseUrl(sidecar)}</span>. Its size is unknown
          until the download starts, and nothing is installed unless its hash matches.
        </Text>
      </ConfirmDialog>
    </div>
  );
}
