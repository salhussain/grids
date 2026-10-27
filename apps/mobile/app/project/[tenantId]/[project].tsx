import { router, useFocusEffect, useLocalSearchParams, Stack } from 'expo-router';
import { useCallback, useState } from 'react';
import { View } from 'react-native';
import { SyncBar } from '../../../src/SyncBar';
import { readForms, readProjects, useSyncStatus } from '../../../src/sync';
import { placeCount } from '../../../src/store/places';
import { scopeOf, type FormLite } from '../../../src/types';
import { Badge, Button, Card, Empty, Screen, Txt } from '../../../src/ui';

export default function ProjectForms() {
  const { tenantId, project } = useLocalSearchParams<{ tenantId: string; project: string }>();
  const sync = useSyncStatus();
  const [forms, setForms] = useState<FormLite[]>([]);
  const [name, setName] = useState('');
  const [places, setPlaces] = useState(0);

  useFocusEffect(
    useCallback(() => {
      let live = true;
      (async () => {
        const [f, p, n] = await Promise.all([readForms(tenantId!, project!), readProjects(tenantId!), placeCount(scopeOf(tenantId!, project!))]);
        if (!live) return;
        setForms(f.filter((x) => x.canFill));
        setName(p.find((x) => x.key === project)?.name ?? project!);
        setPlaces(n);
      })();
      return () => {
        live = false;
      };
    }, [tenantId, project, sync.version]),
  );

  return (
    <Screen>
      <Stack.Screen options={{ title: name || 'Forms' }} />
      <SyncBar />
      {forms.length === 0 ? <Empty title="No forms to fill in" hint="Forms you may fill in appear here after the first sync." /> : null}
      {forms.map((f) => {
        const closed = f.availability.state !== 'open';
        return (
          <Card key={f.key} onPress={() => router.push({ pathname: '/fill', params: { kind: 'project', tenantId, project, form: f.key } })}>
            <View style={{ flexDirection: 'row', justifyContent: 'space-between', gap: 8 }}>
              <View style={{ flex: 1 }}>
                <Txt strong>{f.name}</Txt>
                {f.description ? <Txt muted small numberOfLines={2}>{f.description}</Txt> : null}
              </View>
              {closed ? <Badge tone="warn" text={f.availability.message ?? 'Closed'} /> : null}
            </View>
          </Card>
        );
      })}
      <Txt muted small>{places ? `${places.toLocaleString()} places on this device for the place questions.` : 'No places downloaded yet.'}</Txt>
      <Button kind="secondary" title="Sent from this account" onPress={() => router.push({ pathname: '/history/[tenantId]/[project]', params: { tenantId: tenantId!, project: project! } })} />
    </Screen>
  );
}
