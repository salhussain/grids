import { type ReactNode } from 'react';
import { ActivityIndicator, Pressable, ScrollView, StyleSheet, Text, TextInput, View, useColorScheme, type StyleProp, type TextInputProps, type TextStyle, type ViewStyle } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

const light = { bg: '#f6f7f9', card: '#ffffff', text: '#14181f', muted: '#667085', line: '#e1e5ea', primary: '#1f6feb', onPrimary: '#ffffff', danger: '#c62828', warn: '#b26a00', ok: '#1b7f4b', soft: '#eef3fd' };
const dark: typeof light = { bg: '#0e1116', card: '#171b22', text: '#eef1f5', muted: '#98a2b3', line: '#2a303a', primary: '#5b9bff', onPrimary: '#0e1116', danger: '#ff6b6b', warn: '#f0b254', ok: '#4cc38a', soft: '#1c2636' };
export type Palette = typeof light;

export const useTheme = (): Palette => (useColorScheme() === 'dark' ? dark : light);

export function Screen({ children, scroll = true, padded = true }: { children: ReactNode; scroll?: boolean; padded?: boolean }) {
  const c = useTheme();
  const body = padded ? { padding: 16, gap: 12 } : undefined;
  return (
    <SafeAreaView edges={['bottom', 'left', 'right']} style={{ flex: 1, backgroundColor: c.bg }}>
      {scroll ? (
        <ScrollView contentContainerStyle={body} keyboardShouldPersistTaps="handled" automaticallyAdjustKeyboardInsets>
          {children}
        </ScrollView>
      ) : (
        <View style={[{ flex: 1 }, body]}>{children}</View>
      )}
    </SafeAreaView>
  );
}

export function Txt({ children, muted, strong, small, style, color, numberOfLines }: { children?: ReactNode; muted?: boolean; strong?: boolean; small?: boolean; style?: StyleProp<TextStyle>; color?: string; numberOfLines?: number }) {
  const c = useTheme();
  return (
    <Text numberOfLines={numberOfLines} style={[{ color: color ?? (muted ? c.muted : c.text), fontSize: small ? 13 : 16, fontWeight: strong ? '600' : '400' }, style]}>
      {children}
    </Text>
  );
}

export function Card({ children, onPress, style }: { children: ReactNode; onPress?: () => void; style?: StyleProp<ViewStyle> }) {
  const c = useTheme();
  const box: ViewStyle = { backgroundColor: c.card, borderRadius: 12, borderWidth: StyleSheet.hairlineWidth, borderColor: c.line, padding: 14, gap: 4 };
  return onPress ? (
    <Pressable accessibilityRole="button" onPress={onPress} style={({ pressed }) => [box, pressed && { opacity: 0.7 }, style]}>
      {children}
    </Pressable>
  ) : (
    <View style={[box, style]}>{children}</View>
  );
}

export function Button({ title, onPress, kind = 'primary', busy, disabled, small }: { title: string; onPress: () => void; kind?: 'primary' | 'secondary' | 'danger'; busy?: boolean; disabled?: boolean; small?: boolean }) {
  const c = useTheme();
  const bg = kind === 'primary' ? c.primary : 'transparent';
  const fg = kind === 'primary' ? c.onPrimary : kind === 'danger' ? c.danger : c.primary;
  const off = disabled || busy;
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityState={{ disabled: !!off, busy: !!busy }}
      disabled={off}
      onPress={onPress}
      style={({ pressed }) => ({ backgroundColor: bg, borderColor: kind === 'primary' ? bg : fg, borderWidth: 1, borderRadius: 10, paddingVertical: small ? 8 : 13, paddingHorizontal: small ? 12 : 16, alignItems: 'center', justifyContent: 'center', flexDirection: 'row', gap: 8, opacity: off ? 0.5 : pressed ? 0.8 : 1 })}
    >
      {busy ? <ActivityIndicator color={fg} /> : null}
      <Text style={{ color: fg, fontWeight: '600', fontSize: small ? 14 : 16 }}>{title}</Text>
    </Pressable>
  );
}

export function Badge({ text, tone = 'muted' }: { text: string; tone?: 'muted' | 'ok' | 'warn' | 'danger' | 'primary' }) {
  const c = useTheme();
  const color = { muted: c.muted, ok: c.ok, warn: c.warn, danger: c.danger, primary: c.primary }[tone];
  return (
    <View style={{ borderColor: color, borderWidth: 1, borderRadius: 999, paddingHorizontal: 8, paddingVertical: 2, alignSelf: 'flex-start' }}>
      <Text style={{ color, fontSize: 12, fontWeight: '600' }}>{text}</Text>
    </View>
  );
}

export function Input(props: TextInputProps & { invalid?: boolean }) {
  const c = useTheme();
  const { invalid, style, ...rest } = props;
  return (
    <TextInput
      placeholderTextColor={c.muted}
      {...rest}
      style={[{ borderWidth: 1, borderColor: invalid ? c.danger : c.line, borderRadius: 10, paddingHorizontal: 12, paddingVertical: 11, fontSize: 16, color: c.text, backgroundColor: c.card }, rest.multiline && { minHeight: 90, textAlignVertical: 'top' }, style]}
    />
  );
}

export function Empty({ title, hint }: { title: string; hint?: string }) {
  return (
    <View style={{ alignItems: 'center', padding: 32, gap: 6 }}>
      <Txt strong>{title}</Txt>
      {hint ? <Txt muted small style={{ textAlign: 'center' }}>{hint}</Txt> : null}
    </View>
  );
}

export function Notice({ text, tone = 'warn' }: { text: string; tone?: 'warn' | 'danger' | 'ok' | 'primary' }) {
  const c = useTheme();
  const color = { warn: c.warn, danger: c.danger, ok: c.ok, primary: c.primary }[tone];
  return (
    <View style={{ borderLeftWidth: 4, borderLeftColor: color, backgroundColor: c.card, padding: 12, borderRadius: 8 }}>
      <Txt small>{text}</Txt>
    </View>
  );
}

export const when = (t: number | string | null) => {
  if (t === null) return '';
  const d = new Date(t);
  return Number.isNaN(d.getTime()) ? '' : d.toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'short' });
};
