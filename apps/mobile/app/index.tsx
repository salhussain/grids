import { router, useFocusEffect } from 'expo-router';
import { useCallback, useState } from 'react';
import { View } from 'react-native';
import { SyncBar } from '../src/SyncBar';
import { useSession } from '../src/session';
import { listLinks, type SavedLink } from '../src/store/links';
import { readProjects, readTenants, useSyncStatus } from '../src/sync';
import { Button, Card, Empty, Screen, Txt } from '../src/ui';
import type { ProjectLite } from '../src/types';

interface Group {
  tenantId: string;
  tenantName: string;
  projects: ProjectLite[];
}

export default function Home() {
  const { session, loading, signIn } = useSession();
  const sync = useSyncStatus();
  const [groups, setGroups] = useState<Group[]>([]);
  const [links, setLinks] = useState<SavedLink[]>([]);
  const [signingIn, setSigningIn] = useState(false);

  useFocusEffect(
    useCallback(() => {
      let live = true;
      (async () => {
        const tenants = await readTenants();
        const g = await Promise.all(tenants.map(async (t) => ({ ...t, projects: await readProjects(t.tenantId) })));
        const l = await listLinks();
        if (live) {
          setGroups(g);
          setLinks(l);
        }
      })();
      return () => {
        live = false;
      };
      // sync.version: the downloads may have changed
    }, [sync.version]),
  );

  if (loading) return <Screen><Txt muted>Loading…</Txt></Screen>;

  return (
    <Screen>
      <SyncBar />

      {!session ? (
        <Card>
          <Txt strong>Sign in to collect data for your organisation</Txt>
          <Txt muted small>You need a connection the first time. After that the forms work offline.</Txt>
          <View style={{ height: 8 }} />
          <Button
            title="Sign in"
            busy={signingIn}
            onPress={async () => {
              setSigningIn(true);
              try {
                await signIn();
              } finally {
                setSigningIn(false);
              }
            }}
          />
        </Card>
      ) : null}

      {session && groups.length === 0 ? <Empty title="Nothing downloaded yet" hint={sync.online ? 'Tap “Sync now” to download your forms.' : 'Connect to the internet once to download your forms.'} /> : null}

      {groups.map((g) => (
        <View key={g.tenantId} style={{ gap: 8 }}>
          {groups.length > 1 ? <Txt muted small>{g.tenantName.toUpperCase()}</Txt> : null}
          {g.projects.map((p) => (
            <Card key={p.key} onPress={() => router.push({ pathname: '/project/[tenantId]/[project]', params: { tenantId: g.tenantId, project: p.key } })}>
              <Txt strong>{p.name}</Txt>
              {p.myRole ? <Txt muted small>{p.myRole}</Txt> : null}
            </Card>
          ))}
        </View>
      ))}

      {links.length ? <Txt muted small>FROM A LINK</Txt> : null}
      {links.map((l) => (
        <Card key={l.path} onPress={() => router.push({ pathname: '/fill', params: { kind: 'link', path: l.path } })}>
          <Txt strong>{l.name}</Txt>
          <Txt muted small>{l.projectName}</Txt>
        </Card>
      ))}

      <Button kind="secondary" title="Open a form link" onPress={() => router.push('/link')} />
      <View style={{ flexDirection: 'row', gap: 10 }}>
        <View style={{ flex: 1 }}><Button kind="secondary" title={`Outbox${sync.counts.waiting + sync.counts.attention + sync.counts.draft ? ` (${sync.counts.waiting + sync.counts.attention + sync.counts.draft})` : ''}`} onPress={() => router.push('/outbox')} /></View>
        <View style={{ flex: 1 }}><Button kind="secondary" title="Settings" onPress={() => router.push('/settings')} /></View>
      </View>
    </Screen>
  );
}
