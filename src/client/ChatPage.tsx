import { X } from 'lucide-react';
import { type DragEvent, lazy, Suspense, useCallback, useEffect, useRef, useState } from 'react';
import { Button as AriaButton, Dialog, Heading, Link, Modal, ModalOverlay } from 'react-aria-components';
import { createPortal } from 'react-dom';

import type { RunView } from '../chat/domain.ts';
import { Composer } from './chat/Composer.tsx';
import { RunTray } from './chat/RunTray.tsx';
import { ThreadList } from './chat/ThreadList.tsx';
import { Transcript } from './chat/Transcript.tsx';
import styles from './ChatPage.module.css';
import { formatHash, type Handoff } from './handoff.ts';
import { isRunLive, useChat } from './lib/useChat.ts';
import { trpc } from './trpc.ts';
import { Alert } from './ui/Alert.tsx';
import buttonStyles from './ui/Button.module.css';
import { Button } from './ui/Button.tsx';
import { ConfirmDialog } from './ui/ConfirmDialog.tsx';

const CardsGallery = lazy(() => import('./chat/cards.stories.tsx').then((m) => ({ default: m.CardsGallery })));

/** How near the end still counts as reading the end, so new words keep coming into view. */
const PIN_PX = 80;

/**
 * Opens a page. Only through the hash: a link or this steps the history, so Back
 * returns here, where App's `goTo` would replace this entry.
 */
function open({ page, params }: Handoff) {
  window.location.hash = formatHash(page, params);
}

function hasFiles(e: DragEvent) {
  return e.dataTransfer.types.includes('Files');
}

function SetupCard() {
  return (
    <div className={styles.setup} role="group" aria-label="Setup">
      <p className={styles.setupTitle}>Chat needs an Anthropic key</p>
      <p className={styles.setupLine}>Add your own key in Settings, then come back here.</p>
      <Link href={formatHash('settings')} className={`${buttonStyles.button} ${buttonStyles.primary} ${buttonStyles.md}`}>
        Open Settings
      </Link>
    </div>
  );
}

/**
 * Live Runs in the top bar's slot, or above the composer on a shell without one.
 * The bar has room for one row; the pill beside it lists them all. A live Run
 * leads to the chat following it, so a row's press selects that thread; each
 * Run gets its own list so the press knows which.
 */
function Tray({ runs, onSelect }: { runs: RunView[]; onSelect: (threadId: string) => void }) {
  const [slot, setSlot] = useState<HTMLElement | null>(null);
  useEffect(() => setSlot(document.getElementById('tray-slot')), []);
  const live = runs.filter(isRunLive).sort((a, b) => b.createdAt - a.createdAt);
  if (live.length === 0) return null;
  const row = (run: RunView) => (
    <RunTray key={run.id} runs={[run]} onOpen={(handoff) => (handoff.page === 'chat' ? onSelect(run.threadId) : open(handoff))} />
  );
  if (!slot) return <>{live.map(row)}</>;
  return createPortal(<div className={styles.barTray}>{row(live[0]!)}</div>, slot);
}

/**
 * Keeps the end of the conversation in view while the reader is at the end, whatever
 * grows it: words, a card, a picture loading, this page coming back into view.
 */
function usePinnedEnd() {
  const scroller = useRef<HTMLDivElement>(null);
  const content = useRef<HTMLDivElement>(null);
  const pinned = useRef(true);

  const toEnd = useCallback(() => {
    pinned.current = true;
    const el = scroller.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, []);

  useEffect(() => {
    if (!content.current) return;
    const grew = new ResizeObserver(() => {
      if (pinned.current) toEnd();
    });
    grew.observe(content.current);
    return () => grew.disconnect();
  }, [toEnd]);

  const onScroll = useCallback(() => {
    const el = scroller.current;
    // A hidden page has no height to measure, and coming back must still find the end.
    if (el?.clientHeight) pinned.current = el.scrollHeight - el.scrollTop - el.clientHeight < PIN_PX;
  }, []);

  return { scroller, content, onScroll, toEnd };
}

function Conversation({ active }: { active: boolean }) {
  const chat = useChat();
  const directorPlan = chat.thread?.turns.flatMap((t) => t.directorJobIds ?? []).at(-1);
  const { addFiles, turnLive, threadId } = chat;
  const settings = trpc.settings.chat.useQuery();
  const { refetch: refetchSettings } = settings;
  const { scroller, content, onScroll, toEnd } = usePinnedEnd();
  const input = useRef<HTMLTextAreaElement>(null);
  const [dropping, setDropping] = useState(false);
  const dragDepth = useRef(0);
  const [sheetOpen, setSheetOpen] = useState(false);
  const [confirmStop, setConfirmStop] = useState(false);

  // A key saved in Settings shows here as soon as the person is back.
  useEffect(() => {
    if (active) void refetchSettings();
  }, [active, refetchSettings]);

  useEffect(() => {
    toEnd();
  }, [threadId, toEnd]);

  useEffect(() => {
    if (!active) return;
    const onPaste = (e: ClipboardEvent) => {
      // An office app copies a picture of its text as well: in a text field the words win.
      const typing = e.target instanceof HTMLElement && e.target.matches('input, textarea, [contenteditable]');
      if (typing && e.clipboardData?.getData('text/plain')) return;
      const images = [...(e.clipboardData?.files ?? [])].filter((f) => f.type.startsWith('image/'));
      if (images.length === 0) return;
      e.preventDefault();
      addFiles(images);
    };
    window.addEventListener('paste', onPaste);
    return () => window.removeEventListener('paste', onPaste);
  }, [active, addFiles]);

  // Escape asks before stopping a live Turn; one that belongs to an open dialog or menu is theirs.
  useEffect(() => {
    if (!active || !turnLive) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== 'Escape' || e.defaultPrevented) return;
      if (e.target instanceof Element && e.target.closest('[role="dialog"], [role="alertdialog"], [role="menu"]')) return;
      setConfirmStop(true);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [active, turnLive]);

  // The question goes with its Turn, or the next one would open it unasked.
  useEffect(() => {
    if (!active || !turnLive) setConfirmStop(false);
  }, [active, turnLive]);

  const pick = (id: string | null) => {
    chat.select(id);
    setSheetOpen(false);
  };

  const list = <ThreadList threads={chat.threads} current={threadId} onSelect={pick} onNew={() => pick(null)} />;

  return (
    <div
      className={styles.page}
      data-dropping={dropping || undefined}
      onDragEnter={(e) => {
        if (!hasFiles(e)) return;
        dragDepth.current += 1;
        setDropping(true);
      }}
      onDragOver={(e) => {
        if (!hasFiles(e)) return;
        e.preventDefault();
        e.dataTransfer.dropEffect = 'copy';
      }}
      onDragLeave={(e) => {
        if (!hasFiles(e)) return;
        dragDepth.current -= 1;
        if (dragDepth.current <= 0) setDropping(false);
      }}
      onDrop={(e) => {
        if (!hasFiles(e)) return;
        e.preventDefault();
        dragDepth.current = 0;
        setDropping(false);
        addFiles([...e.dataTransfer.files]);
      }}
    >
      <aside className={styles.rail} aria-label="Chats">
        {list}
      </aside>
      <div ref={scroller} className={styles.scroller} onScroll={onScroll}>
        <div ref={content} className={styles.column}>
          <Button size="sm" className={styles.chats} onPress={() => setSheetOpen(true)}>
            Chats
          </Button>
          {chat.thread ? (
            <h1 className={styles.srOnly}>{chat.thread.title}</h1>
          ) : (
            !chat.loading && <h1 className={styles.title}>Drop renders here and say what you need.</h1>
          )}
          {chat.failed && <Alert tone="error" title="This conversation could not be loaded." />}
          {chat.thread && (
            <Transcript
              key={chat.thread.id}
              entries={chat.entries}
              draft={chat.draft}
              bay={chat.bay}
              deciding={chat.deciding}
              decideNote={chat.decideNote}
              allowance={chat.allowance}
              quoteInputs={chat.quoteInputs}
              films={chat.films}
              onDecide={(quoteId, decision) => {
                void chat.decide(quoteId, decision);
                // "Change" means saying what should change.
                if (decision === 'decline') input.current?.focus();
              }}
              onStopRun={chat.stopRun}
              onOpen={open}
            />
          )}
          {settings.data?.ready === false && <SetupCard />}
          {active && <Tray runs={chat.runs} onSelect={pick} />}
          <div className={styles.foot}>
            <p role="status" className={styles.reconnecting}>
              {chat.reconnecting ? 'Reconnecting…' : ''}
            </p>
            {directorPlan && (
              <Button variant="ghost" size="sm" onPress={() => open({ page: 'director', params: { job: directorPlan } })}>
                Open in Director
              </Button>
            )}
            <Composer
              mode={chat.mode}
              onMode={chat.setMode}
              attachments={chat.attachments}
              notes={chat.notes}
              error={chat.sendError}
              sending={chat.sending}
              live={turnLive}
              ready={settings.data?.ready !== false}
              active={active}
              inputRef={input}
              onAddFiles={addFiles}
              onRemove={chat.removeAttachment}
              onRetry={chat.retryAttachment}
              onSend={async (text) => {
                const sent = await chat.send(text);
                if (sent) toEnd();
                return sent;
              }}
              onStop={chat.stop}
            />
          </div>
        </div>
      </div>
      {dropping && (
        <p className={styles.dropRing} aria-hidden>
          <span className={styles.dropWords}>Drop to add</span>
        </p>
      )}
      <ModalOverlay isDismissable isOpen={sheetOpen} onOpenChange={setSheetOpen} className={styles.sheetOverlay}>
        <Modal className={styles.sheet}>
          <Dialog aria-labelledby="chat-sheet-title" className={styles.sheetDialog}>
            <div className={styles.sheetHead}>
              <Heading id="chat-sheet-title" slot="title" className={styles.sheetTitle}>
                Chats
              </Heading>
              <AriaButton slot="close" aria-label="Close" className={styles.sheetClose}>
                <X size={18} aria-hidden />
              </AriaButton>
            </div>
            {list}
          </Dialog>
        </Modal>
      </ModalOverlay>
      <ConfirmDialog
        isOpen={confirmStop && turnLive}
        title="Stop this answer?"
        confirmLabel="Stop"
        onConfirm={() => {
          setConfirmStop(false);
          chat.stop();
        }}
        onCancel={() => setConfirmStop(false)}
      >
        The assistant stops at its next step. Runs already going carry on.
      </ConfirmDialog>
    </div>
  );
}

/** The home page: the conversation, or the cards on their own at `#chat?gallery=1`. */
export function ChatPage({ active, handoff }: { active: boolean; handoff: Handoff }) {
  if (handoff.page === 'chat' && handoff.params['gallery'] === '1') {
    return (
      <Suspense fallback={null}>
        <CardsGallery />
      </Suspense>
    );
  }
  return <Conversation active={active} />;
}
