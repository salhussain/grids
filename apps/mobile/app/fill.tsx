import { forFiller, defaultAnswers, questionsOf, type Answers } from '@grids/forms';
import { isLocalRef, type OutboxBlob } from '@grids/offline';
import { PROJECT_SUBJECT, uuidv7, type FormDefinition, type Question } from '@grids/schema';
import * as Location from 'expo-location';
import { router, Stack, useLocalSearchParams } from 'expo-router';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Alert, View } from 'react-native';
import { FillCtx } from '../src/form/context';
import { dropFile, type BlobMeta } from '../src/form/files';
import { checkAnswers, FormFiller } from '../src/form/FormFiller';
import { PlaceField } from '../src/form/inputs';
import { getLink } from '../src/store/links';
import { outboxStore, readDefinition, readForms, refreshCounts, syncAll } from '../src/sync';
import { scopeOf, type FormLite } from '../src/types';
import { Button, Card, Empty, Input, Notice, Screen, Txt } from '../src/ui';

interface Loaded {
  id: string;
  title: string;
  def: FormDefinition;
  version: number;
  target: { kind: 'project'; tenantId: string; project: string; form: string } | { kind: 'link'; path: string };
  subjectType: FormLite['subjectType'];
  askName: boolean;
  closedMessage: string | null;
  createdAt: number | undefined;
  answers: Answers;
  entityId: string | null;
  submitter: string;
  blobs: Record<string, BlobMeta>;
}

const refsIn = (v: unknown, out = new Set<string>()): Set<string> => {
  if (isLocalRef(v)) out.add(v.slice('local:'.length));
  else if (Array.isArray(v)) v.forEach((x) => refsIn(x, out));
  else if (v && typeof v === 'object') Object.values(v).forEach((x) => refsIn(x, out));
  return out;
};

async function load(p: { kind?: string; tenantId?: string; project?: string; form?: string; path?: string; draft?: string }): Promise<Loaded> {
  if (p.draft) {
    const item = await outboxStore.get(p.draft);
    if (!item) throw new Error('This draft is no longer on the device.');
    const blobs = Object.fromEntries((await outboxStore.blobs(item.id)).map((b) => [b.id, { id: b.id, name: b.name, contentType: b.contentType, uri: b.uri, size: b.size }]));
    if (item.target.kind === 'link') {
      const l = await getLink(item.target.path);
      if (!l) throw new Error('This link form is no longer saved on the device.');
      return { id: item.id, title: item.formName, def: l.definition, version: item.version, target: item.target, subjectType: null, askName: l.askName, closedMessage: null, createdAt: item.createdAt, answers: item.answers, entityId: null, submitter: item.submitter ?? '', blobs };
    }
    const forms = await readForms(item.target.tenantId, item.target.project);
    const form = forms.find((f) => f.key === (item.target as { form: string }).form);
    const kept = await readDefinition(item.target.tenantId, item.target.project, item.target.form, item.version);
    // The version it was started on is gone from the device (after signing out): carry on with the current one.
    const def = kept ?? form?.published;
    if (!def) throw new Error('The form this was started on is no longer on the device.');
    const version = kept ? item.version : (form?.currentVersion ?? item.version);
    return { id: item.id, title: item.formName, def, version, target: item.target, subjectType: form?.subjectType ?? null, askName: false, closedMessage: null, createdAt: item.createdAt, answers: item.answers, entityId: item.entityId, submitter: '', blobs };
  }
  if (p.kind === 'link') {
    const l = await getLink(p.path!);
    if (!l) throw new Error('This link is not saved on the device. Open it again while online.');
    return { id: uuidv7(), title: l.name, def: l.definition, version: l.version, target: { kind: 'link', path: l.path }, subjectType: null, askName: l.askName, closedMessage: null, createdAt: undefined, answers: defaultAnswers(l.definition), entityId: null, submitter: '', blobs: {} };
  }
  const forms = await readForms(p.tenantId!, p.project!);
  const form = forms.find((f) => f.key === p.form);
  if (!form?.published || form.currentVersion === null) throw new Error('This form is not on the device. Sync while online.');
  return {
    id: uuidv7(),
    title: form.name,
    def: form.published,
    version: form.currentVersion,
    target: { kind: 'project', tenantId: p.tenantId!, project: p.project!, form: form.key },
    subjectType: form.subjectType,
    askName: false,
    closedMessage: form.availability.state === 'open' ? null : (form.availability.message ?? 'This form is not open right now.'),
    createdAt: undefined,
    answers: defaultAnswers(form.published),
    entityId: null,
    submitter: '',
    blobs: {},
  };
}

export default function Fill() {
  const params = useLocalSearchParams<{ kind?: string; tenantId?: string; project?: string; form?: string; path?: string; draft?: string }>();
  const [loaded, setLoaded] = useState<Loaded | null>(null);
  const [failure, setFailure] = useState<string | null>(null);
  const [answers, setAnswers] = useState<Answers>({});
  const [blobs, setBlobs] = useState<Record<string, BlobMeta>>({});
  const [entityId, setEntityId] = useState<string | null>(null);
  const [submitter, setSubmitter] = useState('');
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [saving, setSaving] = useState(false);
  const dirty = useRef(false);
  const place = useRef<{ lat: number; lon: number } | null>(null);
  const collectedAt = useRef(new Date().toISOString());
  const finished = useRef(false);

  useEffect(() => {
    load(params)
      .then((l) => {
        setLoaded(l);
        setAnswers(l.answers);
        setBlobs(l.blobs);
        setEntityId(l.entityId);
        setSubmitter(l.submitter);
      })
      .catch((e: Error) => setFailure(e.message));
    // Where the form was filled in, when the person has allowed it. Never blocks.
    void (async () => {
      try {
        const perm = await Location.requestForegroundPermissionsAsync();
        if (!perm.granted) return;
        const last = await Location.getLastKnownPositionAsync();
        if (last) place.current = { lat: last.coords.latitude, lon: last.coords.longitude };
        const now = await Location.getCurrentPositionAsync({ accuracy: Location.Accuracy.Balanced });
        place.current = { lat: now.coords.latitude, lon: now.coords.longitude };
      } catch {
        /* no fix: the submission goes without a place */
      }
    })();
  }, []);

  const mainKey = useMemo(() => (loaded ? questionsOf(loaded.def).find((q: Question) => q.primary)?.key : undefined), [loaded]);
  const subjectId = mainKey ? ((answers[mainKey] as string | undefined) ?? null) : entityId;
  const needsSubject = !!loaded?.subjectType && loaded.subjectType.key !== PROJECT_SUBJECT && !mainKey;

  const blobList = useCallback((a: Answers): OutboxBlob[] => {
    const used = refsIn(a);
    return Object.values(blobs)
      .filter((b) => used.has(b.id))
      .map((b) => ({ id: b.id, itemId: loaded?.id ?? '', name: b.name, contentType: b.contentType, uri: b.uri, size: b.size, remoteId: null }));
  }, [blobs, loaded?.id]);

  const persist = useCallback(
    async (status: 'draft' | 'queued') => {
      if (!loaded) return;
      await outboxStore.save(
        {
          id: loaded.id,
          target: loaded.target,
          formName: loaded.title,
          version: loaded.version,
          entityId: subjectId,
          answers,
          collectedAt: collectedAt.current,
          location: place.current,
          submitter: loaded.target.kind === 'link' ? submitter.trim() || null : null,
          status,
          createdAt: loaded.createdAt,
        },
        blobList(answers),
      );
      await refreshCounts();
    },
    [loaded, subjectId, answers, submitter, blobList],
  );

  // An unfinished form is kept on the device as the person types.
  useEffect(() => {
    if (!loaded || !dirty.current || finished.current) return;
    const t = setTimeout(() => void persist('draft'), 800);
    return () => clearTimeout(t);
  }, [loaded, answers, entityId, submitter, persist]);

  const change = (next: Answers) => {
    dirty.current = true;
    setAnswers(next);
  };

  if (failure) return <Screen><Empty title="Cannot open this form" hint={failure} /></Screen>;
  if (!loaded) return <Screen><Txt muted>Loading…</Txt></Screen>;

  const def = forFiller(loaded.def);

  const submit = async () => {
    const result = checkAnswers(def, answers);
    const problems = { ...result.errors };
    if (needsSubject && !subjectId) problems['$subject'] = 'Choose one';
    if (Object.keys(problems).length) {
      setErrors(problems);
      Alert.alert('Some answers need attention', 'Check the questions marked in red.');
      return;
    }
    setSaving(true);
    finished.current = true;
    try {
      await persist('queued');
      void syncAll(false);
      Alert.alert('Saved on this device', 'It will be sent when there is a connection.', [{ text: 'OK', onPress: () => router.back() }]);
    } finally {
      setSaving(false);
    }
  };

  const discard = () =>
    Alert.alert('Discard this form?', 'What you entered will be deleted.', [
      { text: 'Keep', style: 'cancel' },
      {
        text: 'Discard',
        style: 'destructive',
        onPress: async () => {
          finished.current = true;
          for (const b of Object.values(blobs)) dropFile(b.uri);
          await outboxStore.remove(loaded.id);
          await refreshCounts();
          router.back();
        },
      },
    ]);

  return (
    <Screen>
      <Stack.Screen options={{ title: loaded.title }} />
      {loaded.closedMessage ? <Notice text={`${loaded.closedMessage} The server decides when you send it.`} /> : null}
      <FillCtx.Provider
        value={{
          scope: loaded.target.kind === 'project' ? scopeOf(loaded.target.tenantId, loaded.target.project) : null,
          linkPath: loaded.target.kind === 'link' ? loaded.target.path : null,
          subjectId,
          answers,
          blobs,
          addBlob: (b) => setBlobs((s) => ({ ...s, [b.id]: b })),
        }}
      >
        {needsSubject ? (
          <Card style={{ gap: 6 }}>
            <Txt strong>{`Which ${loaded.subjectType!.name.toLowerCase()} is this about?`}</Txt>
            <PlaceField
              q={{ key: '$subject', type: 'entity', label: loaded.subjectType!.name, entityType: loaded.subjectType!.key } as Question}
              value={entityId ?? undefined}
              onChange={(v) => {
                dirty.current = true;
                setEntityId(v ?? null);
              }}
              invalid={!!errors['$subject']}
            />
            {errors['$subject'] ? <Txt small color="#c62828">{errors['$subject']}</Txt> : null}
          </Card>
        ) : null}
        {loaded.askName ? (
          <Card style={{ gap: 6 }}>
            <Txt strong>Your name or email</Txt>
            <Input
              value={submitter}
              onChangeText={(t) => {
                dirty.current = true;
                setSubmitter(t);
              }}
              autoCapitalize="none"
            />
          </Card>
        ) : null}
        <FormFiller def={def} answers={answers} onChange={change} errors={errors} />
      </FillCtx.Provider>
      <Button title="Save to send" busy={saving} onPress={submit} />
      <Button kind="danger" title="Discard" onPress={discard} />
      <View style={{ height: 24 }} />
    </Screen>
  );
}

