// Home: a short summary of what needs attention, then the parent's children grouped by school.
import { router, useFocusEffect } from 'expo-router';
import { useCallback, useState } from 'react';
import { Pressable, RefreshControl, ScrollView, StyleSheet, Text, View } from 'react-native';

import ChildPhoto from '@/components/child-photo';
import { Icon } from '@/components/icons';
import { BAR_SPACE, PAD, Button, C, Card, Empty, ErrorText, Loading, Pill, Screen, Section, Stat, nice, schoolColor } from '@/components/ui';
import { api, type Child, type Me } from '@/lib/api';
import { tsh } from '@/lib/i18n';
import { useSession } from '@/lib/session';

export default function Home() {
  const { t, setParent } = useSession();
  const [me, setMe] = useState<Me | null>(null);
  const [unread, setUnread] = useState(0);
  const [error, setError] = useState('');
  const [refreshing, setRefreshing] = useState(false);

  const load = useCallback(async () => {
    try {
      const d = await api<Me>('GET', '/me', undefined, t('netError'));
      setMe(d); setParent(d.parent); setError('');
      setUnread(d.children.reduce((n, c) => n + c.unread, 0));
    } catch (e) { setError((e as Error).message); }
  }, [t, setParent]);
  useFocusEffect(useCallback(() => { load(); }, [load]));
  const refresh = async () => { setRefreshing(true); await load(); setRefreshing(false); };

  // Group by school, in the order the server sends (children who left go last).
  const groups: { code: string; name: string; kids: Child[] }[] = [];
  for (const c of me?.children || []) {
    const g = groups.find((x) => x.code === c.school.code) || (groups.push({ code: c.school.code, name: c.school.name, kids: [] }), groups[groups.length - 1]);
    g.kids.push(c);
  }
  const name = me?.parent.fullName ? nice(me.parent.fullName.split(' ')[0]) : '';
  const kids = me?.children || [];
  const toPay = kids.reduce((n, c) => n + c.billsTotal, 0);
  const waiting = kids.reduce((n, c) => n + c.itemsWaiting, 0);
  const needs = toPay > 0 || waiting > 0 || unread > 0;

  const hero = (
    <View style={st.hero}>
      <Text style={st.hi}>{name ? t('hello', { name }) : t('helloNoName')}</Text>
      <Text style={st.sub}>{kids.length ? t('myChildren') : t('appName')}</Text>
    </View>
  );

  return (
    <Screen title={t('appName')} back={false} hero={hero} tab="home" badge={unread}>
      {!me && !error ? <Loading /> : (
        <ScrollView contentContainerStyle={st.wrap} showsVerticalScrollIndicator={false}
          refreshControl={<RefreshControl refreshing={refreshing} onRefresh={refresh} colors={[C.green]} />}>
          <ErrorText error={error} />
          {error && !me ? <Button kind="plain" label={t('retry')} onPress={load} /> : null}

          {me && kids.length > 0 && (needs ? (
            <View style={st.stats}>
              {toPay > 0 && <Stat icon="card" tone="bad" value={`TSh ${tsh(toPay)}`} label={t('statToPay')} />}
              {waiting > 0 && <Stat icon="box" tone="warn" value={String(waiting)} label={t('statItems')} />}
              {unread > 0 && <Stat icon="bell" tone="gold" value={String(unread)} label={t('statNew')} />}
            </View>
          ) : (
            <View style={st.allGood}><Icon name="check" size={18} color={C.green} width={2.6} /><Text style={st.allGoodTxt}>{t('allGood')}</Text></View>
          ))}

          {me && !kids.length && (
            <Card><Empty icon="user" hint={t('noChildrenHelp')}>{t('noChildren')}</Empty></Card>
          )}

          {groups.map((g) => (
            <View key={g.code} style={st.group}>
              <View style={st.schoolHead}>
                <View style={[st.dot, { backgroundColor: schoolColor(g.code) }]} />
                <Section>{g.name}</Section>
              </View>
              {g.kids.map((c) => <ChildCard key={c.id} c={c} />)}
            </View>
          ))}

          {me && me.requestsPending > 0 && (
            <Pressable onPress={() => router.push('/request')}><Pill tone="warn" icon="clock" label={t('requestsWaiting', { n: me.requestsPending })} /></Pressable>
          )}
          {me && <Button kind="plain" icon="plus" label={t('missingChild')} onPress={() => router.push('/request')} />}

          <View style={st.soon}><Icon name="sparkle" size={16} color={C.muted} /><Text style={st.soonTxt}>{t('comingSoon')}</Text></View>
        </ScrollView>
      )}
    </Screen>
  );
}

function ChildCard({ c }: { c: Child }) {
  const { t } = useSession();
  const left = c.status === 'left';
  return (
    <Card accent={schoolColor(c.school.code)} onPress={() => router.push({ pathname: '/child/[id]', params: { id: String(c.id) } })} style={left ? { opacity: 0.65 } : undefined}>
      <View style={st.childTop}>
        <ChildPhoto child={c} size={68} />
        <View style={st.childInfo}>
          <Text style={st.childName} numberOfLines={2}>{nice(c.fullName)}</Text>
          <Text style={st.childMeta} numberOfLines={1}>{[nice(c.class), c.admissionNo].filter(Boolean).join('  ·  ')}</Text>
        </View>
        <Icon name="chev" size={20} color={C.muted} />
      </View>
      <View style={st.tags}>
        {left && <Pill label={t('left')} />}
        {c.bills > 0 && <Pill tone="bad" icon="card" label={`TSh ${tsh(c.billsTotal)}`} />}
        {c.itemsWaiting > 0 && <Pill tone="warn" icon="box" label={t('itemsWaiting', { n: c.itemsWaiting })} />}
        {c.borrowed > 0 && <Pill icon="hand" label={t('borrowed', { n: c.borrowed })} />}
        {c.unread > 0 && <Pill tone="gold" icon="bell" label={t('unread', { n: c.unread })} />}
        {!left && !c.idCard && <Pill icon="info" label={t('idNotIssued')} />}
      </View>
    </Card>
  );
}

const st = StyleSheet.create({
  hero: { marginTop: 14, gap: 2 },
  hi: { color: '#fff', fontSize: 26, fontWeight: '800', letterSpacing: -0.4 },
  sub: { color: 'rgba(255,255,255,0.78)', fontSize: 14.5 },
  wrap: { paddingHorizontal: PAD, paddingTop: 22, gap: 22, paddingBottom: BAR_SPACE },
  stats: { flexDirection: 'row', gap: 16 },
  allGood: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  allGoodTxt: { flex: 1, color: C.green, fontWeight: '700', lineHeight: 20 },
  group: { gap: 0 },
  schoolHead: { flexDirection: 'row', alignItems: 'center', gap: 8, marginBottom: 4 },
  dot: { width: 10, height: 10, borderRadius: 5, marginTop: 6 },
  childTop: { flexDirection: 'row', gap: 14, alignItems: 'center' },
  childInfo: { flex: 1, gap: 2 },
  childName: { fontSize: 19, fontWeight: '800', color: C.text, letterSpacing: -0.2 },
  childMeta: { color: C.muted, fontSize: 14.5 },
  tags: { flexDirection: 'row', flexWrap: 'wrap', gap: 8, marginTop: 12 },
  soon: { flexDirection: 'row', gap: 8, alignItems: 'flex-start', paddingHorizontal: 6, marginTop: 4 },
  soonTxt: { flex: 1, color: C.muted, fontSize: 13, lineHeight: 19 },
});
