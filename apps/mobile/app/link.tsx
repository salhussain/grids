import { SyncError } from '@grids/offline';
import type { PublicPlaceDto } from '@grids/schema';
import { questionsOf } from '@grids/forms';
import { router } from 'expo-router';
import { useState } from 'react';
import { api } from '../src/api';
import { pathFromLink, saveLink } from '../src/store/links';
import { Button, Card, Input, Notice, Screen, Txt } from '../src/ui';

export default function OpenLink() {
  const [text, setText] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const open = async () => {
    const path = pathFromLink(text);
    if (!path) return setError('That does not look like a form link. Paste the whole address.');
    setBusy(true);
    setError(null);
    try {
      const form = await api.linkForm(path);
      if (form.availability.state !== 'open') return setError(form.availability.message ?? 'This form is not open.');
      // Checking an email address or solving a puzzle needs the server at the moment of sending.
      if (form.verifyEmail || form.captcha) return setError('This link checks the sender online when it is sent, so it cannot be filled in offline. Open it in a browser.');
      // Places a question offers are kept with the link: the ones that do not depend on another answer.
      const places: Record<string, PublicPlaceDto[]> = {};
      for (const q of questionsOf(form.definition)) {
        if (q.type !== 'entity') continue;
        try {
          places[q.key] = await api.linkPlaces(path, q.key);
        } catch {
          /* a question that depends on another answer is offered online only */
        }
      }
      await saveLink(path, form, places);
      router.replace({ pathname: '/fill', params: { kind: 'link', path } });
    } catch (e) {
      setError(e instanceof SyncError && e.status === undefined ? 'You need a connection to open a link the first time.' : e instanceof Error ? e.message : 'Could not open the link.');
    } finally {
      setBusy(false);
    }
  };

  return (
    <Screen>
      <Card style={{ gap: 8 }}>
        <Txt strong>Paste the link you were given</Txt>
        <Txt muted small>The form is kept on this device, so you can fill it in without a connection.</Txt>
        <Input value={text} onChangeText={setText} placeholder="https://…/f/…" autoCapitalize="none" autoCorrect={false} multiline />
      </Card>
      {error ? <Notice tone="danger" text={error} /> : null}
      <Button title="Open" busy={busy} disabled={!text.trim()} onPress={open} />
    </Screen>
  );
}
