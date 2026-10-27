import { router } from 'expo-router';
import { Alert } from 'react-native';
import { SyncBar } from '../src/SyncBar';
import { env } from '../src/env';
import { useSession } from '../src/session';
import { useSyncStatus } from '../src/sync';
import { Button, Card, Screen, Txt, when } from '../src/ui';

export default function Settings() {
  const { session, signIn, signOut } = useSession();
  const sync = useSyncStatus();
  const unsent = sync.counts.waiting + sync.counts.attention;

  const out = () =>
    Alert.alert(
      'Sign out?',
      unsent
        ? `${unsent} form${unsent === 1 ? ' is' : 's are'} still waiting to be sent. They stay on this device and are sent when you sign in again.`
        : 'Downloaded places are removed from this device.',
      [
        { text: 'Cancel', style: 'cancel' },
        { text: 'Sign out', style: 'destructive', onPress: () => void signOut().then(() => router.replace('/')) },
      ],
    );

  return (
    <Screen>
      <SyncBar />
      <Card>
        <Txt strong>Account</Txt>
        <Txt muted small>{session ? 'Signed in' : 'Not signed in'}</Txt>
        {session ? <Button kind="danger" title="Sign out" onPress={out} /> : <Button title="Sign in" onPress={() => void signIn()} />}
      </Card>
      <Card>
        <Txt strong>This device</Txt>
        <Txt muted small>{`Last synced: ${sync.lastSyncAt ? when(sync.lastSyncAt) : 'not yet'}`}</Txt>
        <Txt muted small>{`Waiting to send: ${sync.counts.waiting}`}</Txt>
        <Txt muted small>{`Unfinished: ${sync.counts.draft}`}</Txt>
        <Txt muted small>{`Needs attention: ${sync.counts.attention}`}</Txt>
      </Card>
      <Card>
        <Txt strong>Server</Txt>
        <Txt muted small>{env.apiUrl}</Txt>
      </Card>
    </Screen>
  );
}
