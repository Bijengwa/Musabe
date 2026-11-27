// Fees (2026-11-24): the Finance Office. Fee structure (Finance Manager writes, Manager / Director approves),
// payments (Bursar records, Accountant confirms) and balances.
import { useCallback, useEffect, useState } from 'react';
import { api } from '../api';
import { useAuth } from '../auth/AuthContext';
import { useLive } from '../live';
import { useSchools } from '../layout/scope';
import { Empty, ErrorNote, ExcelButton, Icon, Kpi, Loading, Modal, PageHead, Panel, Tabs, tsh, useToast } from '../components/ui';
import { todayStr } from '../components/common';

const RES = { all: 'Everyone', day: 'Day', boarding: 'Boarding' };
const TONE = { draft: 'warn', approved: 'ok', closed: '', withdrawn: '' };

export default function Fees() {
  const { user } = useAuth();
  const schools = useSchools();
  const [tab, setTab] = useState(user.role === 'fm' || ['manager', 'director'].includes(user.role) ? 'structure' : 'payments');
  const [school, setSchool] = useState(user.school?.id ? String(user.school.id) : '');
  const [year, setYear] = useState(new Date().getFullYear() + 1);
  const admin = !user.school?.id;
  useEffect(() => { if (admin && !school && schools.length) setSchool(String(schools[0].id)); }, [admin, school, schools]);
  return (
    <>
      <PageHead title="Fees" sub="The Finance Manager sets the fees, the Manager approves, the Bursar records what parents pay, the Accountant confirms.">
        {admin && <select value={school} onChange={(e) => setSchool(e.target.value)} aria-label="School">{schools.map((s) => <option key={s.id} value={s.id}>{s.shortName}</option>)}</select>}
        <input type="number" value={year} onChange={(e) => setYear(Number(e.target.value))} style={{ width: 90 }} aria-label="Year" />
      </PageHead>
      <Tabs tabs={[['structure', 'Fee structure'], ['payments', 'Payments'], ['balances', 'Balances'], ['bsmart', 'B-SMART (CRDB)']]} value={tab} onChange={setTab} />
      {school && tab === 'structure' && <Structure school={school} year={year} />}
      {school && tab === 'payments' && <Payments school={school} year={year} />}
      {school && tab === 'balances' && <Balances school={school} year={year} />}
      {school && tab === 'bsmart' && <Bsmart school={school} year={year} />}
    </>
  );
}

function Structure({ school, year }) {
  const toast = useToast();
  const [d, setD] = useState(null);
  const [error, setError] = useState('');
  const [add, setAdd] = useState(false);
  const [hist, setHist] = useState(false);
  const load = useCallback(() => api.get(`/fees/structure?school=${school}&year=${year}${hist ? '&history=1' : ''}`).then((x) => { setD(x); setError(''); }).catch((e) => setError(e.message)), [school, year, hist]);
  useEffect(() => { load(); }, [load]);
  useLive(['fees'], load);
  const act = async (fn, msg) => { setError(''); try { await fn(); toast(msg); load(); } catch (e) { setError(e.message); } };
  return (
    <>
      <div className="row" style={{ margin: '8px 0', gap: 8 }}>
        {d?.canWrite && <button className="btn p" onClick={() => setAdd(true)}><Icon name="plus" /> Add fee</button>}
        {d?.canApprove && <button className="btn p" disabled={!d.drafts} onClick={() => act(() => api.post('/fees/structure/approve', { schoolId: Number(school), year }), 'Fees approved')}>Approve {d.drafts || ''} waiting</button>}
        <label className="small"><input type="checkbox" checked={hist} onChange={(e) => setHist(e.target.checked)} /> Show old and withdrawn lines</label>
      </div>
      <ErrorNote error={error} />
      <Panel flush>
        {!d ? <Loading /> : !d.lines.length ? <Empty icon="tag" title={`No fees for ${year} yet`} steps={['The Finance Manager adds each fee: class, day or boarding, term, amount.', 'The Manager or the Director approves them.', 'Then the Bursar can record payments.']} /> : (
          <div className="tw"><table className="stafftable"><thead><tr><th className="stick">Fee</th><th>Class</th><th>Who</th><th>Term</th><th>Amount (TSh)</th><th>Status</th><th>By</th><th /></tr></thead>
            <tbody>{d.lines.map((l) => (
              <tr key={l.id}><td className="stick"><b>{l.name}</b></td><td>{l.levelName}</td><td>{RES[l.residence]}</td><td>{l.termLabel}</td><td><b>{tsh(l.amount)}</b></td>
                <td><span className={`pill ${TONE[l.status]}`}>{l.status === 'draft' ? 'Waiting for approval' : l.status}</span></td><td className="small">{l.by}{l.approvedBy && <div className="muted">approved by {l.approvedBy}</div>}</td>
                <td>{l.status === 'draft' && d.canWrite && <button className="btn sm" onClick={() => act(() => api.post(`/fees/structure/${l.id}/withdraw`), 'Withdrawn')}>Withdraw</button>}</td></tr>
            ))}</tbody></table></div>
        )}
      </Panel>
      {add && <AddFee school={school} year={year} levels={d.levels} onClose={() => setAdd(false)} onSaved={() => { setAdd(false); toast('Fee saved: waiting for approval'); load(); }} />}
    </>
  );
}

function AddFee({ school, year, levels, onClose, onSaved }) {
  const [f, setF] = useState({ name: '', level: '', residence: 'all', term: 0, amount: '' });
  const [error, setError] = useState('');
  const set = (k, v) => setF((x) => ({ ...x, [k]: v }));
  const save = async (e) => { e.preventDefault(); setError(''); try { await api.post('/fees/structure', { ...f, schoolId: Number(school), year, term: Number(f.term), amount: Number(f.amount), level: f.level || null }); onSaved(); } catch (err) { setError(err.message); } };
  return (
    <Modal title={`Add fee ${year}`} onClose={onClose} footer={<><button className="btn" onClick={onClose}>Cancel</button><button className="btn p" form="ffee">Save</button></>}>
      <form id="ffee" className="stack" onSubmit={save}>
        <div className="fg"><label>Name of the fee<input value={f.name} onChange={(e) => set('name', e.target.value)} placeholder="TUITION, BOARDING, EXAMS…" required autoFocus /></label>
          <label>Amount (TSh)<input type="number" min="1" value={f.amount} onChange={(e) => set('amount', e.target.value)} required /></label></div>
        <div className="fg"><label>Class<select value={f.level} onChange={(e) => set('level', e.target.value)}><option value="">All classes</option>{levels.map((l) => <option key={l.key} value={l.key}>{l.name}</option>)}</select></label>
          <label>Who pays<select value={f.residence} onChange={(e) => set('residence', e.target.value)}>{Object.entries(RES).map(([k, t]) => <option key={k} value={k}>{t}</option>)}</select></label></div>
        <label>Term<select value={f.term} onChange={(e) => set('term', e.target.value)}><option value="0">Whole year</option><option value="1">Term 1</option><option value="2">Term 2</option></select></label>
        <p className="small muted" style={{ margin: 0 }}>A new amount for a fee that is already approved takes over only when the Manager approves it.</p>
        <ErrorNote error={error} />
      </form>
    </Modal>
  );
}

function Payments({ school, year }) {
  const { user } = useAuth();
  const toast = useToast();
  const [d, setD] = useState(null);
  const [error, setError] = useState('');
  const [status, setStatus] = useState('');
  const [rec, setRec] = useState(false);
  const load = useCallback(() => api.get(`/fees/payments?school=${school}${status ? `&status=${status}` : ''}`).then((x) => { setD(x); setError(''); }).catch((e) => setError(e.message)), [school, status]);
  useEffect(() => { load(); }, [load]);
  useLive(['fees'], load);
  const confirm = async (p) => { setError(''); try { await api.post(`/fees/payments/${p.id}/confirm`); toast('Confirmed'); load(); } catch (e) { setError(e.message); } };
  return (
    <>
      <div className="row" style={{ margin: '8px 0', gap: 8 }}>
        <div className="seg">{[['', 'All'], ['recorded', 'Waiting for the Accountant'], ['confirmed', 'Confirmed']].map(([k, t]) => <button key={k} type="button" className={status === k ? 'on' : ''} onClick={() => setStatus(k)}>{t}</button>)}</div>
        <ExcelButton href={`/api/fees/payments/export.xlsx?school=${school}`} />
        {d?.canRecord && <button className="btn p" onClick={() => setRec(true)}><Icon name="plus" /> Record payment</button>}
      </div>
      {d && <div className="kpis"><Kpi tone={d.waiting ? 'warn' : 'ok'} label="Waiting for the Accountant" value={d.waiting} sub={`TSh ${tsh(d.waitingSum)}`} /></div>}
      <ErrorNote error={error} />
      <Panel flush>
        {!d ? <Loading /> : !d.payments.length ? <Empty icon="receipt" title="No fee payments here" steps={['The Bursar records each payment with the bank slip or mobile money number.', 'The Accountant confirms it.']} /> : (
          <div className="tw"><table className="stafftable"><thead><tr><th className="stick">Number</th><th>Date</th><th>Student</th><th>For</th><th>Amount (TSh)</th><th>How</th><th>Status</th><th /></tr></thead>
            <tbody>{d.payments.map((p) => (
              <tr key={p.id}><td className="stick nowrap"><b className="mono">{p.number}</b></td><td className="nowrap">{p.paidOn}</td><td><b>{p.student}</b><div className="small muted">{p.admissionNo}</div></td><td className="small">{p.term} {p.year}</td>
                <td><b>{tsh(p.amount)}</b></td><td className="small">{p.method}{p.reference && <div className="mono">{p.reference}</div>}</td>
                <td><span className={`pill ${p.status === 'confirmed' ? 'ok' : 'warn'}`}>{p.status === 'confirmed' ? 'Confirmed' : 'Waiting'}</span>{p.confirmedBy && <div className="small muted">{p.confirmedBy}</div>}</td>
                <td>{p.status === 'recorded' && d.canConfirm && <button className="btn sm p" onClick={() => confirm(p)}>Confirm</button>}</td></tr>
            ))}</tbody></table></div>
        )}
      </Panel>
      {rec && <Record year={year} onClose={() => setRec(false)} onSaved={() => { setRec(false); toast('Payment recorded'); load(); }} />}
    </>
  );
}

function Record({ year, onClose, onSaved }) {
  const [q, setQ] = useState('');
  const [found, setFound] = useState([]);
  const [st, setSt] = useState(null);
  const [f, setF] = useState({ term: 0, amount: '', method: 'bank', reference: '', paidOn: todayStr(), payer: '' });
  const [error, setError] = useState('');
  const set = (k, v) => setF((x) => ({ ...x, [k]: v }));
  useEffect(() => { if (q.trim().length < 2) { setFound([]); return; } const t = setTimeout(() => api.get(`/fees/balances?year=${year}&q=${encodeURIComponent(q)}`).then((x) => setFound(x.rows.slice(0, 8))).catch(() => {}), 250); return () => clearTimeout(t); }, [q, year]);
  const pick = (id) => api.get(`/fees/student/${id}?year=${year}`).then((x) => { setSt(x); setFound([]); }).catch((e) => setError(e.message));
  const setRes = async (residence) => { try { await api.post(`/fees/student/${st.student.id}/residence`, { residence }); await pick(st.student.id); } catch (e) { setError(e.message); } };
  const save = async (e) => { e.preventDefault(); setError(''); try { await api.post('/fees/payments', { ...f, studentId: st.student.id, year, term: Number(f.term), amount: Number(f.amount) }); onSaved(); } catch (err) { setError(err.message); } };
  return (
    <Modal wide title={`Record fee payment ${year}`} onClose={onClose} footer={<><button className="btn" onClick={onClose}>Cancel</button>{st && <button className="btn p" form="fpay">Save payment</button>}</>}>
      {!st ? (
        <>
          <label>Find the student<input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Type the name" autoFocus /></label>
          {found.map((r) => <button key={r.id} type="button" className="btn" style={{ display: 'block', width: '100%', textAlign: 'left', marginTop: 4 }} onClick={() => pick(r.id)}>{r.name} · {r.class} · balance TSh {tsh(r.balance)}</button>)}
        </>
      ) : (
        <form id="fpay" className="stack" onSubmit={save}>
          <p style={{ margin: 0 }}><b>{st.student.name}</b> · {st.student.class} · {st.student.admissionNo} <button type="button" className="btn sm" onClick={() => setSt(null)}>Change</button></p>
          <p className="small" style={{ margin: 0 }}>Due TSh <b>{tsh(st.due)}</b> · paid TSh <b>{tsh(st.paid)}</b> · balance TSh <b>{tsh(st.balance)}</b></p>
          {st.warning && <div className="small"><span className="err">{st.warning}</span> <button type="button" className="btn sm" onClick={() => setRes('day')}>Day</button> <button type="button" className="btn sm" onClick={() => setRes('boarding')}>Boarding</button></div>}
          <div className="fg"><label>Amount (TSh)<input type="number" min="1" value={f.amount} onChange={(e) => set('amount', e.target.value)} required autoFocus /></label>
            <label>Term<select value={f.term} onChange={(e) => set('term', e.target.value)}><option value="0">Whole year</option><option value="1">Term 1</option><option value="2">Term 2</option></select></label></div>
          <div className="fg"><label>How<select value={f.method} onChange={(e) => set('method', e.target.value)}><option value="bank">Bank</option><option value="mobile">Mobile money</option><option value="cash">Cash</option></select></label>
            <label>{f.method === 'cash' ? 'Reference (optional)' : 'Slip / transaction number'}<input value={f.reference} onChange={(e) => set('reference', e.target.value)} required={f.method !== 'cash'} /></label></div>
          <div className="fg"><label>Date paid<input type="date" max={todayStr()} value={f.paidOn} onChange={(e) => set('paidOn', e.target.value)} /></label><label>Paid by<input value={f.payer} onChange={(e) => set('payer', e.target.value)} placeholder="Parent name" /></label></div>
          <ErrorNote error={error} />
        </form>
      )}
      {!st && <ErrorNote error={error} />}
    </Modal>
  );
}

function Balances({ school, year }) {
  const [d, setD] = useState(null);
  const [error, setError] = useState('');
  const [owing, setOwing] = useState(true);
  const [q, setQ] = useState('');
  const load = useCallback(() => api.get(`/fees/balances?school=${school}&year=${year}${owing ? '&owing=1' : ''}${q ? `&q=${encodeURIComponent(q)}` : ''}`).then((x) => { setD(x); setError(''); }).catch((e) => setError(e.message)), [school, year, owing, q]);
  useEffect(() => { const t = setTimeout(load, 200); return () => clearTimeout(t); }, [load]);
  useLive(['fees'], load);
  return (
    <>
      <div className="row" style={{ margin: '8px 0', gap: 8 }}>
        <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search a student" />
        <label className="small"><input type="checkbox" checked={owing} onChange={(e) => setOwing(e.target.checked)} /> Only those who owe</label>
        <ExcelButton href={`/api/fees/balances/export.xlsx?school=${school}&year=${year}`} />
      </div>
      {d && <div className="kpis"><Kpi label="Due" value={tsh(d.totals.due)} /><Kpi tone="ok" label="Paid" value={tsh(d.totals.paid)} /><Kpi tone={d.totals.balance ? 'warn' : 'ok'} label="Balance" value={tsh(d.totals.balance)} sub={`${d.totals.owing} students owe`} /></div>}
      <ErrorNote error={error} />
      <Panel flush>
        {!d ? <Loading /> : !d.approved ? <Empty icon="tag" title={`No approved fees for ${year}`} steps={['The Finance Manager writes the fee structure; the Manager approves it.']} /> : !d.rows.length ? <Empty icon="check" title="Nobody owes" /> : (
          <div className="tw"><table className="stafftable"><thead><tr><th className="stick">Student</th><th>Class</th><th>Day / boarding</th><th>Due</th><th>Paid</th><th>Balance</th></tr></thead>
            <tbody>{d.rows.map((r) => <tr key={r.id}><td className="stick"><b>{r.name}</b><div className="small muted">{r.admissionNo}</div></td><td>{r.class}</td><td>{r.residence ? RES[r.residence] : <span className="muted">not set</span>}</td><td>{tsh(r.due)}</td><td>{tsh(r.paid)}</td><td><b>{tsh(r.balance)}</b></td></tr>)}</tbody></table></div>
        )}
      </Panel>
    </>
  );
}

// B-SMART (CRDB): upload the two B-SMART reports (Fee details, Payments); a second person approves; then see who paid.
const STATE = { paid: ['ok', 'Paid'], part: ['warn', 'Part paid'], unpaid: ['', 'Not paid'] };
function Bsmart({ school, year }) {
  const toast = useToast();
  const [files, setFiles] = useState(null);
  const [st, setSt] = useState(null);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const [q, setQ] = useState('');
  const [show, setShow] = useState('all');
  const [cmp, setCmp] = useState(null);
  const load = useCallback(() => {
    api.get(`/bsmart/files?school=${school}`).then(setFiles).catch((e) => setError(e.message));
    api.get(`/bsmart/status?school=${school}&year=${year}`).then((x) => { setSt(x); setError(''); }).catch((e) => setError(e.message));
  }, [school, year]);
  useEffect(() => { load(); }, [load]);
  useLive(['bsmart'], load);
  const send = async (file) => {
    if (!file) return;
    setBusy(true); setError('');
    try {
      const r = await fetch(`/api/bsmart/files?school=${school}&year=${year}`, { method: 'POST', credentials: 'include', headers: { 'X-File-Name': encodeURIComponent(file.name).slice(0, 200) }, body: file });
      const d = await r.json().catch(() => ({}));
      if (!r.ok) throw new Error(d.error || 'Upload failed.');
      toast(`${d.summary.rows} rows are waiting for approval`); load();
    } catch (e) { setError(e.message); }
    setBusy(false);
  };
  const act = async (fn, msg) => { setError(''); try { const r = await fn(); toast(typeof msg === 'function' ? msg(r) : msg); load(); } catch (e) { setError(e.message); } };
  const t = st?.totals;
  const rows = (st?.students || []).filter((s) => (show === 'all' || s.state === show) && (!q || `${s.name} ${s.adm} ${s.cls}`.toLowerCase().includes(q.toLowerCase())));
  return (
    <>
      <ErrorNote error={error} />
      {t && <div className="kpis"><Kpi label="Students with a number" value={t.students} /><Kpi tone="ok" label="Paid in full" value={t.paid} /><Kpi tone="warn" label="Part paid" value={t.part} /><Kpi label="Not paid" value={t.unpaid} />
        <Kpi label="Billed (TSh)" value={tsh(t.billed)} /><Kpi tone="ok" label="Received (TSh)" value={tsh(t.received)} /><Kpi tone={t.balance ? 'warn' : 'ok'} label="Balance (TSh)" value={tsh(t.balance)} /></div>}
      {t && (t.twoNumbers > 0 || t.unlinked > 0 || t.paymentsWithoutBill > 0 || t.overpaid > 0) && <div className="warnnote"><Icon name="alert" /><span>
        {t.twoNumbers > 0 && <>{t.twoNumbers} students have 2 control numbers (the newest is used). </>}
        {t.unlinked > 0 && <>{t.unlinked} B-SMART admission numbers do not match any student here. </>}
        {t.paymentsWithoutBill > 0 && <>{t.paymentsWithoutBill} payments have no fee line. </>}
        {t.overpaid > 0 && <>{t.overpaid} students paid more than billed.</>}</span></div>}
      {files && !files.canUpload && <p className="small muted">The school Bursar uploads the B-SMART reports. You approve them here and download the reports.</p>}
      {files?.canUpload && <Panel title="Upload a B-SMART report (Excel)">
        <p className="small muted">Order: 1) "Student details", 2) "Fee details" (control numbers), 3) "Payment" (money received, every Friday). The system knows which one it is. The head office must approve before it is saved. Uploading the same file again is safe.</p>
        <input type="file" accept=".xlsx" disabled={busy} onChange={(e) => { send(e.target.files[0]); e.target.value = ''; }} />
      </Panel>}
      {cmp && <CompareModal id={cmp} onClose={() => setCmp(null)} />}
      <Panel title="Uploads" flush>
        {!files ? <Loading /> : !files.files.length ? <Empty icon="upload" title="No B-SMART uploads yet">Upload the Fee details report first, then the Payment report.</Empty> : (
          <div className="tw"><table className="stafftable"><thead><tr><th className="stick">File</th><th>Report</th><th>Rows</th><th>Not matched</th><th>Status</th><th>By</th><th /></tr></thead>
            <tbody>{files.files.map((f) => (
              <tr key={f.id}><td className="stick">{f.fileName}<div className="small muted">{f.year}</div></td><td>{{ students: 'Student details', fees: 'Fee details', payments: 'Payments' }[f.kind]}</td>
                <td>{f.summary.rows}{f.summary.mistakes > 0 && <span className="small" style={{ color: 'var(--bad, #b00020)' }}> · {f.summary.mistakes} bad rows</span>}</td>
                <td>{f.summary.unmatched}</td><td><span className={`pill ${f.status === 'approved' ? 'ok' : f.status === 'pending' ? 'warn' : ''}`}>{f.status === 'pending' ? 'Waiting' : f.status}</span></td>
                <td className="small">{f.mine ? 'You' : f.by}</td>
                <td><div className="row" style={{ gap: 6 }}>
                  {f.kind === 'students' && f.status !== 'discarded' && <button className="btn sm" onClick={() => setCmp(f.id)}>Compare</button>}
                  {f.status === 'pending' && <>
                  {files.canApprove && !f.mine && <button className="btn sm p" onClick={() => act(() => api.post(`/bsmart/files/${f.id}/approve`), (r) => `Saved: ${r.added} new, ${r.same} already there${r.changed ? `, ${r.changed} amounts changed` : ''}`)}>Approve</button>}
                  {(f.mine || files.canApprove) && <button className="btn sm" onClick={() => act(() => api.post(`/bsmart/files/${f.id}/discard`), 'Discarded')}>Discard</button>}</>}</div></td></tr>
            ))}</tbody></table></div>)}
      </Panel>
      <div className="row" style={{ margin: '8px 0', gap: 8 }}>
        <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search name, admission no. or class" />
        <select value={show} onChange={(e) => setShow(e.target.value)} aria-label="Show"><option value="all">All</option><option value="unpaid">Not paid</option><option value="part">Part paid</option><option value="paid">Paid</option></select>
        <ExcelButton href={`/api/bsmart/status/export.xlsx?school=${school}&year=${year}`} />
      </div>
      <Panel flush>
        {!st ? <Loading /> : !st.students.length ? <Empty icon="receipt" title={`No control numbers for ${year}`}>Upload the Fee details report from B-SMART and have it approved.</Empty> : (
          <div className="tw"><table className="stafftable"><thead><tr><th className="stick">Student</th><th>Class</th><th>Control number</th><th>Billed</th><th>Paid</th><th>Balance</th><th>State</th><th>Last payment</th></tr></thead>
            <tbody>{rows.slice(0, 500).map((s) => (
              <tr key={s.numbers[s.numbers.length - 1]}><td className="stick"><b>{s.name}</b><div className="small muted">{s.adm}{!s.studentId && ' · not matched'}</div></td><td>{s.cls}</td>
                <td className="small">{s.numbers[s.numbers.length - 1]}{s.twoNumbers && <div className="muted">+{s.numbers.length - 1} old</div>}</td>
                <td>{tsh(s.billed)}</td><td>{tsh(s.paid)}</td><td><b>{tsh(s.balance)}</b></td><td><span className={`pill ${STATE[s.state][0]}`}>{STATE[s.state][1]}</span></td><td className="small">{s.last || ''}</td></tr>
            ))}</tbody></table>{rows.length > 500 && <p className="small muted" style={{ padding: 8 }}>Showing 500 of {rows.length}. Search or use Excel to see all.</p>}</div>)}
      </Panel>
    </>
  );
}

// Student details from B-SMART against our students. Nothing here is changed: it only shows what is different.
function CompareModal({ id, onClose }) {
  const [d, setD] = useState(null);
  const [error, setError] = useState('');
  useEffect(() => { api.get(`/bsmart/files/${id}/compare`).then(setD).catch((e) => setError(e.message)); }, [id]);
  return (
    <Modal title="B-SMART students and our students" onClose={onClose} wide>
      <ErrorNote error={error} />
      {!d ? <Loading /> : (
        <>
          <div className="kpis"><Kpi label="In B-SMART" value={d.total} /><Kpi tone="ok" label="Same" value={d.same} /><Kpi tone={d.differCount ? 'warn' : 'ok'} label="Different" value={d.differCount} />
            <Kpi tone={d.missingCount ? 'warn' : 'ok'} label="In B-SMART only" value={d.missingCount} /><Kpi tone={d.notInBsmartCount ? 'warn' : 'ok'} label="Here only" value={d.notInBsmartCount} /></div>
          {d.duplicateAdm > 0 && <div className="warnnote"><Icon name="alert" /><span>{d.duplicateAdm} admission numbers are used twice in this B-SMART file.</span></div>}
          <p className="small muted">B-SMART shows the class of the new year, so the same class or the next class here is counted as correct. Fix the students on the Students page, then open this again.</p>
          <ExcelButton href={`/api/bsmart/files/${id}/compare.xlsx`} label="Full list in Excel" />
          {d.differCount > 0 && <><h4>Different ({d.differCount})</h4><div className="tw"><table className="stafftable"><tbody>{d.differ.slice(0, 50).map((x) => (
            <tr key={x.adm}><td className="stick"><b>{x.name}</b><div className="small muted">{x.adm} · {x.cls}</div></td><td className="small">{x.why.join(' · ')}</td></tr>))}</tbody></table></div></>}
          {d.missingCount > 0 && <><h4>In B-SMART, not here ({d.missingCount})</h4><div className="tw"><table className="stafftable"><tbody>{d.missing.slice(0, 50).map((x) => (
            <tr key={x.adm}><td className="stick"><b>{x.name}</b></td><td className="small">{x.adm} · {x.cls}</td></tr>))}</tbody></table></div></>}
          {d.notInBsmartCount > 0 && <><h4>Here, not in B-SMART ({d.notInBsmartCount})</h4><div className="tw"><table className="stafftable"><tbody>{d.notInBsmart.slice(0, 50).map((x) => (
            <tr key={x.adm}><td className="stick"><b>{x.name}</b></td><td className="small">{x.adm} · {x.cls}</td></tr>))}</tbody></table></div></>}
        </>)}
    </Modal>
  );
}
