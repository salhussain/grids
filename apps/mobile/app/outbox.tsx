import type { OutboxItem } from '@grids/offline';
import { router, useFocusEffect } from 'expo-router';
import { useCallback, useState } from 'react';
import { Alert, View } from 'react-native';
import { dropFile } from '../src/form/files';
import { SyncBar } from '../src/SyncBar';
import { outbox, outboxStore, refreshCounts, syncAll, useSyncStatus } from '../src/sync';
import { Badge, Button, Card, Empty, Screen, Txt, when } from '../src/ui';

const STATE = {
  draft: { tone: 'muted', text: 'Unfinished' },
  queued: { tone: 'primary', text: 'Waiting to send' },
  sending: { tone: 'primary', text: 'Sending' },
  needs_attention: { tone: 'danger', text: 'Needs attention' },
  sent: { tone: 'ok', text: 'Sent' },
} as const;

export default function Outbox() {
  const sync = useSyncStatus();
  const [items, setItems] = useState<OutboxItem[]>([]);
  const [foreign, setForeign] = useState(0);

  useFocusEffect(
    useCallback(() => {
      let live = true;
      (async () => {
        const [list, other] = await Promise.all([outboxStore.list(['draft', 'queued', 'sending', 'needs_attention', 'sent']), outboxStore.foreignWaiting()]);
        if (live) {
          setItems(list);
          setForeign(other);
        }
      })();
      return () => {
        live = false;
      };
    }, [sync.version]),
  );

  const remove = (item: OutboxItem) =>
    Alert.alert('Delete this form?', item.status === 'sent' ? 'It stays on the server.' : 'It has not been sent. It will be lost.', [
      { text: 'Keep', style: 'cancel' },
      {
        text: 'Delete',
        style: 'destructive',
        onPress: async () => {
          for (const b of await outboxStore.blobs(item.id)) dropFile(b.uri);
          await outboxStore.remove(item.id);
          await refreshCounts();
        },
      },
    ]);

  const order = ['needs_attention', 'sending', 'queued', 'draft', 'sent'];
  const sorted = [...items].sort((a, b) => order.indexOf(a.status) - order.indexOf(b.status) || b.createdAt - a.createdAt);

  return (
    <Screen>
      <SyncBar />
      {foreign ? <Txt small muted>{`${foreign} more belong to another account on this device and are sent when that account signs in.`}</Txt> : null}
      {sorted.length === 0 ? <Empty title="Nothing here" hint="Forms you fill in wait here until they are sent." /> : null}
      {sorted.map((item) => {
        const st = STATE[item.status];
        return (
          <Card key={item.id}>
            <View style={{ flexDirection: 'row', justifyContent: 'space-between', gap: 8 }}>
              <View style={{ flex: 1 }}>
                <Txt strong>{item.formName}</Txt>
                <Txt muted small>{when(item.sentAt ?? item.createdAt)}</Txt>
              </View>
              <Badge tone={st.tone} text={st.text} />
            </View>
            {item.lastError ? <Txt small color="#c62828">{item.lastError}</Txt> : null}
            <View style={{ flexDirection: 'row', gap: 8, marginTop: 8, flexWrap: 'wrap' }}>
              {item.status === 'draft' ? <Button small title="Continue" onPress={() => router.push({ pathname: '/fill', params: { draft: item.id } })} /> : null}
              {item.status === 'needs_attention' ? (
                <>
                  <Button small title="Fix it" onPress={() => router.push({ pathname: '/fill', params: { draft: item.id } })} />
                  <Button small kind="secondary" title="Send again" onPress={async () => { await outbox.retry(item.id); void syncAll(true); }} />
                </>
              ) : null}
              {item.status === 'queued' ? <Button small kind="secondary" title="Send now" onPress={() => void syncAll(true)} /> : null}
              {item.status !== 'sending' ? <Button small kind="danger" title="Delete" onPress={() => remove(item)} /> : null}
            </View>
          </Card>
        );
      })}
    </Screen>
  );
}
