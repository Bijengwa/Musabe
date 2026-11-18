// Notices about all the children (or one), newest first. Opening this screen marks them as seen.
import { useFocusEffect } from 'expo-router';
import { useCallback, useState } from 'react';
import { FlatList, RefreshControl, StyleSheet, Text, View } from 'react-native';

import { Icon, type IconName } from '@/components/icons';
import { BAR_SPACE, PAD, Button, C, Card, Empty, ErrorText, Loading, Screen, Tabs, nice } from '@/components/ui';
import { api, type Me, type Notice } from '@/lib/api';
import { fmtDate } from '@/lib/i18n';
import { useSession } from '@/lib/session';

const KIND_ICON: Record<Notice['kind'], IconName> = { given: 'hand', issued: 'box', returned: 'check', receipt: 'receipt' };

export default function Notices() {
  const { t, lang } = useSession();
  const [kids, setKids] = useState<{ id: number; name: string }[]>([]);
  const [child, setChild] = useState<number | null>(null);
  const [list, setList] = useState<Notice[] | null>(null);
  const [more, setMore] = useState(false);
  const [error, setError] = useState('');
  const [refreshing, setRefreshing] = useState(false);

  const load = useCallback(async (before?: number) => {
    try {
      const q = new URLSearchParams();
      if (child) q.set('child', String(child));
      if (before) q.set('before', String(before));
      const d = await api<{ notices: Notice[]; more: boolean }>('GET', `/notices?${q}`, undefined, t('netError'));
      setList((old) => (before && old ? [...old, ...d.notices] : d.notices)); setMore(d.more); setError('');
      if (!before && d.notices.length) api('POST', '/notices/seen', { upTo: d.notices[0].id }).catch(() => {});
    } catch (e) { setError((e as Error).message); }
  }, [child, t]);
  useFocusEffect(useCallback(() => {
    load();
    api<Me>('GET', '/me').then((m) => setKids(m.children.map((c) => ({ id: c.id, name: nice(c.firstName) })))).catch(() => {});
  }, [load]));
  const refresh = async () => { setRefreshing(true); await load(); setRefreshing(false); };
  const KIND: Record<Notice['kind'], string> = { given: t('k_given'), issued: t('k_issued'), returned: t('k_returned'), receipt: t('k_receipt') };

  return (
    <Screen title={t('notices')} back={false} tab="notices">
      {kids.length > 1 && (
        <View style={st.filter}>
          <Tabs<string> value={String(child || 0)} onChange={(v) => { setList(null); setChild(Number(v) || null); }}
            options={[{ value: '0', label: t('allChildren') }, ...kids.map((k) => ({ value: String(k.id), label: k.name }))]} />
        </View>
      )}
      <ErrorText error={error} />
      {!list ? <Loading /> : (
        <FlatList data={list} keyExtractor={(n) => String(n.id)} contentContainerStyle={st.wrap} showsVerticalScrollIndicator={false}
          refreshControl={<RefreshControl refreshing={refreshing} onRefresh={refresh} colors={[C.green]} />}
          ListEmptyComponent={<Card><Empty icon="bell">{t('noNotices')}</Empty></Card>}
          ListFooterComponent={more ? <Button kind="plain" label={t('more')} onPress={() => load(list[list.length - 1]?.id)} /> : undefined}
          renderItem={({ item: n }) => (
            <Card>
              <View style={st.top}>
                <View style={[st.icon, n.unread && { backgroundColor: C.goldSoft }]}>
                  <Icon name={KIND_ICON[n.kind] || 'bell'} size={20} color={n.unread ? C.amber : C.green2} />
                </View>
                <View style={st.who}>
                  <Text style={st.name} numberOfLines={1}>{nice(n.child)}</Text>
                  <Text style={st.meta} numberOfLines={1}>{KIND[n.kind] || n.kind}  ·  {fmtDate(lang, n.at, true)}</Text>
                </View>
                {n.unread ? <View style={st.newDot} /> : null}
              </View>
              <Text style={st.title}>{n.title}</Text>
              <Text style={st.body}>{n.body}</Text>
              {n.ref ? <Text style={st.ref}>{n.ref}</Text> : null}
            </Card>
          )} />
      )}
    </Screen>
  );
}

const st = StyleSheet.create({
  wrap: { paddingHorizontal: PAD, paddingTop: 6, paddingBottom: BAR_SPACE },
  filter: { paddingTop: 16, paddingBottom: 6 },
  top: { flexDirection: 'row', alignItems: 'center', gap: 12, marginBottom: 10 },
  icon: { width: 40, height: 40, borderRadius: 14, backgroundColor: C.okSoft, alignItems: 'center', justifyContent: 'center' },
  who: { flex: 1, gap: 1 },
  name: { fontWeight: '800', color: C.text, fontSize: 15 },
  meta: { color: C.muted, fontSize: 12.5 },
  newDot: { width: 10, height: 10, borderRadius: 5, backgroundColor: C.gold },
  title: { fontWeight: '800', color: C.text, fontSize: 15.5 },
  body: { color: C.text, lineHeight: 21, marginTop: 3 },
  ref: { color: C.muted, fontSize: 12.5, marginTop: 8 },
});
