// Work agreements — "Makubaliano ya Malipo ya Kazi" (book No. 0201), as on the paper: Jina la mtoa kazi; Jina la mpewa kazi
// (kikundi) / jina la mkiti; Aina ya kazi; Eneo la kufanyia kazi; Kazi itaanza ... hadi ...; Kiasi Tsh (kwa maneno);
// Mchanganuo wa ulipwaji: Tarehe | Kiasi kwa maneno | Kiasi | Salio | Sahihi ya mlipwaji; Jumla; Imeandaliwa na | Imekaguliwa na.
// The Assistant Accountant enters it (signed on paper by the Director and the contractor) and each instalment; the Accountant checks.
import { useCallback, useEffect, useState } from 'react';
import { Link, Route, Routes, useNavigate, useParams } from 'react-router-dom';
import { api } from '../api';
import { useLive } from '../live';
import { useSchools } from '../layout/scope';
import { Empty, ErrorNote, ExcelButton, Icon, Kpi, Modal, PageHead, Panel, PhoneInput, fmtPhone, tsh, useToast } from '../components/ui';
import { todayStr } from '../components/common';
import { PrintButton } from '../components/barcode';
import { fmtDate } from '../components/paper';
import { inWords } from '../components/words';
import './requisition.css';

const TONE = { active: 'info', finished: 'ok', stopped: 'bad' };
const dmy = (d) => (d ? new Date(`${d}T12:00:00`).toLocaleDateString('en-GB') : '');

export default function Contracts() {
  return <Routes><Route index element={<ContractList />} /><Route path=":id" element={<ContractPage />} /></Routes>;
}

function ContractList() {
  const navigate = useNavigate();
  const [d, setD] = useState(null);
  const [error, setError] = useState('');
  const [status, setStatus] = useState('');
  const [adding, setAdding] = useState(false);
  const load = useCallback(() => api.get(`/contracts${status ? `?status=${status}` : ''}`).then((x) => { setD(x); setError(''); }).catch((e) => setError(e.message)), [status]);
  useEffect(() => { load(); }, [load]);
  useLive(['contract'], load);
  return (
    <>
      <PageHead title="Work agreements (Makubaliano)" sub="Work given to a fundi or a group, paid in instalments. Signed on paper by the Director and the contractor.">
        <ExcelButton href="/api/contracts/export.xlsx" />
        {d?.canWrite && <button className="btn p" onClick={() => setAdding(true)}><Icon name="plus" /> New agreement</button>}
      </PageHead>
      <ErrorNote error={error} />
      {d && <div className="kpis">
        <Kpi tone="hi" label="Agreed (all)" value={`TSh ${tsh(d.totals.amount)}`} />
        <Kpi label="Paid" value={`TSh ${tsh(d.totals.paid)}`} />
        <Kpi tone={d.totals.balance ? 'warn' : 'ok'} label="Still to pay (work going on)" value={`TSh ${tsh(d.totals.balance)}`} />
      </div>}
      <div className="filters"><div className="seg">{[['', 'All'], ['active', 'Work going on'], ['finished', 'Finished'], ['stopped', 'Stopped']].map(([k, t]) => <button key={k} className={status === k ? 'on' : ''} onClick={() => setStatus(k)}>{t}</button>)}</div></div>
      <Panel flush>
        {!d ? <Empty>Loading…</Empty> : !d.contracts.length ? <Empty>No agreements yet.</Empty> : (
          <div className="tw"><table className="stafftable">
            <thead><tr><th>No.</th><th className="stick">Mpewa kazi</th><th>Aina ya kazi</th><th>Eneo</th><th>Kuanzia – hadi</th><th className="n">Kiasi</th><th className="n">Kilicholipwa</th><th className="n">Salio</th><th>Hali</th></tr></thead>
            <tbody>{d.contracts.map((c) => (
              <tr key={c.id} className="clickrow" onClick={() => navigate(`/contracts/${c.id}`)}>
                <td className="mono small">{c.number}</td><td className="stick"><b>{c.contractor}</b>{c.chairman && <div className="small muted">Mkiti: {c.chairman}</div>}</td>
                <td className="small">{c.work}</td><td className="small">{c.place || c.school || ''}</td><td className="nowrap small">{dmy(c.startOn)} – {dmy(c.endOn)}</td>
                <td className="n">{tsh(c.amount)}</td><td className="n">{tsh(c.paid)}</td><td className="n"><b>{tsh(c.balance)}</b></td>
                <td><span className={`pill ${c.late ? 'bad' : TONE[c.status]}`}>{c.late ? 'Past the end date' : c.statusLabel}</span>{!c.checkedBy && <div className="small muted">not checked yet</div>}</td>
              </tr>
            ))}</tbody>
          </table></div>
        )}
      </Panel>
      {adding && <ContractForm onClose={() => setAdding(false)} onSaved={(c) => navigate(`/contracts/${c.id}`)} />}
    </>
  );
}

function ContractForm({ onClose, onSaved }) {
  const schools = useSchools();
  const [f, setF] = useState({ employer: 'MUSABE SCHOOLS', contractor: '', chairman: '', phone: '', work: '', place: '', schoolId: '', startOn: '', endOn: '', amount: '', signedOn: todayStr(), directorName: '' });
  const [file, setFile] = useState(null);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const set = (k, v) => setF((x) => ({ ...x, [k]: v }));
  const save = async (e) => {
    e.preventDefault(); setBusy(true); setError('');
    try {
      const d = await api.post('/contracts', { ...f, schoolId: Number(f.schoolId) || undefined });
      if (file) {
        const r = await fetch(`/api/contracts/${d.contract.id}/scan`, { method: 'POST', credentials: 'include', body: file });
        if (!r.ok) throw new Error(`${d.contract.number} saved, but the copy was not: ${(await r.json().catch(() => ({}))).error || 'upload failed'}`);
      }
      onSaved(d.contract);
    } catch (err) { setError(err.message); setBusy(false); }
  };
  return (
    <Modal wide title="New work agreement" onClose={onClose} footer={<><button className="btn" onClick={onClose}>Cancel</button><button className="btn p" form="mktform" disabled={busy}>{busy ? 'Saving…' : 'Save'}</button></>}>
      <form id="mktform" className="stack" onSubmit={save}>
        <div className="fg">
          <label>Jina la mtoa kazi<input value={f.employer} onChange={(e) => set('employer', e.target.value)} /></label>
          <label>Jina la mpewa kazi (kikundi)<input value={f.contractor} onChange={(e) => set('contractor', e.target.value)} required autoFocus /></label>
          <label>Jina la mkiti<input value={f.chairman} onChange={(e) => set('chairman', e.target.value)} /></label>
        </div>
        <label>Aina ya kazi<input value={f.work} onChange={(e) => set('work', e.target.value)} required placeholder="e.g. Kujenga uzio wa shule" /></label>
        <div className="fg">
          <label>Eneo la kufanyia kazi<input value={f.place} onChange={(e) => set('place', e.target.value)} /></label>
          <label>School<select value={f.schoolId} onChange={(e) => set('schoolId', e.target.value)}><option value="">Administration / none</option>{schools.map((s) => <option key={s.id} value={s.id}>{s.shortName}</option>)}</select></label>
          <label>Phone<PhoneInput value={f.phone} onChange={(v) => set('phone', v)} /></label>
        </div>
        <div className="fg">
          <label>Kazi itaanza<input type="date" value={f.startOn} onChange={(e) => set('startOn', e.target.value)} /></label>
          <label>Hadi<input type="date" value={f.endOn} min={f.startOn || undefined} onChange={(e) => set('endOn', e.target.value)} /></label>
          <label>Kiasi (TSh)<input inputMode="numeric" value={f.amount} onChange={(e) => set('amount', e.target.value.replace(/\D/g, ''))} required /></label>
        </div>
        {Number(f.amount) > 0 && <p className="small muted" style={{ margin: 0 }}>Kwa maneno: <b>{inWords(Number(f.amount))}</b></p>}
        <div className="fg">
          <label>Signed on paper on<input type="date" max={todayStr()} value={f.signedOn} onChange={(e) => set('signedOn', e.target.value)} /></label>
          <label>Director who signed<input value={f.directorName} onChange={(e) => set('directorName', e.target.value)} /></label>
        </div>
        <label className="filepick"><input type="file" accept="image/jpeg,image/png,application/pdf" onChange={(e) => setFile(e.target.files[0] || null)} /><Icon name="camera" /> {file ? file.name : 'Photo or PDF of the signed paper (up to 3 MB)'}</label>
        <ErrorNote error={error} />
      </form>
    </Modal>
  );
}

function Sheet({ c }) {
  return (
    <div className="rq-sheet">
      <div className="rq-top"><img src="/musabe-logo.png" alt="" /><div><h2 style={{ margin: 0 }}>MUSABE SCHOOLS</h2>
        <small>P.O. Box 5154, BUGANDO, MWANZA, TEL +255 754 654545, +255 782 110494, +255 754 610012, +255 769 197 221</small><small>musabeschools@yahoo.co.uk</small></div></div>
      <div className="rq-title">Makubaliano ya Malipo ya Kazi</div>
      <div className="rq-line"><span className="rq-no">No. <b style={{ color: '#c01818' }}>{c.number}</b></span></div>
      <div className="rq-line"><span className="rq-field"><span>Jina la mtoa kazi</span><b>{c.employer}</b></span></div>
      <div className="rq-line"><span className="rq-field"><span>Jina la mpewa kazi (kikundi)</span><b>{c.contractor}</b></span><span className="rq-field"><span>Jina la mkiti</span><b>{c.chairman || ''}</b></span></div>
      <div className="rq-line"><span className="rq-field"><span>Aina ya kazi</span><b>{c.work}</b></span></div>
      <div className="rq-line"><span className="rq-field"><span>Eneo la kufanyia kazi</span><b>{c.place || c.school || ''}</b></span></div>
      <div className="rq-line"><span className="rq-field"><span>Kazi itaanza kufanyika kuanzia</span><b>{dmy(c.startOn)}</b></span><span className="rq-field"><span>hadi</span><b>{dmy(c.endOn)}</b></span></div>
      <div className="rq-line"><span className="rq-field"><span>Kiasi cha fedha Tsh</span><b>{tsh(c.amount)}</b></span></div>
      <div className="rq-line"><span className="rq-field"><span>(Kwa maneno)</span><b>{inWords(c.amount)}</b></span></div>
      <div className="rq-sec">Mchanganuo wa ulipwaji</div>
      <div className="tw"><table className="rq-t">
        <thead><tr><th>Tarehe</th><th>Kiasi kilicholipwa kwa maneno</th><th className="n">Kiasi</th><th className="n">Salio la malipo</th><th>Sahihi ya mlipwaji</th></tr></thead>
        <tbody>{c.payments.map((p) => <tr key={p.id}><td className="nowrap">{dmy(p.day)}</td><td className="rq-small">{inWords(p.amount)}</td><td className="n">{tsh(p.amount)}</td><td className="n">{tsh(p.balance)}</td><td>{p.receivedBy}{p.ref ? <div className="rq-small">{p.ref}</div> : null}</td></tr>)}
          {c.payments.length < 6 && Array.from({ length: 6 - c.payments.length }, (_, i) => <tr key={`e${i}`}><td /><td /><td /><td /><td /></tr>)}</tbody>
        <tfoot><tr><td colSpan={2} className="r"><b>JUMLA</b></td><td className="n"><b>{tsh(c.paid)}</b></td><td className="n"><b>{tsh(c.balance)}</b></td><td /></tr></tfoot>
      </table></div>
      <div className="rq-signs">
        <div className="rq-sig"><div className="rq-sigline"><span className="rq-ink">{c.preparedBy}</span></div><b>Imeandaliwa na</b><span className="who">{c.preparedBy}</span><span className="dt">Date: {fmtDate(c.preparedAt)}</span></div>
        <div className="rq-sig"><div className="rq-sigline">{c.checkedBy && <span className="rq-ink">{c.checkedBy}</span>}</div><b>Imekaguliwa na</b><span className="who">{c.checkedBy || ''}</span><span className="dt">Date: {c.checkedAt ? fmtDate(c.checkedAt) : '......./......./20....'}</span></div>
        <div className="rq-sig"><div className="rq-sigline" /><b>Director</b><span className="who">{c.directorName || ''}</span><span className="dt">Signed on paper: {dmy(c.signedOn)}</span></div>
      </div>
    </div>
  );
}

function ContractPage() {
  const { id } = useParams();
  const toast = useToast();
  const [c, setC] = useState(null);
  const [error, setError] = useState('');
  const [pay, setPay] = useState({ amount: '', paidOn: todayStr(), receivedBy: '', ref: '' });
  const [note, setNote] = useState('');
  const load = useCallback(() => api.get(`/contracts/${id}`).then((x) => { setC(x.contract); setError(''); }).catch((e) => setError(e.message)), [id]);
  useEffect(() => { load(); }, [load]);
  useLive(['contract'], load);
  if (!c) return <div className="rq-wrap"><Link to="/contracts" className="btn sm">← All agreements</Link><ErrorNote error={error} />{!error && <Empty>Loading…</Empty>}</div>;
  const run = async (fn, msg) => { try { await fn(); toast(msg); await load(); } catch (e) { setError(e.message); } };
  return (
    <div className="rq-wrap">
      <div className="rq-bar"><Link to="/contracts" className="btn sm">← All agreements</Link><span className={`pill ${c.late ? 'bad' : TONE[c.status]}`}>{c.late ? 'Past the end date' : c.statusLabel}</span><span className="grow" />
        {c.hasScan && <a className="btn" href={`/api/contracts/${c.id}/scan`} target="_blank" rel="noreferrer"><Icon name="eye" /> Signed paper</a>}
        <PrintButton className="btn" label="Print"><Sheet c={c} /></PrintButton></div>
      {c.phone && <p className="rq-note info">Contractor phone: {fmtPhone(c.phone)}</p>}
      <Sheet c={c} />
      <div className="rq-actions">
        <ErrorNote error={error} />
        {c.canPay && (
          <div className="row" style={{ alignItems: 'end', gap: 10, flexWrap: 'wrap' }}>
            <label>Tarehe<input type="date" max={todayStr()} value={pay.paidOn} onChange={(e) => setPay((p) => ({ ...p, paidOn: e.target.value }))} /></label>
            <label>Kiasi (TSh, salio {tsh(c.balance)})<input inputMode="numeric" value={pay.amount} onChange={(e) => setPay((p) => ({ ...p, amount: e.target.value.replace(/\D/g, '') }))} /></label>
            <label>Aliyepokea (mlipwaji)<input value={pay.receivedBy} onChange={(e) => setPay((p) => ({ ...p, receivedBy: e.target.value }))} /></label>
            <label>Voucher no.<input value={pay.ref} onChange={(e) => setPay((p) => ({ ...p, ref: e.target.value }))} /></label>
            <button className="btn p" disabled={!pay.amount || pay.receivedBy.trim().length < 3} onClick={() => run(async () => { await api.post(`/contracts/${c.id}/payments`, { ...pay, amount: Number(pay.amount) }); setPay({ amount: '', paidOn: todayStr(), receivedBy: '', ref: '' }); }, 'Payment saved')}>Record payment</button>
          </div>
        )}
        <div className="row">
          {c.canCheck && <button className="btn p" onClick={() => run(() => api.post(`/contracts/${c.id}/check`, {}), 'Checked')}>I checked it (Imekaguliwa)</button>}
          {c.canEdit && c.status === 'active' && <><input value={note} placeholder="Reason (to stop)" onChange={(e) => setNote(e.target.value)} style={{ maxWidth: 260 }} />
            <button className="btn danger" disabled={note.trim().length < 5} onClick={() => run(() => api.patch(`/contracts/${c.id}`, { status: 'stopped', note }), 'Stopped')}>Stop the work</button></>}
        </div>
      </div>
    </div>
  );
}
