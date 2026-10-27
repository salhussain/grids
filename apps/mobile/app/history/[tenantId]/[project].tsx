import { useFocusEffect, useLocalSearchParams } from 'expo-router';
import { useCallback, useState } from 'react';
import { View } from 'react-native';
import { readHistory, useSyncStatus } from '../../../src/sync';
import type { HistoryRow } from '../../../src/types';
import { Badge, Card, Empty, Screen, Txt, when } from '../../../src/ui';

const TONE: Record<string, 'ok' | 'danger' | 'warn' | 'primary' | 'muted'> = { approved: 'ok', rejected: 'danger', returned: 'warn', in_review: 'primary', complete: 'muted' };
const WORDS: Record<string, string> = { approved: 'Approved', rejected: 'Rejected', returned: 'Sent back', in_review: 'In review', complete: 'Received' };

export default function History() {
  const { tenantId, project } = useLocalSearchParams<{ tenantId: string; project: string }>();
  const sync = useSyncStatus();
  const [rows, setRows] = useState<HistoryRow[]>([]);
  const [at, setAt] = useState<number | null>(null);

  useFocusEffect(
    useCallback(() => {
      let live = true;
      void readHistory(tenantId!, project!).then((h) => {
        if (live) {
          setRows(h?.value ?? []);
          setAt(h?.fetchedAt ?? null);
        }
      });
      return () => {
        live = false;
      };
    }, [tenantId, project, sync.version]),
  );

  return (
    <Screen>
      {at ? <Txt muted small>{`As of ${when(at)}. Read only.`}</Txt> : null}
      {rows.length === 0 ? <Empty title="Nothing sent yet" hint="Forms you send show up here after a sync." /> : null}
      {rows.map((r) => (
        <Card key={r.id}>
          <View style={{ flexDirection: 'row', justifyContent: 'space-between', gap: 8 }}>
            <View style={{ flex: 1 }}>
              <Txt strong>{r.formName}</Txt>
              {r.entity ? <Txt muted small>{r.entity}</Txt> : null}
              <Txt muted small>{when(r.submittedAt)}</Txt>
            </View>
            <Badge tone={TONE[r.status] ?? 'muted'} text={r.outcome ?? r.stageName ?? WORDS[r.status] ?? r.status} />
          </View>
        </Card>
      ))}
    </Screen>
  );
}
