// GRN: Goods Received Note at the school (2026-11-24). Bursar checks, Head Master approves.
import { useCallback, useEffect, useState } from 'react';
import { api } from '../api';
import { useLive } from '../live';
import { Empty, ErrorNote, ExcelButton, Kpi, Loading, Modal, PageHead, Panel, Tabs, fmtWhen, useToast } from '../components/ui';

const TONE = { waiting: 'warn', checked: 'warn', approved: 'ok', sent_back: 'bad' };

export default function Grn() {
  const toast = useToast();
  const [tab, setTab] = useState('todo');
  const [d, setD] = useState(null);
  const [error, setError] = useState('');
  const [open, setOpen] = useState(null);
  const load = useCallback(() => api.get(`/grns${tab === 'todo' ? '?status=todo' : ''}`).then((x) => { setD(x); setError(''); }).catch((e) => setError(e.message)), [tab]);
  useEffect(() => { load(); }, [load]);
  useLive(['grn', 'stock'], load);
  return (
    <>
      <PageHead title="GRN: Goods Received Notes" sub="Made when a delivery is received at the school. The Bursar checks it, then the Head Master approves it.">
        <ExcelButton href="/api/grns/export.xlsx" />
      </PageHead>
      <ErrorNote error={error} />
      {d && <div className="kpis"><Kpi tone={d.todo ? 'warn' : 'ok'} label="Not approved yet" value={d.todo} /></div>}
      <Tabs tabs={[['todo', 'Not approved'], ['all', 'All GRNs']]} value={tab} onChange={setTab} />
      <Panel flush>
        {!d ? <Loading /> : !d.grns.length ? <Empty icon="file" title="No GRN here" steps={['A GRN is written when every line of a delivery is confirmed.', 'The Bursar checks it.', 'The Head Master approves it.']} /> : (
          <div className="tw"><table className="stafftable"><thead><tr><th className="stick">GRN</th><th>School</th><th>Delivery</th><th>Status</th><th>Written</th></tr></thead>
            <tbody>{d.grns.map((g) => (
              <tr key={g.id} onClick={() => setOpen(g.id)} style={{ cursor: 'pointer' }}>
                <td className="stick nowrap"><b className="mono">{g.number}</b><div className="small muted">{g.placeLabel}</div></td><td>{g.school}</td><td className="mono">{g.delivery}</td>
                <td><span className={`pill ${TONE[g.status]}`}>{g.statusLabel}</span></td><td className="small nowrap">{fmtWhen(g.preparedAt)}</td>
              </tr>
            ))}</tbody></table></div>
        )}
      </Panel>
      {open && <GrnModal id={open} onClose={() => setOpen(null)} onChanged={load} toast={toast} />}
    </>
  );
}

function GrnModal({ id, onClose, onChanged, toast }) {
  const [g, setG] = useState(null);
  const [error, setError] = useState('');
  const [reason, setReason] = useState('');
  const [busy, setBusy] = useState(false);
  useEffect(() => { api.get(`/grns/${id}`).then((x) => setG(x.grn)).catch((e) => setError(e.message)); }, [id]);
  const act = async (path, msg, body) => { setError(''); setBusy(true); try { const r = await api.post(`/grns/${id}/${path}`, body); setG(r.grn); toast(msg); onChanged(); } catch (e) { setError(e.message); } setBusy(false); };
  if (!g) return <Modal title="GRN" onClose={onClose}>{error ? <ErrorNote error={error} /> : <Loading />}</Modal>;
  return (
    <Modal wide title={`${g.number} · ${g.placeLabel}`} onClose={onClose} footer={<button className="btn" onClick={onClose}>Close</button>}>
      <p style={{ marginTop: 0 }}><span className={`pill ${TONE[g.status]}`}>{g.statusLabel}</span> <span className="small muted">Delivery {g.delivery} · {g.school}</span></p>
      <div className="tw"><table className="stafftable"><thead><tr><th>S/N</th><th>Item</th><th>Sent</th><th>Received</th><th>Note</th></tr></thead>
        <tbody>{g.lines.map((l, i) => <tr key={l.id}><td>{i + 1}</td><td><b>{l.name}</b></td><td>{l.sent} {l.unit}</td><td><b>{l.received}</b>{l.received < l.sent && <span className="pill warn sm">{l.sent - l.received} short</span>}</td><td className="small">{l.note || ''}</td></tr>)}</tbody></table></div>
      <p className="small muted">I confirm that all the goods are in good order and condition, except where written in the note.</p>
      <div className="row small" style={{ gap: 24 }}>
        <span>Prepared by: <b>{g.preparedBy || ''}</b></span><span>Checked by (Bursar): <b>{g.checkedBy || '—'}</b></span><span>Approved by (Head Master): <b>{g.approvedBy || '—'}</b></span>
      </div>
      {g.backReason && g.status === 'sent_back' && <p className="err">Sent back: {g.backReason}</p>}
      <div className="row" style={{ marginTop: 12, gap: 8, flexWrap: 'wrap' }}>
        {g.canCheck && <button className="btn p" disabled={busy} onClick={() => act('check', 'Checked')}>I checked it</button>}
        {g.canApprove && <button className="btn p" disabled={busy} onClick={() => act('approve', 'Approved')}>Approve</button>}
        {g.canResend && <button className="btn p" disabled={busy} onClick={() => act('resend', 'Sent again')}>Send again</button>}
      </div>
      {g.canBack && (
        <div className="fg" style={{ marginTop: 10 }}>
          <label>Send back to the keeper<input value={reason} onChange={(e) => setReason(e.target.value)} placeholder="Why?" /></label>
          <div style={{ alignSelf: 'end' }}><button className="btn" disabled={busy || reason.trim().length < 3} onClick={() => act('back', 'Sent back', { reason })}>Send back</button></div>
        </div>
      )}
      <ErrorNote error={error} />
    </Modal>
  );
}
