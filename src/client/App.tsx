import { type ReactNode, useCallback, useEffect, useMemo, useRef, useState } from 'react';

import styles from './App.module.css';
import { ChatPage } from './ChatPage.tsx';
import { DirectorPage } from './DirectorPage.tsx';
import { EditPage } from './EditPage.tsx';
import { formatHash, type GoTo, type Handoff, parseHash, parseVideoPreset } from './handoff.ts';
import { AppShell } from './layouts/AppShell.tsx';
import { LibraryPage } from './LibraryPage.tsx';
import { AmbientProvider, PageActiveContext } from './lib/ambient.tsx';
import { useDocumentTitle } from './lib/useDocumentTitle.ts';
import { LifestylePage } from './LifestylePage.tsx';
import { type PageId, pageById } from './nav.ts';
import { SettingsPage } from './SettingsPage.tsx';
import { StillModes } from './StillModes.tsx';
import { trpc } from './trpc.ts';
import { VideoPage } from './VideoPage.tsx';

const PICKED_KEY = 'render-to-film:picked-still';

/**
 * One page, always mounted so a running take survives a page switch; only
 * the active one shows. Hidden pages are `hidden` and `inert`, so nothing in
 * them takes focus, and `useAmbient` inside them is ignored.
 */
function Panel({ id, active, children }: { id: PageId; active: boolean; children: ReactNode }) {
  return (
    <PageActiveContext.Provider value={active}>
      <div id={`page-${id}`} hidden={!active} inert={!active} className={active ? styles.panelActive : undefined}>
        {children}
      </div>
    </PageActiveContext.Provider>
  );
}

function readPicked(): string | null {
  try {
    return sessionStorage.getItem(PICKED_KEY);
  } catch {
    return null;
  }
}

export function App() {
  const profile = trpc.profile.useQuery();
  /** The address (`#video?still=abc`): the page showing and what it was opened with, so a reload stays on it. */
  const [handoff, setHandoff] = useState<Handoff>(() => parseHash(window.location.hash));
  const tab = handoff.page;
  const goTo = useCallback<GoTo>((page, params = {}) => setHandoff({ page, params }), []);
  const animate = useCallback((id: string) => goTo('video', { still: id }), [goTo]);

  /** The last still Video was given: the address forgets it on a page switch, Video's pick does not. */
  const [lastStill, setLastStill] = useState<string | null>(readPicked);
  const addressedStill = tab === 'video' ? handoff.params['still'] : undefined;
  const pickedStillId = addressedStill ?? lastStill;
  /**
   * Settings that came with the pick (the Lifestyle tab's Animate). One object
   * per arrival: Video applies it once and it leaves the address, so Back or
   * Forward to this entry can't set the shot up again over what was changed
   * since, and the next Animate with the same values is still a new one.
   */
  const presetParam = tab === 'video' ? handoff.params['preset'] : undefined;
  const videoPreset = useMemo(() => parseVideoPreset(presetParam), [presetParam]);
  useEffect(() => {
    if (presetParam === undefined) return;
    setHandoff(({ page, params: { preset: _applied, ...params } }) => ({ page, params }));
  }, [presetParam]);

  useEffect(() => {
    const hash = formatHash(handoff.page, handoff.params);
    if (window.location.hash !== hash) {
      history.replaceState(null, '', `${window.location.pathname}${window.location.search}${hash}`);
    }
  }, [handoff]);

  useDocumentTitle(pageById(tab)?.label, 'Render to Film');

  // After a page switch (not the first render), focus moves to the page and a
  // scrolled phone page starts at its top.
  const shownTab = useRef(tab);
  useEffect(() => {
    if (shownTab.current === tab) return;
    shownTab.current = tab;
    document.getElementById('main')?.focus({ preventScroll: true });
    if (window.scrollY > 0) window.scrollTo({ top: 0 });
  }, [tab]);

  useEffect(() => {
    // Always a new object, so an alias or unknown hash on the page already showing is still rewritten above.
    const onHash = () => setHandoff(parseHash(window.location.hash));
    window.addEventListener('hashchange', onHash);
    return () => window.removeEventListener('hashchange', onHash);
  }, []);

  // A file dropped outside a drop zone must not make the browser open it and leave the app.
  useEffect(() => {
    const keep = (e: DragEvent) => {
      if (e.dataTransfer?.types.includes('Files')) e.preventDefault();
    };
    window.addEventListener('dragover', keep);
    window.addEventListener('drop', keep);
    return () => {
      window.removeEventListener('dragover', keep);
      window.removeEventListener('drop', keep);
    };
  }, []);

  useEffect(() => {
    if (addressedStill) setLastStill(addressedStill);
  }, [addressedStill]);

  useEffect(() => {
    try {
      if (lastStill) sessionStorage.setItem(PICKED_KEY, lastStill);
      else sessionStorage.removeItem(PICKED_KEY);
    } catch {
      // Private mode: the pick just won't survive a reload.
    }
  }, [lastStill]);

  return (
    <AmbientProvider>
      <AppShell current={tab} user={profile.data ?? undefined}>
        <Panel id="chat" active={tab === 'chat'}>
          <ChatPage active={tab === 'chat'} handoff={handoff} />
        </Panel>
        <Panel id="director" active={tab === 'director'}>
          <DirectorPage active={tab === 'director'} handoff={handoff} onAnimate={animate} onGoToEdit={() => goTo('edit', {})} />
        </Panel>
        <Panel id="lifestyle" active={tab === 'lifestyle'}>
          <LifestylePage
            active={tab === 'lifestyle'}
            handoff={handoff}
            onAnimate={(id, preset) => goTo('video', { still: id, preset: JSON.stringify(preset) })}
          />
        </Panel>
        <Panel id="stills" active={tab === 'stills'}>
          <StillModes active={tab === 'stills'} handoff={handoff} goTo={goTo} onAnimate={animate} />
        </Panel>
        <Panel id="video" active={tab === 'video'}>
          <VideoPage
            active={tab === 'video'}
            handoff={handoff}
            pickedStillId={pickedStillId}
            preset={videoPreset}
            onPick={(id) => {
              setLastStill(id);
              goTo('video', id ? { still: id } : {});
            }}
            onGoToStills={() => goTo('stills', {})}
          />
        </Panel>
        <Panel id="edit" active={tab === 'edit'}>
          <EditPage active={tab === 'edit'} handoff={handoff} onGoToVideo={() => goTo('video', {})} />
        </Panel>
        <Panel id="library" active={tab === 'library'}>
          <LibraryPage active={tab === 'library'} handoff={handoff} onGoTo={goTo} onGoToStills={() => goTo('stills', {})} />
        </Panel>
        <Panel id="settings" active={tab === 'settings'}>
          <SettingsPage active={tab === 'settings'} />
        </Panel>
      </AppShell>
    </AmbientProvider>
  );
}
