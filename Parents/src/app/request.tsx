// "My child is not here": ask the school to link a child, and see the answers.
import { useFocusEffect } from 'expo-router';
import { useCallback, useState } from 'react';
import { Pressable, ScrollView, StyleSheet, Text, TextInput, View } from 'react-native';

import { Icon } from '@/components/icons';
import { PAD, Button, C, Card, Choice, ErrorText, Pill, Screen, Section, nice, s, schoolColor } from '@/components/ui';
import { api, type Request, type School } from '@/lib/api';
import { fmtDate } from '@/lib/i18n';
import { useSession } from '@/lib/session';

type Rel = 'mother' | 'father' | 'guardian';

export default function RequestScreen() {
  const { t, lang } = useSession();
  const [schools, setSchools] = useState<School[]>([]);
  const [mine, setMine] = useState<Request[]>([]);
  const [school, setSchool] = useState('');
  const [relation, setRelation] = useState<Rel>('mother');
  const [childName, setChildName] = useState('');
  const [admissionNo, setAdmissionNo] = useState('');
  const [className, setClassName] = useState('');
  const [note, setNote] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [done, setDone] = useState('');

  const load = useCallback(() => {
    api<{ schools: School[] }>('GET', '/schools').then((d) => setSchools(d.schools)).catch((e) => setError(e.message));
    api<{ requests: Request[] }>('GET', '/requests').then((d) => setMine(d.requests)).catch(() => {});
  }, []);
  useFocusEffect(useCallback(() => { load(); }, [load]));

  const send = async () => {
    setBusy(true); setError(''); setDone('');
    try {
      await api('POST', '/requests', { schoolId: Number(school), childName, admissionNo, className, relation, note }, t('netError'));
      setDone(t('sent')); setChildName(''); setAdmissionNo(''); setClassName(''); setNote(''); load();
    } catch (e) { setError((e as Error).message); }
    setBusy(false);
  };
  const Q: Record<Request['status'], [string, 'warn' | 'ok' | 'bad']> = { pending: [t('q_pending'), 'warn'], done: [t('q_done'), 'ok'], rejected: [t('q_rejected'), 'bad'] };

  return (
    <Screen title={t('requestTitle')}>
        <ScrollView contentContainerStyle={st.wrap} keyboardShouldPersistTaps="handled">
          <Text style={st.intro}>{t('requestIntro')}</Text>
          <Card style={{ gap: 12 }}>
            <View>
              <Text style={s.label}>{t('chooseSchool')}</Text>
              <View style={{ gap: 8 }}>
                {schools.map((x) => {
                  const on = school === String(x.id);
                  return (
                    <Pressable key={x.id} onPress={() => setSchool(String(x.id))} accessibilityRole="radio" accessibilityState={{ selected: on }}
                      style={[st.school, on && { borderColor: schoolColor(x.code), backgroundColor: `${schoolColor(x.code)}12` }]}>
                      <View style={[st.radio, { borderColor: on ? schoolColor(x.code) : C.line }]}>{on ? <View style={[st.radioDot, { backgroundColor: schoolColor(x.code) }]} /> : null}</View>
                      <Text style={st.schoolTxt}>{x.name}</Text>
                    </Pressable>
                  );
                })}
              </View>
            </View>
            <View><Text style={s.label}>{t('childName')}</Text><TextInput style={s.input} value={childName} onChangeText={setChildName} autoCapitalize="characters" maxLength={120} /></View>
            <View><Text style={s.label}>{t('admNoOpt')}</Text><TextInput style={s.input} value={admissionNo} onChangeText={setAdmissionNo} autoCapitalize="characters" maxLength={20} /></View>
            <View><Text style={s.label}>{t('classOpt')}</Text><TextInput style={s.input} value={className} onChangeText={setClassName} autoCapitalize="characters" maxLength={40} /></View>
            <View>
              <Text style={s.label}>{t('relation')}</Text>
              <Choice<Rel> value={relation} onChange={setRelation} options={[{ value: 'mother', label: t('mother') }, { value: 'father', label: t('father') }, { value: 'guardian', label: t('guardian') }]} />
            </View>
            <View><Text style={s.label}>{t('noteOpt')}</Text><TextInput style={[s.input, { minHeight: 70 }]} value={note} onChangeText={setNote} multiline maxLength={200} /></View>
            <ErrorText error={error} />
            {done ? <View style={st.okRow}><Icon name="check" size={18} color={C.green} width={2.6} /><Text style={st.ok}>{done}</Text></View> : null}
            <Button label={t('send')} onPress={send} busy={busy} disabled={!school || childName.trim().length < 3} />
          </Card>

          {mine.length > 0 && <Section>{t('myRequests')}</Section>}
          {mine.map((r) => (
            <Card key={r.id}>
              <View style={st.head}>
                <Text style={st.name}>{nice(r.childName)}</Text>
                <Pill tone={Q[r.status][1]} label={Q[r.status][0]} />
              </View>
              <Text style={s.muted}>{r.school}{r.admissionNo ? ` · ${r.admissionNo}` : ''} · {fmtDate(lang, r.at)}</Text>
              {r.answer ? <Text style={st.answer}>{r.answer}</Text> : null}
            </Card>
          ))}
        </ScrollView>
    </Screen>
  );
}

const st = StyleSheet.create({
  wrap: { paddingHorizontal: PAD, paddingTop: 20, gap: 14, paddingBottom: 48 },
  intro: { color: C.muted, lineHeight: 21 },
  ok: { flex: 1, color: C.green, fontWeight: '700' },
  okRow: { flexDirection: 'row', alignItems: 'center', gap: 8, backgroundColor: C.okSoft, padding: 12, borderRadius: 14 },
  school: { flexDirection: 'row', alignItems: 'center', gap: 12, padding: 14, borderRadius: 14, borderWidth: 1.5, borderColor: C.line, backgroundColor: 'rgba(255,255,255,0.7)' },
  schoolTxt: { flex: 1, color: C.text, fontWeight: '600', fontSize: 15 },
  radio: { width: 22, height: 22, borderRadius: 11, borderWidth: 2, alignItems: 'center', justifyContent: 'center' },
  radioDot: { width: 11, height: 11, borderRadius: 6 },
  head: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', gap: 8 },
  name: { fontWeight: '800', color: C.text, flex: 1 },
  answer: { marginTop: 8, color: C.text, backgroundColor: C.redSoft, padding: 10, borderRadius: 10, lineHeight: 19 },
});
