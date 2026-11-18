// Building blocks shared by every parents' screen: glass-light look, header, bottom bar, cards, tabs, empty states.
import { LinearGradient } from 'expo-linear-gradient';
import { router } from 'expo-router';
import { useEffect, useState, type ReactNode } from 'react';
import { ActivityIndicator, Keyboard, KeyboardAvoidingView, Modal, Pressable, ScrollView, StyleSheet, Text, View, type StyleProp, type ViewStyle } from 'react-native';
import Animated, { FadeIn, FadeOut, SlideInDown } from 'react-native-reanimated';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { useSession } from '@/lib/session';
import { Icon, type IconName } from './icons';

export const C = {
  green: '#0f5a3a', green2: '#1f7a4d', gold: '#d9b24a', goldSoft: '#fbf3dc',
  bg: '#eef5f0', card: 'rgba(255,255,255,0.86)', cardLine: 'rgba(255,255,255,0.95)', text: '#13241b', muted: '#5f7368', line: '#dde7e0',
  red: '#b42318', redSoft: '#fdecea', amber: '#9a6700', amberSoft: '#fff4d6', okSoft: '#e1f3e8',
};
// The colour of each school (same as the ID cards): English Medium green, Boys blue, Girls pink.
export const SCHOOL_COLOR: Record<string, string> = { pre: '#2e8b57', boys: '#2563eb', girls: '#db2777' };
export const schoolColor = (code?: string) => SCHOOL_COLOR[code || ''] || C.green;

// "ABBA THEONAS WAMBURA" -> "Abba Theonas Wambura" (the school writes names in capitals; they are easier to read this way)
export const nice = (v = '') => v.toLowerCase().replace(/(^|[\s'-])(\p{L})/gu, (_m, a, b) => a + b.toUpperCase());

// Space that content must leave at the bottom when the floating bar is shown.
export const BAR_SPACE = 108;
// Side space of every page. Wide on purpose: the screens are open and easy to read, not boxed in.
export const PAD = 22;

type Tab = 'home' | 'notices' | 'account';

// True while the on-screen keyboard is open (the floating bar hides then, so it never rides on top of the keyboard).
function useKeyboardOpen() {
  const [open, setOpen] = useState(false);
  useEffect(() => {
    const a = Keyboard.addListener('keyboardDidShow', () => setOpen(true));
    const b = Keyboard.addListener('keyboardDidHide', () => setOpen(false));
    return () => { a.remove(); b.remove(); };
  }, []);
  return open;
}

export function Screen({ title, back = true, right, hero, tab, badge = 0, children }: {
  title?: string; back?: boolean; right?: ReactNode; hero?: ReactNode; tab?: Tab; badge?: number; children: ReactNode;
}) {
  const { t } = useSession();
  const inset = useSafeAreaInsets();
  const typing = useKeyboardOpen();
  return (
    <View style={s.screen}>
      {/* soft colour behind the glass */}
      <LinearGradient colors={['#e4f3ea', '#f4f8f3', '#fbf5e3']} style={StyleSheet.absoluteFill} />
      <View pointerEvents="none" style={[s.orb, { top: 160, right: -90, backgroundColor: '#9fe3bd' }]} />
      <View pointerEvents="none" style={[s.orb, { bottom: 80, left: -110, backgroundColor: '#f1dc8e', opacity: 0.35 }]} />

      {title !== undefined && (
        <LinearGradient colors={[C.green, C.green2]} start={{ x: 0, y: 0 }} end={{ x: 1, y: 1 }} style={[s.header, { paddingTop: inset.top + 10 }]}>
          <View style={s.bar}>
            {back ? (
              <Pressable hitSlop={10} style={s.roundBtn} accessibilityRole="button" accessibilityLabel={t('back')}
                onPress={() => (router.canGoBack() ? router.back() : router.replace('/home'))}>
                <Icon name="back" color="#fff" size={22} width={2.2} />
              </Pressable>
            ) : null}
            <Text style={s.title} numberOfLines={1}>{title}</Text>
            <View style={s.right}>{right}</View>
          </View>
          {hero}
        </LinearGradient>
      )}

      {/* The keyboard pushes the content up, so what is typed is never hidden behind it (Android and iPhone). */}
      <KeyboardAvoidingView style={[s.body, title === undefined && { paddingTop: inset.top }]} behavior="padding">{children}</KeyboardAvoidingView>
      {tab && !typing && <BottomBar tab={tab} badge={badge} bottom={Math.max(inset.bottom, 10)} />}
      {!tab && !typing && <View style={{ height: inset.bottom }} />}
    </View>
  );
}

// Floating glass bar: Home / Notices / Account. Replaces the old emoji icons in the header.
function BottomBar({ tab, badge, bottom }: { tab: Tab; badge: number; bottom: number }) {
  const { t } = useSession();
  const items: { key: Tab; label: string; icon: IconName; path: '/home' | '/notices' | '/account' }[] = [
    { key: 'home', label: t('tabHome'), icon: 'home', path: '/home' },
    { key: 'notices', label: t('notices'), icon: 'bell', path: '/notices' },
    { key: 'account', label: t('tabAccount'), icon: 'user', path: '/account' },
  ];
  return (
    <View style={[s.barWrap, { bottom }]} pointerEvents="box-none">
      <View style={s.barGlass}>
        {items.map((i) => {
          const on = i.key === tab;
          return (
            <Pressable key={i.key} style={[s.barItem, on && s.barItemOn]} accessibilityRole="tab" accessibilityState={{ selected: on }} accessibilityLabel={i.label}
              onPress={() => { if (!on) router.replace(i.path); }}>
              <View>
                <Icon name={i.icon} size={22} color={on ? '#fff' : C.muted} width={on ? 2.2 : 1.9} />
                {i.key === 'notices' && badge > 0 && <View style={s.dotBadge}><Text style={s.dotBadgeTxt}>{badge > 9 ? '9+' : badge}</Text></View>}
              </View>
              {on && <Text style={s.barLabel}>{i.label}</Text>}
            </Pressable>
          );
        })}
      </View>
    </View>
  );
}

// Not a box any more: content sits directly on the page, separated from the next item by a thin line.
// (`accent` is kept so callers do not change; the school colour now shows in the section heading instead.)
export const Card = ({ children, style, onPress }: { children: ReactNode; style?: StyleProp<ViewStyle>; onPress?: () => void; accent?: string }) => {
  const body = <View style={[s.card, style]}>{children}</View>;
  return onPress ? <Pressable onPress={onPress} accessibilityRole="button" android_ripple={{ color: 'rgba(15,90,58,0.08)' }} style={({ pressed }) => ({ backgroundColor: pressed ? 'rgba(15,90,58,0.06)' : 'transparent', marginHorizontal: -PAD, paddingHorizontal: PAD })}>{body}</Pressable> : body;
};

// Bottom sheet for yes/no questions (sign out, ...): a dimmed page, a rounded sheet sliding up, one clear action.
export function ConfirmSheet({ visible, icon = 'logout', title, message, confirmLabel, cancelLabel, onConfirm, onCancel }: {
  visible: boolean; icon?: IconName; title: string; message: string; confirmLabel: string; cancelLabel: string; onConfirm: () => void; onCancel: () => void;
}) {
  const inset = useSafeAreaInsets();
  return (
    <Modal visible={visible} transparent animationType="none" onRequestClose={onCancel} statusBarTranslucent navigationBarTranslucent>
      <Animated.View entering={FadeIn.duration(180)} exiting={FadeOut.duration(150)} style={s.scrim}>
        <Pressable style={StyleSheet.absoluteFill} onPress={onCancel} accessibilityLabel={cancelLabel} />
        <Animated.View entering={SlideInDown.springify().damping(20).stiffness(220)} style={[s.sheet, { paddingBottom: Math.max(inset.bottom, 16) + 8 }]}>
          <View style={s.grab} />
          <View style={s.sheetIcon}><Icon name={icon} size={28} color={C.red} width={2} /></View>
          <Text style={s.sheetTitle}>{title}</Text>
          <Text style={s.sheetMsg}>{message}</Text>
          <View style={s.sheetBtns}>
            <Button kind="destructive" icon={icon} label={confirmLabel} onPress={onConfirm} />
            <Button kind="plain" label={cancelLabel} onPress={onCancel} />
          </View>
        </Animated.View>
      </Animated.View>
    </Modal>
  );
}

export function Button({ label, onPress, busy, kind = 'primary', disabled, icon }: { label: string; onPress: () => void; busy?: boolean; kind?: 'primary' | 'plain' | 'danger' | 'destructive'; disabled?: boolean; icon?: IconName }) {
  const st = kind === 'primary' ? s.btnP : kind === 'danger' ? s.btnD : kind === 'destructive' ? s.btnX : s.btnPlain;
  const fg = kind === 'plain' ? C.green : kind === 'danger' ? C.red : '#fff';
  return (
    <Pressable onPress={onPress} disabled={busy || disabled} accessibilityRole="button"
      style={({ pressed }) => [s.btn, st, (busy || disabled) && { opacity: 0.5 }, pressed && { transform: [{ scale: 0.98 }], opacity: 0.9 }]}>
      {busy ? <ActivityIndicator color={fg} /> : <>
        {icon ? <Icon name={icon} size={19} color={fg} width={2.2} /> : null}
        <Text style={[s.btnTxt, { color: fg }]}>{label}</Text>
      </>}
    </Pressable>
  );
}

export const Pill = ({ label, tone = 'muted', icon }: { label: string; tone?: 'muted' | 'ok' | 'warn' | 'bad' | 'gold'; icon?: IconName }) => {
  const bg = { muted: '#e7eeea', ok: C.okSoft, warn: C.amberSoft, bad: C.redSoft, gold: C.goldSoft }[tone];
  const fg = { muted: C.muted, ok: C.green, warn: C.amber, bad: C.red, gold: C.amber }[tone];
  return (
    <View style={[s.pill, { backgroundColor: bg }]}>
      {icon ? <Icon name={icon} size={13} color={fg} width={2.4} /> : null}
      <Text style={[s.pillTxt, { color: fg }]}>{label}</Text>
    </View>
  );
};

// Empty list: a soft icon, a sentence, and an optional hint, instead of one grey line.
export const Empty = ({ children, icon = 'inbox', hint }: { children: ReactNode; icon?: IconName; hint?: string }) => (
  <View style={s.empty}>
    <View style={s.emptyIcon}><Icon name={icon} size={26} color={C.green2} /></View>
    <Text style={s.emptyTxt}>{children}</Text>
    {hint ? <Text style={s.emptyHint}>{hint}</Text> : null}
  </View>
);
export const ErrorText = ({ error }: { error?: string }) => (error ? (
  <View style={s.err} accessibilityRole="alert"><Icon name="alert" size={18} color={C.red} /><Text style={s.errTxt}>{error}</Text></View>
) : null);
export const Loading = () => { const { t } = useSession(); return <View style={s.center}><ActivityIndicator color={C.green} size="large" /><Text style={s.muted}>{t('loading')}</Text></View>; };
export const Row = ({ label, value }: { label: string; value: ReactNode }) => (
  <View style={s.row}><Text style={s.rowL}>{label}</Text>{typeof value === 'string' ? <Text style={s.rowV}>{value}</Text> : value}</View>
);
export const Section = ({ children }: { children: ReactNode }) => <Text style={s.h2}>{children}</Text>;

// A number on the home summary: no box, just the icon, the figure and what it is.
export const Stat = ({ icon, label, value, tone }: { icon: IconName; label: string; value: string; tone: 'bad' | 'warn' | 'gold' }) => {
  const fg = { bad: C.red, warn: C.amber, gold: C.amber }[tone];
  const bg = { bad: C.redSoft, warn: C.amberSoft, gold: C.goldSoft }[tone];
  return (
    <View style={s.stat}>
      <View style={[s.statIcon, { backgroundColor: bg }]}><Icon name={icon} size={20} color={fg} /></View>
      <Text style={s.statV} numberOfLines={1} adjustsFontSizeToFit>{value}</Text>
      <Text style={s.statL} numberOfLines={2}>{label}</Text>
    </View>
  );
};

// Scrolling pill tabs: every label shows in full (the old 4-way switch cut "Namba za malipo" and "Alivyopewa").
export function Tabs<T extends string>({ options, value, onChange }: { options: { value: T; label: string; icon?: IconName; count?: number }[]; value: T; onChange: (v: T) => void }) {
  return (
    <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={s.tabs} style={s.tabsScroll}>
      {options.map((o) => {
        const on = value === o.value;
        return (
          <Pressable key={o.value} onPress={() => onChange(o.value)} style={[s.tab, on && s.tabOn]} accessibilityRole="tab" accessibilityState={{ selected: on }}>
            {o.icon ? <Icon name={o.icon} size={17} color={on ? '#fff' : C.muted} width={2} /> : null}
            <Text style={[s.tabTxt, on && s.tabTxtOn]}>{o.label}</Text>
            {o.count ? <View style={[s.tabCount, on && { backgroundColor: 'rgba(255,255,255,0.28)' }]}><Text style={[s.tabCountTxt, on && { color: '#fff' }]}>{o.count}</Text></View> : null}
          </Pressable>
        );
      })}
    </ScrollView>
  );
}

// Two or three equal choices (language, relation).
export function Choice<T extends string>({ options, value, onChange }: { options: { value: T; label: string }[]; value: T; onChange: (v: T) => void }) {
  return (
    <View style={s.choice}>
      {options.map((o) => (
        <Pressable key={o.value} onPress={() => onChange(o.value)} style={[s.choiceItem, value === o.value && s.choiceOn]} accessibilityRole="button" accessibilityState={{ selected: value === o.value }}>
          <Text style={[s.choiceTxt, value === o.value && s.choiceTxtOn]} numberOfLines={1}>{o.label}</Text>
        </Pressable>
      ))}
    </View>
  );
}

export const s = StyleSheet.create({
  screen: { flex: 1, backgroundColor: C.bg },
  orb: { position: 'absolute', width: 280, height: 280, borderRadius: 140, opacity: 0.4 },
  body: { flex: 1 },

  header: { paddingHorizontal: 16, paddingBottom: 18, borderBottomLeftRadius: 28, borderBottomRightRadius: 28, shadowColor: '#0c3a29', shadowOpacity: 0.25, shadowRadius: 14, shadowOffset: { width: 0, height: 6 }, elevation: 6, zIndex: 2 },
  bar: { flexDirection: 'row', alignItems: 'center', gap: 12, minHeight: 40 },
  roundBtn: { width: 40, height: 40, borderRadius: 20, alignItems: 'center', justifyContent: 'center', backgroundColor: 'rgba(255,255,255,0.18)', borderWidth: 1, borderColor: 'rgba(255,255,255,0.3)' },
  title: { flex: 1, color: '#fff', fontSize: 20, fontWeight: '800', letterSpacing: -0.2 },
  right: { flexDirection: 'row', alignItems: 'center', gap: 10 },

  barWrap: { position: 'absolute', left: 0, right: 0, alignItems: 'center', paddingHorizontal: 22 },
  barGlass: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', alignSelf: 'stretch', padding: 6, borderRadius: 32, backgroundColor: 'rgba(255,255,255,0.9)', borderWidth: 1, borderColor: 'rgba(255,255,255,0.95)',
    shadowColor: '#0c3a29', shadowOpacity: 0.18, shadowRadius: 18, shadowOffset: { width: 0, height: 8 }, elevation: 10 },
  barItem: { flex: 1, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8, height: 52, borderRadius: 26 },
  barItemOn: { flex: 1.6, backgroundColor: C.green },
  barLabel: { color: '#fff', fontWeight: '800', fontSize: 14 },
  dotBadge: { position: 'absolute', top: -7, right: -9, minWidth: 17, height: 17, borderRadius: 9, backgroundColor: C.gold, alignItems: 'center', justifyContent: 'center', paddingHorizontal: 3, borderWidth: 1.5, borderColor: '#fff' },
  dotBadgeTxt: { color: C.text, fontSize: 10, fontWeight: '900' },

  card: { paddingVertical: 16, borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: C.line },
  scrim: { flex: 1, backgroundColor: 'rgba(8,24,16,0.5)', justifyContent: 'flex-end' },
  sheet: { backgroundColor: '#fff', borderTopLeftRadius: 30, borderTopRightRadius: 30, paddingHorizontal: 24, paddingTop: 12, alignItems: 'center', gap: 10 },
  grab: { width: 44, height: 5, borderRadius: 3, backgroundColor: C.line, marginBottom: 14 },
  sheetIcon: { width: 68, height: 68, borderRadius: 34, backgroundColor: C.redSoft, alignItems: 'center', justifyContent: 'center', marginBottom: 4 },
  sheetTitle: { fontSize: 22, fontWeight: '800', color: C.text, letterSpacing: -0.3 },
  sheetMsg: { fontSize: 15.5, color: C.muted, textAlign: 'center', lineHeight: 23, paddingHorizontal: 6, marginBottom: 10 },
  sheetBtns: { alignSelf: 'stretch', gap: 10 },
  btnX: { backgroundColor: C.red, shadowColor: C.red, shadowOpacity: 0.3, shadowRadius: 12, shadowOffset: { width: 0, height: 5 }, elevation: 4 },

  btn: { flexDirection: 'row', gap: 8, borderRadius: 16, paddingVertical: 14, paddingHorizontal: 18, alignItems: 'center', justifyContent: 'center', minHeight: 54 },
  btnP: { backgroundColor: C.green, shadowColor: C.green, shadowOpacity: 0.3, shadowRadius: 12, shadowOffset: { width: 0, height: 5 }, elevation: 4 },
  btnD: { backgroundColor: C.redSoft, borderWidth: 1, borderColor: '#f3c5bf' },
  btnPlain: { backgroundColor: 'rgba(255,255,255,0.7)', borderWidth: 1.5, borderColor: C.line },
  btnTxt: { fontWeight: '800', fontSize: 16 },

  pill: { flexDirection: 'row', alignItems: 'center', gap: 5, borderRadius: 99, paddingHorizontal: 10, paddingVertical: 5, alignSelf: 'flex-start' },
  pillTxt: { fontSize: 12.5, fontWeight: '700' },

  empty: { alignItems: 'center', gap: 8, paddingVertical: 26, paddingHorizontal: 12 },
  emptyIcon: { width: 56, height: 56, borderRadius: 28, backgroundColor: C.okSoft, alignItems: 'center', justifyContent: 'center', marginBottom: 2 },
  emptyTxt: { color: C.text, fontSize: 15.5, fontWeight: '700', textAlign: 'center', lineHeight: 21 },
  emptyHint: { color: C.muted, textAlign: 'center', lineHeight: 20, fontSize: 13.5 },
  err: { flexDirection: 'row', gap: 10, alignItems: 'flex-start', backgroundColor: C.redSoft, padding: 12, borderRadius: 14 },
  errTxt: { flex: 1, color: C.red, lineHeight: 20, fontWeight: '500' },
  center: { flex: 1, alignItems: 'center', justifyContent: 'center', gap: 12, padding: 24 },
  muted: { color: C.muted },
  h2: { fontSize: 12.5, fontWeight: '800', color: C.muted, textTransform: 'uppercase', letterSpacing: 0.8, marginTop: 6 },

  row: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', paddingVertical: 15, borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: C.line, gap: 12 },
  rowL: { color: C.muted, flexShrink: 0, fontSize: 16 },
  rowV: { color: C.text, fontWeight: '700', flexShrink: 1, textAlign: 'right', fontSize: 16 },

  stat: { flex: 1, gap: 4 },
  statIcon: { width: 38, height: 38, borderRadius: 19, alignItems: 'center', justifyContent: 'center', marginBottom: 4 },
  statV: { fontSize: 22, fontWeight: '800', color: C.text, letterSpacing: -0.3 },
  statL: { fontSize: 13, color: C.muted, lineHeight: 16 },

  tabsScroll: { flexGrow: 0 },
  tabs: { paddingHorizontal: 16, gap: 8, paddingVertical: 4 },
  tab: { flexDirection: 'row', alignItems: 'center', gap: 7, height: 42, paddingHorizontal: 15, borderRadius: 21, backgroundColor: 'rgba(255,255,255,0.75)', borderWidth: 1, borderColor: C.line },
  tabOn: { backgroundColor: C.green, borderColor: C.green },
  tabTxt: { color: C.muted, fontWeight: '700', fontSize: 14 },
  tabTxtOn: { color: '#fff' },
  tabCount: { minWidth: 20, height: 20, borderRadius: 10, backgroundColor: C.redSoft, alignItems: 'center', justifyContent: 'center', paddingHorizontal: 5 },
  tabCountTxt: { color: C.red, fontSize: 11.5, fontWeight: '800' },

  input: { backgroundColor: 'rgba(255,255,255,0.95)', borderWidth: 1.5, borderColor: C.line, borderRadius: 14, paddingHorizontal: 14, paddingVertical: 12, fontSize: 17, color: C.text },
  label: { color: C.text, fontWeight: '700', marginBottom: 6, fontSize: 14 },
  choice: { flexDirection: 'row', backgroundColor: '#e3ece7', borderRadius: 14, padding: 3, gap: 3 },
  choiceItem: { flex: 1, paddingVertical: 10, borderRadius: 11, alignItems: 'center' },
  choiceOn: { backgroundColor: '#fff', shadowColor: '#0c3a29', shadowOpacity: 0.12, shadowRadius: 5, shadowOffset: { width: 0, height: 2 }, elevation: 2 },
  choiceTxt: { color: C.muted, fontWeight: '700' },
  choiceTxtOn: { color: C.green, fontWeight: '800' },
});
