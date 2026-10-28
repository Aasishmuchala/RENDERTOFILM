import { Aperture, Clapperboard, Focus, Image, Library, MapPinned, Projector, Scissors, Settings, Users } from 'lucide-react';
import { useEffect, useState } from 'react';

import styles from './App.module.css';
import { CloseupsPage } from './CloseupsPage.tsx';
import { AppShell } from './layouts/AppShell.tsx';
import { DirectorPage } from './DirectorPage.tsx';
import { EditPage } from './EditPage.tsx';
import { LibraryPage } from './LibraryPage.tsx';
import { LifestylePage } from './LifestylePage.tsx';
import { LocationPage } from './LocationPage.tsx';
import { SettingsPage } from './SettingsPage.tsx';
import { StillsPage } from './StillsPage.tsx';
import { trpc } from './trpc.ts';
import { Tab, TabList, TabPanel, Tabs } from './ui/Tabs.tsx';
import { VideoPage } from './VideoPage.tsx';

const TABS = ['director', 'stills', 'lifestyle', 'video', 'closeups', 'location', 'edit', 'library', 'settings'];
const PICKED_KEY = 'render-to-film:picked-still';

/** The tab named in the address (`#video`), so a reload stays on it. */
function tabFromHash(): string {
  const raw = window.location.hash.slice(1);
  const id = raw === 'surroundings' ? 'location' : raw;
  return TABS.includes(id) ? id : 'director';
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
  const [tab, setTab] = useState(tabFromHash);
  const [pickedStillId, setPickedStillId] = useState<string | null>(readPicked);

  useEffect(() => {
    if (window.location.hash.slice(1) !== tab) {
      history.replaceState(null, '', `${window.location.pathname}${window.location.search}#${tab}`);
    }
  }, [tab]);

  useEffect(() => {
    const onHash = () => setTab(tabFromHash());
    window.addEventListener('hashchange', onHash);
    return () => window.removeEventListener('hashchange', onHash);
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
    <Tabs selectedKey={tab} onSelectionChange={setTab}>
      <AppShell
        title="Render to Film"
        brand={
          <span className={styles.mark} aria-hidden>
            <Aperture size={16} />
          </span>
        }
        nav={
          <TabList aria-label="Studio">
            <Tab id="director" icon={<Projector size={16} aria-hidden />}>
              Director
            </Tab>
            <Tab id="stills" icon={<Image size={16} aria-hidden />}>
              Stills
            </Tab>
            <Tab id="lifestyle" icon={<Users size={16} aria-hidden />}>
              Lifestyle
            </Tab>
            <Tab id="video" icon={<Clapperboard size={16} aria-hidden />}>
              Video
            </Tab>
            <Tab id="closeups" icon={<Focus size={16} aria-hidden />}>
              Close-ups
            </Tab>
            <Tab id="location" icon={<MapPinned size={16} aria-hidden />}>
              Location
            </Tab>
            <Tab id="edit" icon={<Scissors size={16} aria-hidden />}>
              Edit
            </Tab>
            <Tab id="library" icon={<Library size={16} aria-hidden />}>
              Library
            </Tab>
            <Tab id="settings" icon={<Settings size={16} aria-hidden />}>
              Settings
            </Tab>
          </TabList>
        }
        user={profile.data ?? undefined}
        maxWidth="none"
      >
        <TabPanel id="director">
          <DirectorPage
            active={tab === 'director'}
            onAnimate={(id) => {
              setPickedStillId(id);
              setTab('video');
            }}
            onGoToEdit={() => setTab('edit')}
          />
        </TabPanel>
        <TabPanel id="stills">
          <StillsPage
            onAnimate={(id) => {
              setPickedStillId(id);
              setTab('video');
            }}
          />
        </TabPanel>
        <TabPanel id="lifestyle">
          <LifestylePage
            onAnimate={(id) => {
              setPickedStillId(id);
              setTab('video');
            }}
          />
        </TabPanel>
        <TabPanel id="video">
          <VideoPage
            active={tab === 'video'}
            pickedStillId={pickedStillId}
            onPick={setPickedStillId}
            onGoToStills={() => setTab('stills')}
          />
        </TabPanel>
        <TabPanel id="closeups">
          <CloseupsPage
            active={tab === 'closeups'}
            onGoToStills={() => setTab('stills')}
            onAnimate={(id) => {
              setPickedStillId(id);
              setTab('video');
            }}
          />
        </TabPanel>
        <TabPanel id="location">
          <LocationPage
            active={tab === 'location'}
            onAnimate={(id) => {
              setPickedStillId(id);
              setTab('video');
            }}
          />
        </TabPanel>
        <TabPanel id="edit">
          <EditPage active={tab === 'edit'} onGoToVideo={() => setTab('video')} />
        </TabPanel>
        <TabPanel id="library">
          <LibraryPage active={tab === 'library'} onGoToStills={() => setTab('stills')} />
        </TabPanel>
        <TabPanel id="settings">
          <SettingsPage active={tab === 'settings'} />
        </TabPanel>
      </AppShell>
    </Tabs>
  );
}
