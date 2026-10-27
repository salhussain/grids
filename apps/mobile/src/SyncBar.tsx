import { View } from 'react-native';
import { useSyncStatus, syncAll } from './sync';
import { useSession } from './session';
import { Button, Txt, useTheme, when } from './ui';

/** Where the device stands: connection, what is waiting to go up, and a button to send it now. */
export function SyncBar() {
  const c = useTheme();
  const s = useSyncStatus();
  const { session, signIn } = useSession();
  const { waiting, attention, draft } = s.counts;
  const line = s.running
    ? 'Syncing…'
    : !s.online
      ? 'Offline'
      : s.signedOut
        ? 'Sign in again to send'
        : waiting
          ? `${waiting} waiting to send`
          : s.lastSyncAt
            ? `Up to date · ${when(s.lastSyncAt)}`
            : 'Ready';
  const tone = !s.online ? c.warn : s.signedOut || attention ? c.danger : waiting ? c.primary : c.ok;
  return (
    <View style={{ backgroundColor: c.card, borderRadius: 12, borderWidth: 1, borderColor: c.line, padding: 12, gap: 8 }}>
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
        <View style={{ width: 10, height: 10, borderRadius: 5, backgroundColor: tone }} />
        <View style={{ flex: 1 }}>
          <Txt strong>{line}</Txt>
          {attention ? <Txt small color={c.danger}>{`${attention} need${attention === 1 ? 's' : ''} attention`}</Txt> : null}
          {draft ? <Txt small muted>{`${draft} unfinished`}</Txt> : null}
          {s.error ? <Txt small color={c.danger}>{s.error}</Txt> : null}
        </View>
        {s.signedOut || !session ? (
          session || waiting ? <Button small title="Sign in" onPress={() => void signIn()} /> : null
        ) : (
          <Button small kind="secondary" title="Sync now" busy={s.running} onPress={() => void syncAll(true)} />
        )}
      </View>
    </View>
  );
}
