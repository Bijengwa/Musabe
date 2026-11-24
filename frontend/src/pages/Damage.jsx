// Damaged / lost items. The librarian reports; only the Finance Manager or the Accountant approves.
// Approved = taken out of stock. Rejected = nothing changes.
import { useCallback, useEffect, useState } from 'react';
import { api } from '../api';
import { useAuth } from '../auth/AuthContext';
import { useLive } from '../live';
import { Empty, ErrorNote, ExcelButton, Icon, Kpi, Modal, PageHead, Panel, SchoolPill, fmtWhen, useToast, Loading } from '../components/ui';
import { useSchoolItems, useSchoolQs } from '../components/common';

const TONE = { pending: 'warn', approved: 'ok', rejected: 'bad' };

export default function Damage() {
  const { user } = useAuth();
  const school = useSchoolQs();
  const [status, setStatus] = useState('');
  const [data, setData] = useState(null);
  const [error, setError] = useState('');
  const [reporting, setReporting] = useState(false);
  const [deciding, setDeciding] = useState(null);
  const qs = new URLSearchParams({ ...(school ? { school } : {}), ...(status ? { status } : {}) }).toString();
  const load = useCallback(() => api.get(`/damage?${qs}`).then((d) => { setData(d); setError(''); }).catch((e) => setError(e.message)), [qs]);
  useEffect(() => { load(); }, [load]);
  useLive(['damage'], load);
  const all = user.scope === 'all';
  return (
    <>
      <PageHead title="Damaged / lost" sub={data?.canReport ? 'Report items that are damaged or lost. The stock changes only after the Finance Manager or the Accountant approves.'
        : 'Reports from the libraries. Only the Finance Manager and the Accountant approve.'}>
        <ExcelButton href={`/api/reports/damage.xlsx?from=2020-01-01${school ? `&school=${school}` : ''}`} />
        {data?.canReport && <button className="btn p" onClick={() => setReporting(true)}><Icon name="alert" /> Report damaged / lost</button>}
      </PageHead>
      {data && <div className="kpis"><Kpi tone={data.pending ? 'warn' : 'ok'} label="Waiting for approval" value={data.pending} /><Kpi label="Approved this month (pieces)" value={data.approvedThisMonth} /></div>}
      <div className="filters"><div className="seg">{[['', 'All'], ['pending', 'Waiting'], ['approved', 'Approved'], ['rejected', 'Rejected']].map(([k, t]) =>
        <button key={k} className={status === k ? 'on' : ''} onClick={() => setStatus(k)}>{t}</button>)}</div></div>
      <ErrorNote error={error} />
      <Panel flush>
        {!data ? <Loading /> : !data.damages.length ? <Empty>Nothing here.</Empty> : (
          <div className="list">{data.damages.map((d) => (
            <div key={d.id} className="li">
              <div className="grow">
                <b><span className="mono">{d.number}</span> · {d.qty} × {d.item} <span className={`pill ${d.kind === 'lost' ? 'bad' : 'warn'}`}>{d.kindLabel}</span></b>
                <span>{d.reason} · {d.reportedBy}, {fmtWhen(d.reportedAt)}</span>
                {d.decidedBy && <span className="block">{d.statusLabel} by {d.decidedBy} · {fmtWhen(d.decidedAt)}{d.decisionNote ? ` · ${d.decisionNote}` : ''}</span>}
              </div>
              {all && <SchoolPill code={d.code} name={d.school} />}
              <span className={`pill ${TONE[d.status]}`}>{d.statusLabel}</span>
              {d.canDecide && <button className="btn sm p" onClick={() => setDeciding(d)}>Decide</button>}
            </div>
          ))}</div>
        )}
      </Panel>
      {reporting && <Report onClose={() => setReporting(false)} />}
      {deciding && <Decide d={deciding} onClose={() => setDeciding(null)} />}
    </>
  );
}

function Report({ onClose }) {
  const { user } = useAuth();
  const toast = useToast();
  const items = useSchoolItems(user.school?.id);
  const [f, setF] = useState({ itemId: '', qty: '1', kind: 'damaged', reason: '' });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const set = (k, v) => setF((x) => ({ ...x, [k]: v }));
  const save = async () => {
    setBusy(true); setError('');
    try {
      const d = await api.post('/damage', { ...f, itemId: Number(f.itemId), qty: Number(f.qty) });
      toast(`${d.damage.number} reported. Waiting for approval.`); onClose();
    } catch (e) { setError(e.message); setBusy(false); }
  };
  return (
    <Modal title="Report damaged or lost items" onClose={onClose}
      footer={<><button className="btn" onClick={onClose}>Cancel</button><button className="btn p" disabled={busy || !f.itemId || !Number(f.qty) || f.reason.trim().length < 5} onClick={save}>{busy ? 'Sending…' : 'Report'}</button></>}>
      <div className="stack">
        <div className="seg">{[['damaged', 'Damaged'], ['lost', 'Lost']].map(([k, t]) => <button key={k} type="button" className={f.kind === k ? 'on' : ''} onClick={() => set('kind', k)}>{t}</button>)}</div>
        <div className="fg">
          <label>Item<select value={f.itemId} onChange={(e) => set('itemId', e.target.value)}>
            <option value="">Choose…</option>{(items || []).map((i) => <option key={i.id} value={i.id}>{i.name}</option>)}
          </select></label>
          <label>How many<input inputMode="numeric" value={f.qty} onChange={(e) => set('qty', e.target.value.replace(/\D/g, ''))} /></label>
        </div>
        <label>What happened<textarea rows={3} value={f.reason} onChange={(e) => set('reason', e.target.value)} placeholder="e.g. torn by rats in the store; missing at the stock count on 14 Nov" /></label>
        <ErrorNote error={error} />
      </div>
    </Modal>
  );
}

function Decide({ d, onClose }) {
  const toast = useToast();
  const [note, setNote] = useState('');
  const [error, setError] = useState('');
  const go = async (approve) => {
    try { await api.post(`/damage/${d.id}/decide`, { approve, note }); toast(`${d.number} ${approve ? 'approved: taken out of stock' : 'rejected'}`); onClose(); } catch (e) { setError(e.message); }
  };
  return (
    <Modal title={`${d.number} · ${d.qty} × ${d.item}`} onClose={onClose}
      footer={<><button className="btn" onClick={onClose}>Close</button><button className="btn danger" disabled={note.trim().length < 3} onClick={() => go(false)}>Reject</button>
        <button className="btn p" onClick={() => go(true)}>Approve · take {d.qty} out of stock</button></>}>
      <div className="stack">
        <div className="kvgrid"><span>School</span><b>{d.school}</b><span>{d.kindLabel}</span><b>{d.qty} × {d.item}</b><span>Reason</span><b>{d.reason}</b><span>Reported</span><b>{d.reportedBy} · {fmtWhen(d.reportedAt)}</b></div>
        <label>Note<input value={note} onChange={(e) => setNote(e.target.value)} placeholder="Needed to reject; optional to approve" /></label>
        <ErrorNote error={error} />
      </div>
    </Modal>
  );
}
