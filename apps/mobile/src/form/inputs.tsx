import { localRef } from '@grids/offline';
import type { Question } from '@grids/schema';
import DateTimePicker, { DateTimePickerAndroid, type DateTimePickerEvent } from '@react-native-community/datetimepicker';
import { CameraView, useCameraPermissions } from 'expo-camera';
import * as DocumentPicker from 'expo-document-picker';
import * as ImagePicker from 'expo-image-picker';
import * as Location from 'expo-location';
import { useEffect, useMemo, useRef, useState } from 'react';
import { FlatList, Image, Modal, PanResponder, Platform, Pressable, View } from 'react-native';
import Svg, { Path } from 'react-native-svg';
import { linkPlaces } from '../store/links';
import { findPlaces, placeById, placesAbove, placesUnder, type Place } from '../store/places';
import { Button, Input, Txt, useTheme } from '../ui';
import { useFill } from './context';
import { dropFile, fromBase64, keepBytes, keepFile } from './files';

export interface InputProps<T = unknown> {
  q: Question;
  value: T;
  onChange(v: T | undefined): void;
  invalid: boolean;
}

// ------------------------------------------------------------------ text and numbers

export function TextInputField({ q, value, onChange, invalid }: InputProps<string | undefined>) {
  const kind = q.type;
  const generated = kind === 'text' && !!q.generate;
  return (
    <Input
      value={value ?? ''}
      invalid={invalid}
      editable={!generated}
      multiline={kind === 'textarea'}
      numberOfLines={kind === 'textarea' ? (q.rows ?? 4) : 1}
      maxLength={q.maxLength}
      placeholder={q.placeholder}
      autoCapitalize={kind === 'email' || kind === 'url' ? 'none' : 'sentences'}
      autoCorrect={kind === 'text' || kind === 'textarea'}
      keyboardType={kind === 'email' ? 'email-address' : kind === 'phone' ? 'phone-pad' : kind === 'url' ? 'url' : 'default'}
      onChangeText={(t) => onChange(t === '' ? undefined : t)}
      style={generated ? { opacity: 0.7 } : undefined}
    />
  );
}

export function NumberField({ q, value, onChange, invalid }: InputProps<number | undefined>) {
  // The text is kept as typed ("12." on the way to "12.5"); the answer is its number.
  const [text, setText] = useState(value === undefined ? '' : String(value));
  useEffect(() => {
    if (value !== undefined && Number(text) !== value) setText(String(value));
    if (value === undefined && text !== '' && !Number.isNaN(Number(text))) setText('');
  }, [value]);
  return (
    <Input
      value={text}
      invalid={invalid}
      placeholder={q.placeholder}
      keyboardType={q.type === 'integer' ? 'number-pad' : 'decimal-pad'}
      onChangeText={(t) => {
        const clean = t.replace(',', '.');
        setText(clean);
        const n = Number(clean);
        onChange(clean.trim() === '' || Number.isNaN(n) ? undefined : n);
      }}
    />
  );
}

// ------------------------------------------------------------------ choices

function Radio({ on, label, onPress, multi }: { on: boolean; label: string; onPress: () => void; multi?: boolean }) {
  const c = useTheme();
  return (
    <Pressable accessibilityRole={multi ? 'checkbox' : 'radio'} accessibilityState={{ checked: on }} onPress={onPress} style={{ flexDirection: 'row', alignItems: 'center', gap: 10, paddingVertical: 8 }}>
      <View style={{ width: 22, height: 22, borderRadius: multi ? 5 : 11, borderWidth: 2, borderColor: on ? c.primary : c.line, alignItems: 'center', justifyContent: 'center' }}>
        {on ? <View style={{ width: 12, height: 12, borderRadius: multi ? 2 : 6, backgroundColor: c.primary }} /> : null}
      </View>
      <View style={{ flex: 1 }}>
        <Txt>{label}</Txt>
      </View>
    </Pressable>
  );
}

export function SelectField({ q, value, onChange }: InputProps<string | undefined>) {
  const options = q.options ?? [];
  const [open, setOpen] = useState(false);
  if (options.length > 8) {
    const current = options.find((o) => o.value === value);
    return (
      <>
        <Pressable onPress={() => setOpen(true)}>
          <Input editable={false} pointerEvents="none" value={current?.label ?? ''} placeholder={q.placeholder ?? 'Choose…'} />
        </Pressable>
        <Sheet visible={open} title={q.label} onClose={() => setOpen(false)}>
          <SearchList
            load={async (s) => options.filter((o) => o.label.toLowerCase().includes(s.toLowerCase())).map((o) => ({ id: o.value, title: o.label }))}
            onPick={(id) => {
              onChange(id);
              setOpen(false);
            }}
          />
        </Sheet>
      </>
    );
  }
  return (
    <View>
      {options.map((o) => (
        <Radio key={o.value} on={value === o.value} label={o.label} onPress={() => onChange(value === o.value ? undefined : o.value)} />
      ))}
    </View>
  );
}

export function MultiSelectField({ q, value, onChange }: InputProps<string[] | undefined>) {
  const chosen = value ?? [];
  return (
    <View>
      {(q.options ?? []).map((o) => (
        <Radio
          key={o.value}
          multi
          on={chosen.includes(o.value)}
          label={o.label}
          onPress={() => {
            const next = chosen.includes(o.value) ? chosen.filter((x) => x !== o.value) : [...chosen, o.value];
            onChange(next.length ? next : undefined);
          }}
        />
      ))}
    </View>
  );
}

export function BooleanField({ value, onChange }: InputProps<boolean | undefined>) {
  return (
    <View style={{ flexDirection: 'row', gap: 10 }}>
      <View style={{ flex: 1 }}>
        <Button title="Yes" kind={value === true ? 'primary' : 'secondary'} onPress={() => onChange(value === true ? undefined : true)} />
      </View>
      <View style={{ flex: 1 }}>
        <Button title="No" kind={value === false ? 'primary' : 'secondary'} onPress={() => onChange(value === false ? undefined : false)} />
      </View>
    </View>
  );
}

export function RatingField({ q, value, onChange }: InputProps<number | undefined>) {
  const c = useTheme();
  const max = q.max ?? 5;
  return (
    <View style={{ flexDirection: 'row', gap: 6 }}>
      {Array.from({ length: max }, (_, i) => i + 1).map((n) => (
        <Pressable key={n} accessibilityLabel={`${n} of ${max}`} onPress={() => onChange(value === n ? undefined : n)}>
          <Txt style={{ fontSize: 32, color: value !== undefined && n <= value ? c.warn : c.line }}>★</Txt>
        </Pressable>
      ))}
    </View>
  );
}

// ------------------------------------------------------------------ dates

const pad = (n: number) => String(n).padStart(2, '0');
const dateText = (d: Date) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
const timeText = (d: Date) => `${pad(d.getHours())}:${pad(d.getMinutes())}`;

const parse = (kind: string, v: string | undefined): Date => {
  if (!v) return new Date();
  if (kind === 'time') {
    const [h, m] = v.split(':').map(Number);
    const d = new Date();
    d.setHours(h ?? 0, m ?? 0, 0, 0);
    return d;
  }
  if (kind === 'date') {
    const [y, m, d] = v.split('-').map(Number);
    return new Date(y ?? 1970, (m ?? 1) - 1, d ?? 1);
  }
  return new Date(v);
};

export function DateField({ q, value, onChange }: InputProps<string | undefined>) {
  const kind = q.type as 'date' | 'datetime' | 'time';
  const [iosOpen, setIosOpen] = useState(false);
  const current = parse(kind, value);
  const commit = (d: Date) => onChange(kind === 'date' ? dateText(d) : kind === 'time' ? timeText(d) : d.toISOString());
  const show = kind === 'date' ? (value ?? '') : kind === 'time' ? (value ?? '') : value ? current.toLocaleString() : '';

  const open = () => {
    if (Platform.OS === 'ios') return setIosOpen((o) => !o);
    const base = current;
    const pickTime = (day: Date) =>
      DateTimePickerAndroid.open({ value: day, mode: 'time', is24Hour: true, onChange: (e: DateTimePickerEvent, d?: Date) => e.type === 'set' && d && commit(d) });
    if (kind === 'time') pickTime(base);
    else
      DateTimePickerAndroid.open({
        value: base,
        mode: 'date',
        onChange: (e: DateTimePickerEvent, d?: Date) => {
          if (e.type !== 'set' || !d) return;
          if (kind === 'date') commit(d);
          else pickTime(d);
        },
      });
  };
  return (
    <View style={{ gap: 8 }}>
      <View style={{ flexDirection: 'row', gap: 8 }}>
        <Pressable style={{ flex: 1 }} onPress={open}>
          <Input editable={false} pointerEvents="none" value={show} placeholder={q.placeholder ?? (kind === 'time' ? 'Choose a time' : 'Choose a date')} />
        </Pressable>
        {value ? <Button small kind="secondary" title="Clear" onPress={() => onChange(undefined)} /> : null}
      </View>
      {Platform.OS === 'ios' && iosOpen ? (
        <DateTimePicker value={current} mode={kind === 'datetime' ? 'datetime' : kind} display="spinner" onChange={(_e: DateTimePickerEvent, d?: Date) => d && commit(d)} />
      ) : null}
    </View>
  );
}

// ------------------------------------------------------------------ where, scans

export function GeoField({ value, onChange }: InputProps<{ lat: number; lon: number } | undefined>) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const here = async () => {
    setBusy(true);
    setError(null);
    try {
      const ok = await Location.requestForegroundPermissionsAsync();
      if (!ok.granted) return setError('Allow location access in Settings to record where you are.');
      const p = await Location.getCurrentPositionAsync({ accuracy: Location.Accuracy.High });
      onChange({ lat: Number(p.coords.latitude.toFixed(6)), lon: Number(p.coords.longitude.toFixed(6)) });
    } catch {
      setError('Could not find your location. Try again outside or with location turned on.');
    } finally {
      setBusy(false);
    }
  };
  return (
    <View style={{ gap: 8 }}>
      {value ? <Txt>{`${value.lat}, ${value.lon}`}</Txt> : null}
      <View style={{ flexDirection: 'row', gap: 8 }}>
        <Button small busy={busy} title={value ? 'Update location' : 'Use my location'} onPress={here} />
        {value ? <Button small kind="secondary" title="Clear" onPress={() => onChange(undefined)} /> : null}
      </View>
      {error ? <Txt small color="#c62828">{error}</Txt> : null}
    </View>
  );
}

export function ScanField({ q, value, onChange, invalid }: InputProps<string | undefined>) {
  const [scanning, setScanning] = useState(false);
  const [perm, ask] = useCameraPermissions();
  const done = useRef(false);
  return (
    <View style={{ gap: 8 }}>
      <Input value={value ?? ''} invalid={invalid} placeholder={q.placeholder ?? 'Scan or type a code'} autoCapitalize="none" onChangeText={(t) => onChange(t === '' ? undefined : t)} />
      <Button
        small
        kind="secondary"
        title="Scan a code"
        onPress={async () => {
          if (!perm?.granted && !(await ask()).granted) return;
          done.current = false;
          setScanning(true);
        }}
      />
      <Sheet visible={scanning} title="Scan a code" onClose={() => setScanning(false)}>
        <CameraView
          style={{ flex: 1 }}
          facing="back"
          onBarcodeScanned={({ data }) => {
            if (done.current) return;
            done.current = true;
            onChange(data.slice(0, 500));
            setScanning(false);
          }}
        />
      </Sheet>
    </View>
  );
}

// ------------------------------------------------------------------ pictures and files

const asList = (v: unknown): string[] => (Array.isArray(v) ? (v as string[]) : typeof v === 'string' ? [v] : []);

function Attachments({ q, value, onChange, children }: { q: Question; value: unknown; onChange(v: string | string[] | undefined): void; children: (add: (ref: string) => void) => React.ReactNode }) {
  const { blobs } = useFill();
  const refs = asList(value);
  const max = q.multiple ? (q.maxItems ?? 10) : 1;
  const set = (list: string[]) => onChange(list.length === 0 ? undefined : q.multiple ? list : list[0]);
  return (
    <View style={{ gap: 8 }}>
      {refs.map((r) => {
        const b = blobs[r.replace(/^local:/, '')];
        return (
          <View key={r} style={{ flexDirection: 'row', alignItems: 'center', gap: 10 }}>
            {b && b.contentType.startsWith('image/') ? <Image source={{ uri: b.uri }} style={{ width: 72, height: 72, borderRadius: 8 }} /> : null}
            <View style={{ flex: 1 }}>
              <Txt numberOfLines={1}>{b?.name ?? 'Already sent'}</Txt>
              {b ? <Txt muted small>{`${Math.max(1, Math.round(b.size / 1024))} KB`}</Txt> : null}
            </View>
            <Button small kind="danger" title="Remove" onPress={() => { if (b) dropFile(b.uri); set(refs.filter((x) => x !== r)); }} />
          </View>
        );
      })}
      {refs.length < max ? children((ref) => set([...refs, ref])) : null}
    </View>
  );
}

export function ImageField({ q, value, onChange }: InputProps) {
  const { addBlob } = useFill();
  const [error, setError] = useState<string | null>(null);
  const take = async (add: (ref: string) => void, camera: boolean) => {
    setError(null);
    try {
      const perm = camera ? await ImagePicker.requestCameraPermissionsAsync() : await ImagePicker.requestMediaLibraryPermissionsAsync();
      if (!perm.granted) return setError(camera ? 'Allow camera access in Settings to take pictures.' : 'Allow photo access in Settings to choose pictures.');
      const r = await (camera ? ImagePicker.launchCameraAsync : ImagePicker.launchImageLibraryAsync)({ mediaTypes: ['images'], quality: 0.7 });
      const a = r.assets?.[0];
      if (r.canceled || !a) return;
      const b = keepFile(a.uri, a.fileName ?? 'picture.jpg', a.mimeType ?? 'image/jpeg');
      addBlob(b);
      add(localRef(b.id));
    } catch {
      setError('Could not add the picture.');
    }
  };
  return (
    <Attachments q={q} value={value} onChange={onChange as never}>
      {(add) => (
        <View style={{ gap: 6 }}>
          <View style={{ flexDirection: 'row', gap: 8 }}>
            <Button small title="Take a picture" onPress={() => take(add, true)} />
            <Button small kind="secondary" title="Choose one" onPress={() => take(add, false)} />
          </View>
          {error ? <Txt small color="#c62828">{error}</Txt> : null}
        </View>
      )}
    </Attachments>
  );
}

export function FileField({ q, value, onChange }: InputProps) {
  const { addBlob } = useFill();
  const [error, setError] = useState<string | null>(null);
  return (
    <Attachments q={q} value={value} onChange={onChange as never}>
      {(add) => (
        <View style={{ gap: 6 }}>
          <Button
            small
            title="Choose a file"
            onPress={async () => {
              setError(null);
              try {
                const r = await DocumentPicker.getDocumentAsync({ copyToCacheDirectory: true });
                const a = r.assets?.[0];
                if (r.canceled || !a) return;
                const b = keepFile(a.uri, a.name, a.mimeType ?? 'application/octet-stream');
                addBlob(b);
                add(localRef(b.id));
              } catch {
                setError('Could not add the file.');
              }
            }}
          />
          {error ? <Txt small color="#c62828">{error}</Txt> : null}
        </View>
      )}
    </Attachments>
  );
}

// ------------------------------------------------------------------ signature

export function SignatureField({ q, value, onChange }: InputProps) {
  const { blobs, addBlob } = useFill();
  const [open, setOpen] = useState(false);
  const ref = asList(value)[0];
  const b = ref ? blobs[ref.replace(/^local:/, '')] : undefined;
  return (
    <View style={{ gap: 8 }}>
      {b ? <Image source={{ uri: b.uri }} style={{ width: '100%', height: 120, backgroundColor: '#fff', borderRadius: 8 }} resizeMode="contain" /> : ref ? <Txt muted small>Signed</Txt> : null}
      <View style={{ flexDirection: 'row', gap: 8 }}>
        <Button small title={ref ? 'Sign again' : 'Sign'} onPress={() => setOpen(true)} />
        {ref ? <Button small kind="secondary" title="Clear" onPress={() => { if (b) dropFile(b.uri); onChange(undefined); }} /> : null}
      </View>
      <Sheet visible={open} title={q.label} onClose={() => setOpen(false)}>
        <SignaturePad
          onDone={(png) => {
            const meta = keepBytes(fromBase64(png), 'signature.png', 'image/png');
            addBlob(meta);
            onChange(localRef(meta.id));
            setOpen(false);
          }}
        />
      </Sheet>
    </View>
  );
}

function SignaturePad({ onDone }: { onDone(pngBase64: string): void }) {
  const [strokes, setStrokes] = useState<string[]>([]);
  const [live, setLive] = useState('');
  const svg = useRef<{ toDataURL(cb: (b64: string) => void): void } | null>(null);
  const current = useRef('');
  const pan = useMemo(
    () =>
      PanResponder.create({
        onStartShouldSetPanResponder: () => true,
        onMoveShouldSetPanResponder: () => true,
        onPanResponderGrant: (e) => {
          current.current = `M${e.nativeEvent.locationX.toFixed(1)},${e.nativeEvent.locationY.toFixed(1)}`;
          setLive(current.current);
        },
        onPanResponderMove: (e) => {
          current.current += ` L${e.nativeEvent.locationX.toFixed(1)},${e.nativeEvent.locationY.toFixed(1)}`;
          setLive(current.current);
        },
        onPanResponderRelease: () => {
          const stroke = current.current;
          current.current = '';
          setLive('');
          if (stroke) setStrokes((s) => [...s, stroke]);
        },
      }),
    [],
  );
  return (
    <View style={{ flex: 1, padding: 16, gap: 12 }}>
      <View {...pan.panHandlers} style={{ flex: 1, backgroundColor: '#fff', borderRadius: 12, borderWidth: 1, borderColor: '#cfd4dc' }}>
        <Svg ref={(r) => { svg.current = r as never; }} width="100%" height="100%">
          {[...strokes, live].filter(Boolean).map((d, i) => (
            <Path key={i} d={d} stroke="#111" strokeWidth={3} strokeLinecap="round" strokeLinejoin="round" fill="none" />
          ))}
        </Svg>
      </View>
      <View style={{ flexDirection: 'row', gap: 8 }}>
        <View style={{ flex: 1 }}><Button kind="secondary" title="Clear" onPress={() => setStrokes([])} /></View>
        <View style={{ flex: 1 }}><Button title="Done" disabled={!strokes.length} onPress={() => svg.current?.toDataURL((b64) => onDone(b64))} /></View>
      </View>
    </View>
  );
}

// ------------------------------------------------------------------ places

export function PlaceField({ q, value, onChange, invalid }: InputProps<string | undefined>) {
  const { scope, linkPath, subjectId, answers } = useFill();
  const [open, setOpen] = useState(false);
  const [name, setName] = useState<string | null>(null);
  const [waiting, setWaiting] = useState<string | null>(null);

  // The places this question may offer: all of its type, or those related to another answer.
  const restrict = async (): Promise<{ ids?: string[]; blocked?: string }> => {
    if (!q.filter || !scope) return {};
    const base = q.filter.of === '$subject' ? subjectId : (answers[q.filter.of] as string | undefined);
    if (!base) return { blocked: q.filter.of === '$subject' ? 'Choose what this form is about first.' : 'Answer the question above first.' };
    const ids = q.filter.relation === 'children' || q.filter.relation === 'descendants' ? await placesUnder(scope, base, q.filter.relation) : await placesAbove(scope, base, q.filter.relation);
    return { ids };
  };

  useEffect(() => {
    let live = true;
    (async () => {
      let found: string | null = null;
      if (value && scope) found = (await placeById(scope, value))?.name ?? 'Unknown place';
      else if (value && linkPath) found = (await linkPlaces(linkPath, q.key)).find((p) => p.id === value)?.name ?? 'Unknown place';
      if (live) setName(found);
    })();
    return () => {
      live = false;
    };
  }, [value, scope, linkPath, q.key]);

  const load = async (search: string) => {
    if (linkPath) {
      const rows = await linkPlaces(linkPath, q.key);
      return rows.filter((p) => `${p.name} ${p.code}`.toLowerCase().includes(search.toLowerCase())).slice(0, 100).map((p) => ({ id: p.id, title: p.name, sub: p.code }));
    }
    if (!scope) return [];
    const r = await restrict();
    setWaiting(r.blocked ?? null);
    if (r.blocked) return [];
    const rows: Place[] = await findPlaces({ scope, type: q.entityType, q: search || undefined, ids: r.ids, limit: 100 });
    return rows.map((p) => ({ id: p.id, title: p.name, sub: p.code }));
  };

  return (
    <>
      <Pressable
        onPress={async () => {
          const r = await restrict();
          setWaiting(r.blocked ?? null);
          setOpen(true);
        }}
      >
        <Input editable={false} pointerEvents="none" invalid={invalid} value={name ?? ''} placeholder={q.placeholder ?? 'Choose…'} />
      </Pressable>
      <Sheet visible={open} title={q.label} onClose={() => setOpen(false)}>
        {waiting ? (
          <View style={{ padding: 16 }}>
            <Txt muted>{waiting}</Txt>
          </View>
        ) : (
          <SearchList
            load={load}
            onPick={(id) => {
              onChange(id);
              setOpen(false);
            }}
            onClear={value ? () => { onChange(undefined); setOpen(false); } : undefined}
          />
        )}
      </Sheet>
    </>
  );
}

// ------------------------------------------------------------------ shared bits

export function Sheet({ visible, title, onClose, children }: { visible: boolean; title: string; onClose(): void; children: React.ReactNode }) {
  const c = useTheme();
  return (
    <Modal visible={visible} animationType="slide" presentationStyle="pageSheet" onRequestClose={onClose}>
      <View style={{ flex: 1, backgroundColor: c.bg }}>
        <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', padding: 16, borderBottomWidth: 1, borderBottomColor: c.line }}>
          <View style={{ flex: 1 }}>
            <Txt strong numberOfLines={1}>{title}</Txt>
          </View>
          <Button small kind="secondary" title="Close" onPress={onClose} />
        </View>
        {visible ? children : null}
      </View>
    </Modal>
  );
}

interface Row {
  id: string;
  title: string;
  sub?: string;
}

function SearchList({ load, onPick, onClear }: { load(search: string): Promise<Row[]>; onPick(id: string): void; onClear?: (() => void) | undefined }) {
  const [text, setText] = useState('');
  const [rows, setRows] = useState<Row[]>([]);
  useEffect(() => {
    let live = true;
    const t = setTimeout(() => void load(text).then((r) => live && setRows(r)), 120);
    return () => {
      live = false;
      clearTimeout(t);
    };
  }, [text]);
  return (
    <View style={{ flex: 1 }}>
      <View style={{ padding: 12 }}>
        <Input autoFocus value={text} onChangeText={setText} placeholder="Search" autoCapitalize="none" />
      </View>
      {onClear ? <View style={{ paddingHorizontal: 12, paddingBottom: 8 }}><Button small kind="secondary" title="Clear the answer" onPress={onClear} /></View> : null}
      <FlatList
        data={rows}
        keyExtractor={(r) => r.id}
        keyboardShouldPersistTaps="handled"
        ListEmptyComponent={<View style={{ padding: 24 }}><Txt muted>Nothing found on this device.</Txt></View>}
        renderItem={({ item }) => (
          <Pressable onPress={() => onPick(item.id)} style={{ paddingHorizontal: 16, paddingVertical: 12, gap: 2 }}>
            <Txt>{item.title}</Txt>
            {item.sub ? <Txt muted small>{item.sub}</Txt> : null}
          </Pressable>
        )}
      />
    </View>
  );
}
