// Stock requests. The librarian asks; the finance office sends the stock (opens "Send stock" filled in) or declines.
import { useCallback, useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { api } from '../api';
import { useAuth } from '../auth/AuthContext';
import { useLive } from '../live';
import { Empty, ErrorNote, Icon, Modal, PageHead, Panel, SchoolPill, fmtWhen, tsh, useToast } from '../components/ui';
import { LinesEditor, useSchoolItems, useSchoolQs } from '../components/common';

const TONE = { pending: 'warn', sent: 'ok', declined: 'bad', withdrawn: '' };

export default function Requests() {
  const { user } = useAuth();
  const toast = useToast();
  const nav = useNavigate();
  const school = useSchoolQs();
  const [status, setStatus] = useState('');
  const [data, setData] = useState(null);
  const [error, setError] = useState('');
  const [asking, setAsking] = useState(false);
  const [declining, setDeclining] = useState(null);
  const qs = new URLSearchParams({ ...(school ? { school } : {}), ...(status ? { status } : {}) }).toString();
  const load = useCallback(() => api.get(`/requests?${qs}`).then((d) => { setData(d); setError(''); }).catch((e) => setError(e.message)), [qs]);
  useEffect(() => { load(); }, [load]);
  useLive(['request', 'delivery'], load);
  const withdraw = async (r) => {
    try { await api.post(`/requests/${r.id}/withdraw`, {}); toast(`${r.number} withdrawn`); } catch (e) { toast(e.message); }
  };
  const all = user.scope === 'all';
  return (
    <>
      <PageHead title="Stock requests" sub={data?.canAsk ? `${user.school?.name} · Ask the finance office for the items your library needs.` : 'What the libraries ask for. Send the stock, or decline with a reason.'}>
        {data?.canAsk && <button className="btn p" onClick={() => setAsking(true)}><Icon name="plus" /> New request</button>}
      </PageHead>
      <div className="filters"><div className="seg">{[['', 'All'], ['pending', `Waiting${data ? ` (${data.pending})` : ''}`], ['sent', 'Sent'], ['declined', 'Declined']].map(([k, t]) =>
        <button key={k} className={status === k ? 'on' : ''} onClick={() => setStatus(k)}>{t}</button>)}</div></div>
      <ErrorNote error={error} />
      <Panel flush>
        {!data ? <Empty>Loading…</Empty> : !data.requests.length ? <Empty>{status === 'pending' ? 'No requests waiting.' : 'No requests.'}</Empty> : (
          <div className="list">{data.requests.map((r) => (
            <div key={r.id} className="li reqli">
              <div className="grow">
                <b><span className="mono">{r.number}</span> · {r.lines.map((l) => `${l.qty} × ${l.name}`).join(', ')}</b>
                <span>{r.requestedBy} · {fmtWhen(r.requestedAt)}{r.note ? ` · “${r.note}”` : ''}</span>
                {r.answeredBy && <span className="block">{r.statusLabel} by {r.answeredBy} · {fmtWhen(r.answeredAt)}{r.answerNote ? ` · ${r.answerNote}` : ''}</span>}
                {r.lines.some((l) => l.inStock !== undefined) && r.status === 'pending' && (
                  <span className="block">In the library now: {r.lines.map((l) => `${l.name} ${l.inStock}`).join(', ')}</span>
                )}
              </div>
              {all && <SchoolPill code={r.code} name={r.school} />}
              <span className={`pill ${TONE[r.status]}`}>{r.statusLabel}</span>
              {r.status === 'pending' && data.canAnswer && <>
                <button className="btn sm p" onClick={() => nav(`/stock-in?request=${r.id}`)}><Icon name="up" /> Send</button>
                <button className="btn sm" onClick={() => setDeclining(r)}>Decline</button>
              </>}
              {r.status === 'pending' && r.mine && <button className="btn sm" onClick={() => withdraw(r)}>Withdraw</button>}
            </div>
          ))}</div>
        )}
      </Panel>
      {asking && <Ask onClose={() => setAsking(false)} />}
      {declining && <Decline r={declining} onClose={() => setDeclining(null)} />}
    </>
  );
}

function Ask({ onClose }) {
  const { user } = useAuth();
  const toast = useToast();
  const items = useSchoolItems(user.school?.id);
  const [lines, setLines] = useState([]);
  const [note, setNote] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const ok = lines.filter((l) => l.qty > 0);
  const save = async () => {
    setBusy(true); setError('');
    try {
      const d = await api.post('/requests', { note, lines: ok.map((l) => ({ itemId: l.itemId, qty: l.qty })) });
      toast(`${d.request.number} sent to the finance office`); onClose();
    } catch (e) { setError(e.message); setBusy(false); }
  };
  return (
    <Modal wide title="New stock request" onClose={onClose}
      footer={<><button className="btn" onClick={onClose}>Cancel</button><button className="btn p" disabled={!ok.length || busy} onClick={save}>{busy ? 'Sending…' : `Send request (${tsh(ok.reduce((s, l) => s + l.qty, 0))} pieces)`}</button></>}>
      <div className="stack">
        <LinesEditor items={items} lines={lines} setLines={setLines} />
        <label>Note<input value={note} onChange={(e) => setNote(e.target.value)} placeholder="Optional, e.g. for Form One joining, sizes 30-34" /></label>
        <ErrorNote error={error} />
      </div>
    </Modal>
  );
}

function Decline({ r, onClose }) {
  const toast = useToast();
  const [reason, setReason] = useState('');
  const [error, setError] = useState('');
  const go = async () => {
    try { await api.post(`/requests/${r.id}/decline`, { reason }); toast(`${r.number} declined`); onClose(); } catch (e) { setError(e.message); }
  };
  return (
    <Modal title={`Decline ${r.number}`} onClose={onClose} footer={<><button className="btn" onClick={onClose}>Cancel</button><button className="btn danger-bg" disabled={reason.trim().length < 3} onClick={go}>Decline</button></>}>
      <label>Why? The librarian sees this.<input value={reason} onChange={(e) => setReason(e.target.value)} autoFocus placeholder="e.g. no stock at the store until March" /></label>
      <ErrorNote error={error} />
    </Modal>
  );
}
