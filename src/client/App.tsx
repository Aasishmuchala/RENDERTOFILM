import { type ReactNode, useEffect, useRef, useState } from 'react';

import styles from './App.module.css';
import { CloseupsPage } from './CloseupsPage.tsx';
import { AppShell } from './layouts/AppShell.tsx';
import { DirectorPage } from './DirectorPage.tsx';
import { EditPage } from './EditPage.tsx';
import { LibraryPage } from './LibraryPage.tsx';
import { AmbientProvider, PageActiveContext } from './lib/ambient.tsx';
import { useDocumentTitle } from './lib/useDocumentTitle.ts';
import { LifestylePage } from './LifestylePage.tsx';
import { LocationPage } from './LocationPage.tsx';
import { type PageId, pageById, tabFromHash } from './nav.ts';
import { SettingsPage } from './SettingsPage.tsx';
import { StillsPage } from './StillsPage.tsx';
import { trpc } from './trpc.ts';
import { VideoPage, type VideoPreset } from './VideoPage.tsx';

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
  /** The page named in the address (`#video`), so a reload stays on it. */
  const [tab, setTab] = useState<PageId>(() => tabFromHash(window.location.hash));
  const [pickedStillId, setPickedStillId] = useState<string | null>(readPicked);
  /** Settings that came with the pick (the Lifestyle tab's Animate); the Video tab applies each new one once. */
  const [videoPreset, setVideoPreset] = useState<VideoPreset | null>(null);

  useEffect(() => {
    if (window.location.hash.slice(1) !== tab) {
      history.replaceState(null, '', `${window.location.pathname}${window.location.search}#${tab}`);
    }
  }, [tab]);

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
    const onHash = () => {
      const next = tabFromHash(window.location.hash);
      setTab(next);
      // An alias or unknown hash on the page already showing: the effect above won't run, so name it here.
      if (window.location.hash.slice(1) !== next) {
        history.replaceState(null, '', `${window.location.pathname}${window.location.search}#${next}`);
      }
    };
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
    try {
      if (pickedStillId) sessionStorage.setItem(PICKED_KEY, pickedStillId);
      else sessionStorage.removeItem(PICKED_KEY);
    } catch {
      // Private mode: the pick just won't survive a reload.
    }
  }, [pickedStillId]);

  return (
    <AmbientProvider>
      <AppShell current={tab} user={profile.data ?? undefined}>
        <Panel id="director" active={tab === 'director'}>
          <DirectorPage
            active={tab === 'director'}
            onAnimate={(id) => {
              setPickedStillId(id);
              setTab('video');
            }}
            onGoToEdit={() => setTab('edit')}
          />
        </Panel>
        <Panel id="stills" active={tab === 'stills'}>
          <StillsPage
            onAnimate={(id) => {
              setPickedStillId(id);
              setTab('video');
            }}
          />
        </Panel>
        <Panel id="lifestyle" active={tab === 'lifestyle'}>
          <LifestylePage
            active={tab === 'lifestyle'}
            onAnimate={(id, preset) => {
              setPickedStillId(id);
              setVideoPreset(preset);
              setTab('video');
            }}
          />
        </Panel>
        <Panel id="video" active={tab === 'video'}>
          <VideoPage
            active={tab === 'video'}
            pickedStillId={pickedStillId}
            preset={videoPreset}
            onPick={setPickedStillId}
            onGoToStills={() => setTab('stills')}
          />
        </Panel>
        <Panel id="closeups" active={tab === 'closeups'}>
          <CloseupsPage
            active={tab === 'closeups'}
            onGoToStills={() => setTab('stills')}
            onAnimate={(id) => {
              setPickedStillId(id);
              setTab('video');
            }}
          />
        </Panel>
        <Panel id="location" active={tab === 'location'}>
          <LocationPage
            active={tab === 'location'}
            onAnimate={(id) => {
              setPickedStillId(id);
              setTab('video');
            }}
          />
        </Panel>
        <Panel id="edit" active={tab === 'edit'}>
          <EditPage active={tab === 'edit'} onGoToVideo={() => setTab('video')} />
        </Panel>
        <Panel id="library" active={tab === 'library'}>
          <LibraryPage active={tab === 'library'} onGoToStills={() => setTab('stills')} />
        </Panel>
        <Panel id="settings" active={tab === 'settings'}>
          <SettingsPage active={tab === 'settings'} />
        </Panel>
      </AppShell>
    </AmbientProvider>
  );
}
