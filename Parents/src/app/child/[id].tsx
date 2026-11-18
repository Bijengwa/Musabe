// One child: details, receipts (paid items and whether they were collected), control numbers to pay, things given out.
import { useFocusEffect, useLocalSearchParams } from 'expo-router';
import { useCallback, useState } from 'react';
import { RefreshControl, ScrollView, StyleSheet, Text, View } from 'react-native';

import ChildPhoto from '@/components/child-photo';
import { Icon } from '@/components/icons';
import { PAD, C, Card, Empty, ErrorText, Loading, Pill, Row, Screen, Section, Tabs, nice, s, schoolColor } from '@/components/ui';
import { api, type Bill, type Child, type Issued, type Notice, type Receipt } from '@/lib/api';
import { fmtDate, tsh } from '@/lib/i18n';
import { useSession } from '@/lib/session';

type Tab = 'overview' | 'receipts' | 'bills' | 'issued';
type Data = { child: Child; receipts: Receipt[]; bills: Bill[]; issued: Issued[]; notices: Notice[] };

export default function ChildScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const { t } = useSession();
  const [tab, setTab] = useState<Tab>('overview');
  const [d, setD] = useState<Data | null>(null);
  const [error, setError] = useState('');
  const [refreshing, setRefreshing] = useState(false);

  const load = useCallback(async () => {
    try {
      const n = t('netError');
      const [c, r, b, i, no] = await Promise.all([
        api<{ child: Child }>('GET', `/children/${id}`, undefined, n),
        api<{ receipts: Receipt[] }>('GET', `/children/${id}/receipts`, undefined, n),
        api<{ bills: Bill[] }>('GET', `/children/${id}/bills`, undefined, n),
        api<{ issued: Issued[] }>('GET', `/children/${id}/issued`, undefined, n),
        api<{ notices: Notice[] }>('GET', `/notices?child=${id}`, undefined, n),
      ]);
      setD({ child: c.child, receipts: r.receipts, bills: b.bills, issued: i.issued, notices: no.notices.slice(0, 5) }); setError('');
    } catch (e) { setError((e as Error).message); }
  }, [id, t]);
  useFocusEffect(useCallback(() => { load(); }, [load]));
  const refresh = async () => { setRefreshing(true); await load(); setRefreshing(false); };

  if (!d) return <Screen title="">{error ? <View style={{ padding: 16 }}><ErrorText error={error} /></View> : <Loading />}</Screen>;
  const c = d.child;
  const pendingBills = d.bills.filter((b) => b.status === 'pending').length;

  const hero = (
    <View style={st.hero}>
      <View style={st.photoRing}><ChildPhoto child={c} size={64} /></View>
      <View style={st.heroInfo}>
        <Text style={st.name} numberOfLines={2}>{nice(c.fullName)}</Text>
        <Text style={st.heroSub} numberOfLines={1}>{c.school.shortName}  ·  {nice(c.classFull || c.class)}</Text>
      </View>
    </View>
  );

  return (
    <Screen title={nice(c.firstName)} hero={hero}>
      <ScrollView contentContainerStyle={st.wrap} showsVerticalScrollIndicator={false} refreshControl={<RefreshControl refreshing={refreshing} onRefresh={refresh} colors={[C.green]} />}>
        <ErrorText error={error} />
        <View style={st.tabsBleed}>
          <Tabs<Tab> value={tab} onChange={setTab} options={[
            { value: 'overview', label: t('overview'), icon: 'overview' },
            { value: 'receipts', label: t('receipts'), icon: 'receipt' },
            { value: 'bills', label: t('bills'), icon: 'card', count: pendingBills },
            { value: 'issued', label: t('issued'), icon: 'hand' },
          ]} />
        </View>
        {tab === 'overview' && <Overview d={d} />}
        {tab === 'receipts' && (d.receipts.length ? d.receipts.map((r) => <ReceiptCard key={r.id} r={r} />) : <Card><Empty icon="receipt">{t('noReceipts')}</Empty></Card>)}
        {tab === 'bills' && (d.bills.length ? d.bills.map((b) => <BillCard key={b.id} b={b} />) : <Card><Empty icon="card">{t('noBills')}</Empty></Card>)}
        {tab === 'issued' && (d.issued.length ? <Card>{d.issued.map((x) => <IssuedRow key={x.id} x={x} />)}</Card> : <Card><Empty icon="hand">{t('noIssued')}</Empty></Card>)}
      </ScrollView>
    </Screen>
  );
}

function Overview({ d }: { d: Data }) {
  const { t, lang } = useSession();
  const c = d.child;
  const card = c.idCard && typeof c.idCard === 'object' ? c.idCard : null;
  return (
    <>
      <Card>
        <Row label={t('school')} value={c.school.name} />
        <Row label={t('class')} value={nice(c.classFull || c.class) || '—'} />
        <Row label={t('admNo')} value={c.admissionNo} />
        <Row label={t('sex')} value={c.sex === 'M' ? t('boy') : t('girl')} />
        <Row label={t('status')} value={<Pill tone={c.status === 'left' ? 'muted' : 'ok'} label={c.status === 'left' ? t('left') : t('active')} />} />
        <Row label={t('idCard')} value={<Pill tone={card ? 'ok' : 'warn'} label={card ? t('issuedOn', { date: fmtDate(lang, card.issuedAt) }) : t('notYet')} />} />
      </Card>
      {(c.bills > 0 || c.itemsWaiting > 0) && (
        <View style={{ gap: 8 }}>
          {c.bills > 0 && <Pill tone="bad" label={t('toPay', { amount: tsh(c.billsTotal) })} />}
          {c.itemsWaiting > 0 && <Pill tone="warn" label={t('itemsWaiting', { n: c.itemsWaiting })} />}
        </View>
      )}
      <Section>{t('notices')}</Section>
      {d.notices.length ? <Card>{d.notices.map((n) => (
        <View key={n.id} style={st.notice}>
          <Text style={st.noticeT}>{n.title}</Text>
          <Text style={st.noticeB}>{n.body}</Text>
          <Text style={st.when}>{fmtDate(lang, n.at, true)}{n.ref ? `  ·  ${n.ref}` : ''}</Text>
        </View>
      ))}</Card> : <Card><Empty icon="bell">{t('noNotices')}</Empty></Card>}
      <View style={st.soonRow}><Icon name="sparkle" size={16} color={C.muted} /><Text style={st.soon}>{t('comingSoon')}</Text></View>
    </>
  );
}

function ReceiptCard({ r }: { r: Receipt }) {
  const { t, lang } = useSession();
  const tone = r.status === 'given' ? 'ok' : r.status === 'part' ? 'warn' : 'gold';
  const label = r.status === 'given' ? t('rGiven') : r.status === 'part' ? t('rPart') : t('rWaiting');
  return (
    <Card>
      <View style={st.cardHead}>
        <View><Text style={st.mono}>{r.number}</Text><Text style={st.when}>{fmtDate(lang, r.soldAt, true)}</Text></View>
        <Pill tone={tone} label={label} />
      </View>
      {r.lines.map((l, i) => (
        <View key={i} style={st.line}>
          <View style={{ flex: 1 }}>
            <Text style={st.item}>{l.qty} × {l.item}</Text>
            {l.waitingStock && l.given < l.qty ? <Text style={st.warnTxt}>{t('waitingStock')}</Text>
              : l.given > 0 && l.given < l.qty ? <Text style={s.muted}>{t('given', { n: l.given })}</Text> : null}
          </View>
          <Text style={st.amount}>{tsh(l.amount)}</Text>
        </View>
      ))}
      <View style={st.totalRow}>
        <Text style={s.muted}>{t('paidBy')}: {t(`m_${r.method}` as 'm_cash')}</Text>
        <Text style={st.total}>TSh {tsh(r.total)}</Text>
      </View>
    </Card>
  );
}

function BillCard({ b }: { b: Bill }) {
  const { t, lang } = useSession();
  const tone = b.status === 'paid' ? 'ok' : b.status === 'pending' ? 'bad' : 'muted';
  return (
    <Card>
      <View style={st.cardHead}>
        <Pill tone={tone} label={t(`b_${b.status}` as 'b_paid')} />
        <Text style={st.total}>TSh {tsh(b.total)}</Text>
      </View>
      <Text style={[s.muted, { marginTop: 8 }]}>{t('controlNo')}</Text>
      <View style={st.controlBox}><Text selectable style={st.control}>{b.controlNo.replace(/(\d{4})(?=\d)/g, '$1 ')}</Text></View>
      {b.status === 'pending' && <Text style={st.warnTxt}>{t('payBefore', { date: fmtDate(lang, b.expiresAt, true) })}</Text>}
      {b.status === 'pending' && <Text style={[s.muted, { marginTop: 6, lineHeight: 19 }]}>{t('payHow')}</Text>}
      <View style={{ marginTop: 8 }}>
        {b.lines.map((l, i) => <View key={i} style={st.line}><Text style={[st.item, { flex: 1 }]}>{l.qty} × {l.item}</Text><Text style={st.amount}>{tsh(l.amount)}</Text></View>)}
      </View>
    </Card>
  );
}

function IssuedRow({ x }: { x: Issued }) {
  const { t, lang } = useSession();
  const state = !x.comesBack ? null : x.returned ? (
    <Pill tone={x.returned === 'good' ? 'ok' : 'bad'} label={t(`r_${x.returned}` as 'r_good')} />
  ) : <Pill tone="warn" label={t('notReturned')} />;
  return (
    <View style={st.line}>
      <View style={{ flex: 1, gap: 2 }}>
        <Text style={st.item}>{x.qty} {x.unit.toLowerCase()} · {x.item}</Text>
        <Text style={st.when}>{fmtDate(lang, x.at)}  ·  {x.number}</Text>
      </View>
      {state}
    </View>
  );
}

const st = StyleSheet.create({
  wrap: { paddingHorizontal: PAD, paddingTop: 16, gap: 8, paddingBottom: 48 },
  hero: { flexDirection: 'row', gap: 14, alignItems: 'center', marginTop: 14 },
  photoRing: { padding: 3, borderRadius: 40, backgroundColor: 'rgba(255,255,255,0.9)' },
  heroInfo: { flex: 1, gap: 3 },
  name: { fontSize: 20, fontWeight: '800', color: '#fff', letterSpacing: -0.3 },
  heroSub: { color: 'rgba(255,255,255,0.82)', fontSize: 13.5 },
  tabsBleed: { marginHorizontal: -PAD, marginBottom: 8 },
  cardHead: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 6 },
  mono: { fontWeight: '800', color: C.text, fontSize: 16 },
  when: { color: C.muted, fontSize: 12.5 },
  line: { flexDirection: 'row', alignItems: 'center', gap: 10, paddingVertical: 10, borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: C.line },
  item: { color: C.text, fontWeight: '600', fontSize: 14.5 },
  amount: { color: C.text, fontWeight: '600' },
  totalRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginTop: 12 },
  total: { fontWeight: '800', color: C.text, fontSize: 17 },
  controlBox: { backgroundColor: C.goldSoft, borderRadius: 14, paddingVertical: 10, paddingHorizontal: 14, marginTop: 8, alignItems: 'center' },
  control: { fontSize: 26, fontWeight: '800', letterSpacing: 1.5, color: C.text },
  warnTxt: { color: C.amber, fontSize: 13.5, fontWeight: '700', marginTop: 8 },
  notice: { paddingVertical: 10, borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: C.line, gap: 2 },
  noticeT: { fontWeight: '800', color: C.text },
  noticeB: { color: C.text, lineHeight: 20 },
  soonRow: { flexDirection: 'row', gap: 8, alignItems: 'flex-start', paddingHorizontal: 6, marginTop: 4 },
  soon: { flex: 1, color: C.muted, fontSize: 13, lineHeight: 19 },
});
