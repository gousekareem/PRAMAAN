import type { ReactNode } from 'react';
import { ActivityIndicator, Pressable, StyleSheet, Text, View } from 'react-native';

export const colors = {
  ink: '#0f2133',
  inkSoft: '#2c5a85',
  paper: '#f7f6f2',
  line: '#e2dfd4',
  ok: '#1f7a4d',
  warn: '#a86100',
  bad: '#b42318',
  muted: '#6b7280',
  white: '#ffffff',
};

export function Button({
  title,
  onPress,
  kind = 'primary',
  disabled,
  busy,
}: {
  title: string;
  onPress: () => void;
  kind?: 'primary' | 'secondary' | 'danger';
  disabled?: boolean;
  busy?: boolean;
}) {
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityState={{ disabled: !!disabled || !!busy }}
      disabled={disabled || busy}
      onPress={onPress}
      style={({ pressed }) => [
        styles.btn,
        kind === 'secondary' && styles.btnSecondary,
        kind === 'danger' && styles.btnDanger,
        (disabled || busy) && styles.disabled,
        pressed && { opacity: 0.85 },
      ]}
    >
      {busy ? (
        <ActivityIndicator color={kind === 'secondary' ? colors.ink : colors.white} />
      ) : (
        <Text style={[styles.btnText, kind === 'secondary' && { color: colors.ink }]}>{title}</Text>
      )}
    </Pressable>
  );
}

export function Card({ title, children }: { title?: string; children: ReactNode }) {
  return (
    <View style={styles.card}>
      {title ? <Text style={styles.cardTitle}>{title}</Text> : null}
      {children}
    </View>
  );
}

export function Row({
  k,
  v,
  mono,
}: {
  k: string;
  v: string | number | null | undefined;
  mono?: boolean;
}) {
  return (
    <View style={styles.row}>
      <Text style={styles.k}>{k}</Text>
      <Text selectable style={[styles.v, mono && styles.mono]}>
        {v === null || v === undefined || v === '' ? '—' : String(v)}
      </Text>
    </View>
  );
}

export function Notice({
  tone,
  children,
}: {
  tone: 'ok' | 'warn' | 'bad' | 'info';
  children: ReactNode;
}) {
  const c =
    tone === 'ok'
      ? colors.ok
      : tone === 'warn'
        ? colors.warn
        : tone === 'bad'
          ? colors.bad
          : colors.inkSoft;
  return (
    <View accessibilityRole="alert" style={[styles.notice, { borderColor: c }]}>
      <Text style={{ color: c }}>{children}</Text>
    </View>
  );
}

export const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: colors.paper },
  content: { padding: 16, gap: 12 },
  h1: { fontSize: 20, fontWeight: '600', color: colors.ink },
  p: { color: colors.ink, fontSize: 14, lineHeight: 20 },
  small: { color: colors.muted, fontSize: 12 },
  btn: {
    backgroundColor: colors.ink,
    borderRadius: 6,
    paddingVertical: 12,
    paddingHorizontal: 16,
    alignItems: 'center',
    minHeight: 48,
    justifyContent: 'center',
  },
  btnSecondary: { backgroundColor: colors.white, borderWidth: 1, borderColor: colors.line },
  btnDanger: { backgroundColor: colors.bad },
  btnText: { color: colors.white, fontWeight: '600', fontSize: 15 },
  disabled: { opacity: 0.5 },
  card: {
    backgroundColor: colors.white,
    borderRadius: 8,
    borderWidth: 1,
    borderColor: colors.line,
    padding: 14,
    gap: 6,
  },
  cardTitle: {
    fontSize: 12,
    fontWeight: '700',
    color: colors.muted,
    letterSpacing: 0.6,
    textTransform: 'uppercase',
    marginBottom: 4,
  },
  row: { flexDirection: 'row', justifyContent: 'space-between', gap: 8, paddingVertical: 3 },
  k: { color: colors.muted, fontSize: 13, flexShrink: 0 },
  v: { color: colors.ink, fontSize: 13, flexShrink: 1, textAlign: 'right' },
  mono: { fontFamily: 'monospace', fontSize: 11 },
  input: {
    borderWidth: 1,
    borderColor: colors.line,
    borderRadius: 6,
    backgroundColor: colors.white,
    paddingHorizontal: 12,
    paddingVertical: 10,
    fontSize: 16,
    color: colors.ink,
  },
  notice: { borderWidth: 1, borderRadius: 6, padding: 10, backgroundColor: colors.white },
});
