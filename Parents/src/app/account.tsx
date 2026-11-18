// My account: name, phone, language, my requests, sign out.
import Constants from 'expo-constants';
import { router } from 'expo-router';
import { useState } from 'react';
import { ScrollView, StyleSheet, Text, TextInput, View } from 'react-native';

import { Icon } from '@/components/icons';
import { BAR_SPACE, PAD, Button, ConfirmSheet, C, Card, Choice, ErrorText, Row, Screen, Section, nice, s } from '@/components/ui';
import { api, type Parent } from '@/lib/api';
import type { Lang } from '@/lib/i18n';
import { useSession } from '@/lib/session';

const pretty = (p = '') => p.replace(/^(\d{4})(\d{3})(\d{3})$/, '$1 $2 $3');
const initials = (n = '') => n.split(/\s+/).filter(Boolean).slice(0, 2).map((w) => w[0]).join('').toUpperCase() || '?';

export default function Account() {
  const { t, lang, setLang, parent, setParent, signOut } = useSession();
  const [name, setName] = useState(parent?.fullName || '');
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState('');
  const [error, setError] = useState('');
  const [asking, setAsking] = useState(false);

  const save = async () => {
    setBusy(true); setError(''); setMsg('');
    try { const r = await api<{ parent: Parent }>('PATCH', '/me', { fullName: name }, t('netError')); setParent(r.parent); setName(r.parent.fullName); setMsg(t('saved')); }
    catch (e) { setError((e as Error).message); }
    setBusy(false);
  };

  const hero = (
    <View style={st.hero}>
      <View style={st.avatar}><Text style={st.avatarTxt}>{initials(parent?.fullName)}</Text></View>
      <View style={st.heroInfo}>
        <Text style={st.heroName} numberOfLines={1}>{nice(parent?.fullName) || t('account')}</Text>
        <Text style={st.heroPhone}>{pretty(parent?.phone)}</Text>
      </View>
    </View>
  );

  return (
    <Screen title={t('account')} back={false} hero={hero} tab="account">
      <ScrollView contentContainerStyle={st.wrap} keyboardShouldPersistTaps="handled" showsVerticalScrollIndicator={false}>
        <Section>{t('name')}</Section>
        <Card style={st.gap}>
          <TextInput style={s.input} value={name} onChangeText={setName} autoCapitalize="characters" maxLength={120} accessibilityLabel={t('name')} />
          <Button label={t('save')} onPress={save} busy={busy} disabled={name.trim() === (parent?.fullName || '')} />
          {msg ? <View style={st.okRow}><Icon name="check" size={17} color={C.green} width={2.6} /><Text style={st.ok}>{msg}</Text></View> : null}
          <ErrorText error={error} />
          <Row label={t('phone')} value={pretty(parent?.phone)} />
        </Card>

        <Section>{t('language')}</Section>
        <Card><Choice<Lang> value={lang} onChange={setLang} options={[{ value: 'sw', label: 'Kiswahili' }, { value: 'en', label: 'English' }]} /></Card>

        <Button kind="plain" icon="inbox" label={t('myRequests')} onPress={() => router.push('/request')} />
        <Button kind="danger" icon="logout" label={t('signOut')} onPress={() => setAsking(true)} />
        <Text style={st.ver}>{t('appName')}  ·  {t('version')} {Constants.expoConfig?.version}</Text>
      </ScrollView>
      <ConfirmSheet visible={asking} title={t('signOut')} message={t('signOutAsk')} confirmLabel={t('signOut')} cancelLabel={t('cancel')}
        onCancel={() => setAsking(false)} onConfirm={() => { setAsking(false); signOut(); }} />
    </Screen>
  );
}

const st = StyleSheet.create({
  hero: { flexDirection: 'row', alignItems: 'center', gap: 14, marginTop: 14 },
  avatar: { width: 64, height: 64, borderRadius: 32, backgroundColor: 'rgba(255,255,255,0.92)', alignItems: 'center', justifyContent: 'center' },
  avatarTxt: { color: C.green, fontSize: 24, fontWeight: '800' },
  heroInfo: { flex: 1, gap: 2 },
  heroName: { color: '#fff', fontSize: 21, fontWeight: '800', letterSpacing: -0.3 },
  heroPhone: { color: 'rgba(255,255,255,0.82)', fontSize: 15 },
  wrap: { paddingHorizontal: PAD, paddingTop: 20, gap: 14, paddingBottom: BAR_SPACE },
  gap: { gap: 12 },
  okRow: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  ok: { color: C.green, fontWeight: '700' },
  ver: { color: C.muted, textAlign: 'center', fontSize: 12, marginTop: 4 },
});
