// Sign in: phone number → 6-digit SMS code. No username, no password.
import * as Device from 'expo-device';
import { Image } from 'expo-image';
import { router } from 'expo-router';
import { useEffect, useRef, useState, type ComponentRef } from 'react';
import { ScrollView, StyleSheet, Text, TextInput, View } from 'react-native';

import { Button, C, Choice, ErrorText, Screen, s } from '@/components/ui';
import { api, type Parent } from '@/lib/api';
import type { Lang } from '@/lib/i18n';
import { useSession } from '@/lib/session';

const LOGO = require('../../assets/images/musabe-logo.png');
// "0754123456" -> "0754 123 456"
const pretty = (d: string) => d.replace(/^(\d{4})(\d{0,3})(\d{0,3}).*$/, (_m, a, b, c) => [a, b, c].filter(Boolean).join(' '));
const digits = (v: string) => {
  let d = v.replace(/\D/g, '');
  if (d.startsWith('255')) d = `0${d.slice(3)}`;
  return d.slice(0, 10);
};

export default function Login() {
  const { t, lang, setLang, signedInWith } = useSession();
  const [step, setStep] = useState<'phone' | 'code'>('phone');
  const [phone, setPhone] = useState('');
  const [code, setCode] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [sent, setSent] = useState<{ hint: string; minutes: number; dev: boolean } | null>(null);
  const [wait, setWait] = useState(0);
  const codeRef = useRef<ComponentRef<typeof TextInput>>(null);

  useEffect(() => {
    if (wait <= 0) return;
    const id = setTimeout(() => setWait((w) => w - 1), 1000);
    return () => clearTimeout(id);
  }, [wait]);

  const okPhone = /^0[67]\d{8}$/.test(phone);
  const start = async () => {
    setBusy(true); setError('');
    try {
      const r = await api<{ hint: string; minutes: number; dev: boolean }>('POST', '/auth/start', { phone }, t('netError'));
      setSent(r); setStep('code'); setCode(''); setWait(60);
      setTimeout(() => codeRef.current?.focus(), 300);
    } catch (e) { setError((e as Error).message); }
    setBusy(false);
  };
  const verify = async (c = code) => {
    if (c.length !== 6) return;
    setBusy(true); setError('');
    try {
      const r = await api<{ token: string; parent: Parent }>('POST', '/auth/verify',
        { phone, code: c, device: [Device.manufacturer, Device.modelName].filter(Boolean).join(' ').slice(0, 80) }, t('netError'));
      await signedInWith(r.token, r.parent);
      router.replace('/home');
    } catch (e) { setError((e as Error).message); setBusy(false); }
  };

  return (
    <Screen>
        <ScrollView contentContainerStyle={st.wrap} keyboardShouldPersistTaps="handled">
          <View style={{ width: 220, alignSelf: 'flex-end' }}>
            <Choice<Lang> value={lang} onChange={setLang} options={[{ value: 'sw', label: 'Kiswahili' }, { value: 'en', label: 'English' }]} />
          </View>
          <View style={st.head}>
            <Image source={LOGO} style={st.logo} contentFit="contain" />
            <Text style={st.app}>{t('appName')}</Text>
          </View>

          {step === 'phone' ? (
            <View style={st.box}>
              <Text style={st.h}>{t('welcome')}</Text>
              <Text style={st.p}>{t('loginIntro')}</Text>
              <View>
                <Text style={s.label}>{t('phone')}</Text>
                <TextInput style={[s.input, st.big]} value={pretty(phone)} onChangeText={(v) => setPhone(digits(v))} keyboardType="phone-pad"
                  placeholder={t('phoneHint')} placeholderTextColor="#9aa9a0" autoComplete="tel" textContentType="telephoneNumber" maxLength={13}
                  returnKeyType="send" onSubmitEditing={() => okPhone && start()} />
              </View>
              <ErrorText error={error} />
              <Button label={t('sendCode')} onPress={start} busy={busy} disabled={!okPhone} />
              <Text style={st.small}>{t('noAccount')}</Text>
            </View>
          ) : (
            <View style={st.box}>
              <Text style={st.h}>{t('codeTitle')}</Text>
              <Text style={st.p}>{t('codeSent', { phone: sent?.hint || pretty(phone), min: sent?.minutes || 10 })}</Text>
              {sent?.dev && <Text style={st.dev}>{t('devCode')}</Text>}
              <TextInput ref={codeRef} style={[s.input, st.code]} value={code} keyboardType="number-pad" maxLength={6}
                autoComplete="sms-otp" textContentType="oneTimeCode" placeholder="••••••" placeholderTextColor="#b7c3bc"
                onChangeText={(v) => { const d = v.replace(/\D/g, '').slice(0, 6); setCode(d); if (d.length === 6) verify(d); }} />
              <ErrorText error={error} />
              <Button label={t('signIn')} onPress={() => verify()} busy={busy} disabled={code.length !== 6} />
              <Button kind="plain" label={wait > 0 ? t('resendIn', { s: wait }) : t('resend')} onPress={start} disabled={wait > 0 || busy} />
              <Button kind="plain" label={t('changePhone')} onPress={() => { setStep('phone'); setError(''); }} />
            </View>
          )}
        </ScrollView>
    </Screen>
  );
}

const st = StyleSheet.create({
  wrap: { paddingHorizontal: 24, paddingVertical: 20, gap: 18, flexGrow: 1 },
  head: { alignItems: 'center', gap: 8, marginTop: 12 },
  logo: { width: 92, height: 92 },
  app: { fontSize: 24, fontWeight: '800', color: C.green },
  box: { gap: 16 },
  h: { fontSize: 20, fontWeight: '800', color: C.text },
  p: { color: C.muted, lineHeight: 21 },
  big: { fontSize: 22, letterSpacing: 1 },
  code: { fontSize: 30, letterSpacing: 12, textAlign: 'center', fontWeight: '700' },
  small: { color: C.muted, fontSize: 13, lineHeight: 19 },
  dev: { color: C.amber, backgroundColor: C.amberSoft, padding: 10, borderRadius: 10, fontSize: 13 },
});
