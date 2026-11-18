/* eslint-disable react-refresh/only-export-components */
// Send stock: the finance office (Finance Manager, Assistant FM, Accountant) sends items to a library.
// Stock goes up only when the librarian confirms each line on "Incoming stock".
// Opened from a stock request (?request=ID), the form is filled from the request.
import { useCallback, useEffect, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { api } from '../api';
import { useLive } from '../live';
import { useSchools } from '../layout/scope';
import { Empty, ErrorNote, Icon, Modal, PageHead, Panel, SchoolPill, fmtWhen, tsh, useToast } from '../components/ui';
import { LinesEditor, useSchoolItems, useSchoolQs } from '../components/common';
import { DeliveryLabelsButton, PrintButton } from '../components/barcode';
import { Paper, fmtDate } from '../components/paper';

export default function SendStock() {
  const [params] = useSearchParams();
  const fromRequest = params.get('request');
  // A new request opens a fresh form on the "Send stock" tab.
  return <SendStockPage key={fromRequest || 'new'} fromRequest={fromRequest} />;
}

function SendStockPage({ fromRequest }) {
  const [tab, setTab] = useState('send');
  return (
    <>
      <PageHead title="Send stock" sub="Send items to a school's library. The librarian confirms what arrives, line by line; only then does the stock go up." />
      <div className="seg">{[['send', 'Send stock'], ['sent', 'Sent deliveries']].map(([k, t]) => <button key={k} className={tab === k ? 'on' : ''} onClick={() => setTab(k)}>{t}</button>)}</div>
      {tab === 'send' ? <SendForm requestId={fromRequest} onSent={() => setTab('sent')} /> : <Sent />}
    </>
  );
}

function SendForm({ requestId, onSent }) {
  const toast = useToast();
  const schools = useSchools().filter((s) => s.active !== false);
  const scope = useSchoolQs();
  const [schoolId, setSchoolId] = useState(scope || '');
  const [lines, setLines] = useState([]);
  const [note, setNote] = useState('');
  const [request, setRequest] = useState(null);
  const [error, setError] = useState('');
  const [mistakes, setMistakes] = useState([]);
  const [confirm, setConfirm] = useState(false);
  const [busy, setBusy] = useState(false);
  const sold = useSchoolItems(Number(schoolId) || null);
  // Things the schools use and do not sell (text books, reams, food) need no price: they can go to any school.
  const [used, setUsed] = useState(null);
  useEffect(() => { api.get('/store/items').then((d) => setUsed(d.items.filter((i) => !i.sellable).map((i) => ({ id: i.id, name: i.name })))).catch(() => setUsed([])); }, []);
  const items = sold && used ? [...sold, ...used] : null;

  // From a stock request: same school and items.
  useEffect(() => {
    if (!requestId) return;
    api.get(`/requests/${requestId}`).then((d) => {
      const r = d.request;
      setRequest(r);
      setSchoolId(String(r.schoolId));
      setLines(r.lines.map((l) => ({ itemId: l.itemId, name: l.name, qty: l.qty, asked: l.qty, inStock: l.inStock })));
      setNote(`For ${r.number}`);
    }).catch((e) => setError(e.message));
  }, [requestId]);

  const changeSchool = (v) => { setSchoolId(v); if (!request) setLines([]); setMistakes([]); };
  const upload = async (file) => {
    setError(''); setMistakes([]);
    try {
      const r = await fetch('/api/stock/deliveries/read', { method: 'POST', credentials: 'include', body: file });
      const d = await r.json();
      if (!r.ok) throw new Error(d.error || 'Could not read the file.');
      const here = new Set((items || []).map((i) => i.id));
      const notHere = d.lines.filter((l) => !here.has(l.itemId));
      setLines(d.lines.filter((l) => here.has(l.itemId)));
      setMistakes([...d.mistakes, ...notHere.map((l) => `${l.name} is not sold in this school (skipped).`)]);
      toast(`${d.lines.length - notHere.length} item${d.lines.length - notHere.length === 1 ? '' : 's'} read from the file. Check them below.`);
    } catch (e) { setError(e.message); }
  };

  const ok = lines.filter((l) => l.qty > 0);
  const school = schools.find((s) => String(s.id) === String(schoolId));
  const send = async () => {
    setBusy(true); setError('');
    try {
      const d = await api.post('/stock/deliveries', { schoolId: Number(schoolId), requestId: request?.id, note, lines: ok.map((l) => ({ itemId: l.itemId, qty: l.qty })) });
      toast(`${d.delivery.number} sent to ${d.delivery.school}. Waiting for the librarian to confirm.`);
      setLines([]); setNote(''); setRequest(null); setConfirm(false); setBusy(false);
      onSent();
    } catch (e) { setError(e.message); setBusy(false); setConfirm(false); }
  };

  return (
    <div className="stack">
      {request && <div className="okmsg"><Icon name="inbox" /> Answering <b>{request.number}</b> from {request.school} ({request.requestedBy}{request.note ? `: ${request.note}` : ''}). Change the quantities if you send less.</div>}
      <Panel title="1. School">
        <div className="fg">
          <label>Send to<select value={schoolId} onChange={(e) => changeSchool(e.target.value)} disabled={!!request}>
            <option value="">Choose the school…</option>
            {schools.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
          </select></label>
          <label>Note<input value={note} onChange={(e) => setNote(e.target.value)} placeholder="Optional, e.g. Opening stock, Term 1" /></label>
        </div>
      </Panel>
      <Panel title="2. Items and quantities" right={schoolId ? (
        <div className="row">
          <a className="btn sm xl" href={`/api/stock/deliveries/template.xlsx?school=${schoolId}`} download><Icon name="excel" /> Template</a>
          <label className="btn sm filepick"><Icon name="upload" /> Upload Excel<input type="file" accept=".xlsx" hidden onChange={(e) => { const f = e.target.files[0]; e.target.value = ''; if (f) upload(f); }} /></label>
        </div>) : null}>
        {!schoolId ? <Empty>Choose the school first.</Empty> : (
          <LinesEditor items={items} lines={lines} setLines={setLines}
            extra={request ? { header: 'Asked / in stock', cell: (l) => (l.asked ? `${l.asked} / ${l.inStock ?? 0}` : '—') } : null} />
        )}
        {mistakes.length > 0 && <div className="warnnote" style={{ marginTop: 10 }}><Icon name="alert" /><span>{mistakes.join(' ')}</span></div>}
      </Panel>
      <ErrorNote error={error} />
      <div className="row" style={{ justifyContent: 'flex-end' }}>
        <button className="btn p big" disabled={!schoolId || !ok.length} onClick={() => setConfirm(true)}><Icon name="up" /> Check and send</button>
      </div>
      {confirm && (
        <Modal title="Check before sending" onClose={() => !busy && setConfirm(false)}
          footer={<><button className="btn" onClick={() => setConfirm(false)} disabled={busy}>Go back</button><button className="btn p" onClick={send} disabled={busy} autoFocus>{busy ? 'Sending…' : 'Send'}</button></>}>
          <p style={{ marginTop: 0 }}>To <b>{school?.name}</b>{note ? ` · ${note}` : ''}</p>
          <div className="tw"><table className="lines">
            <thead><tr><th>Item</th><th className="n">Quantity</th></tr></thead>
            <tbody>{ok.map((l) => <tr key={l.itemId}><td>{l.name}</td><td className="n">{tsh(l.qty)}</td></tr>)}</tbody>
            <tfoot><tr><td>Total</td><td className="n">{tsh(ok.reduce((s, l) => s + l.qty, 0))}</td></tr></tfoot>
          </table></div>
          <p className="small muted">The librarian will confirm each line. If less arrives, they write what is missing and you are told.</p>
        </Modal>
      )}
    </div>
  );
}

const TONE = { sent: 'warn', received: 'ok', cancelled: '' };
// The delivery note both sides sign: the store-keeper (or finance office) who sent it, and the librarian who counted it.
export function deliveryPaper(d) {
  const by = d.lines.find((l) => l.confirmedBy);
  return (
    <Paper title="DELIVERY NOTE" number={d.number} school={d.schoolName || d.school}
      meta={[['To', `${d.schoolName || d.school} library`], ['From', d.fromMain ? 'Store-keeper (office)' : 'Finance office'], ['Sent on', fmtDate(d.sentAt)], ['For', d.requisitionNumber || d.requestNumber], ['Status', d.statusLabel], ['Note', d.note]]}
      columns={[{ key: 'item', label: 'Item' }, { key: 'qty', label: 'Sent', n: true }, { key: 'got', label: 'Received', n: true }, { key: 'note', label: 'Note' }]}
      rows={d.lines.map((l) => ({ item: l.name, qty: l.qty, got: l.received ?? '', note: l.note || '' }))}
      signs={[{ role: `Sent by (${d.sentByRole || 'store'})`, name: d.sentBy, at: d.sentAt }, { role: 'Received and checked by (librarian)', name: by?.confirmedBy, at: d.receivedAt || by?.confirmedAt }]}
      foot="Two copies: one stays in the library, one goes back to the office." />
  );
}

export function DeliveryList({ data, canCancel, onCancel, children, openAll }) {
  const [open, setOpen] = useState(null);
  if (!data) return <Empty>Loading…</Empty>;
  if (!data.deliveries.length) return <Empty>No deliveries yet.</Empty>;
  return (
    <div className="list">
      {data.deliveries.map((d) => (
        <div key={d.id} className="dlv">
          <button className="li libtn" onClick={() => setOpen(open === d.id ? null : d.id)} aria-expanded={openAll || open === d.id}>
            <div className="grow">
              <b><span className="mono">{d.number}</span> · {d.lines.length} item{d.lines.length === 1 ? '' : 's'}, {tsh(d.units)} pieces{d.requestNumber ? ` · for ${d.requestNumber}` : ''}{d.requisitionNumber ? ` · for ${d.requisitionNumber}` : ''}</b>
              <span>Sent {fmtWhen(d.sentAt)} by {d.sentBy}{d.note ? ` · ${d.note}` : ''}{d.receivedAt ? ` · received ${fmtWhen(d.receivedAt)}` : ''}</span>
            </div>
            <SchoolPill code={d.code} name={d.school} />
            {d.short > 0 && <span className="pill bad">{d.short} short</span>}
            <span className={`pill ${TONE[d.status]}`}>{d.status === 'sent' && d.waiting < d.lines.length ? 'Part confirmed' : d.statusLabel}</span>
          </button>
          {(openAll || open === d.id) && (
            <div className="pad">
              {children ? children(d) : (
                <div className="tw"><table className="lines">
                  <thead><tr><th>Item</th><th className="n">Sent</th><th className="n">Received</th><th>Note</th><th>Confirmed by</th></tr></thead>
                  <tbody>{d.lines.map((l) => (
                    <tr key={l.id}><td>{l.name}</td><td className="n">{l.qty}</td>
                      <td className="n">{l.received == null ? <span className="pill warn">waiting</span> : l.short ? <span className="pill bad">{l.received}</span> : l.received}</td>
                      <td className="small">{l.note}</td><td className="small">{l.confirmedBy ? `${l.confirmedBy} · ${fmtWhen(l.confirmedAt)}` : ''}</td></tr>
                  ))}</tbody>
                </table></div>
              )}
              <div className="row" style={{ justifyContent: 'flex-end', marginTop: 8 }}>
                <PrintButton className="btn sm" label="Print delivery note">{deliveryPaper(d)}</PrintButton>
                <DeliveryLabelsButton id={d.id} />
                {canCancel && d.status === 'sent' && d.waiting === d.lines.length && <button className="btn sm danger" onClick={() => onCancel(d)}>Cancel this delivery</button>}
              </div>
            </div>
          )}
        </div>
      ))}
    </div>
  );
}

function Sent() {
  const toast = useToast();
  const school = useSchoolQs();
  const [status, setStatus] = useState('');
  const [data, setData] = useState(null);
  const [error, setError] = useState('');
  const qs = new URLSearchParams({ ...(school ? { school } : {}), ...(status ? { status } : {}) }).toString();
  const load = useCallback(() => api.get(`/stock/deliveries?${qs}`).then((d) => { setData(d); setError(''); }).catch((e) => setError(e.message)), [qs]);
  useEffect(() => { load(); }, [load]);
  useLive(['delivery'], load);
  const cancel = async (d) => {
    try { await api.post(`/stock/deliveries/${d.id}/cancel`, {}); toast(`${d.number} cancelled`); } catch (e) { toast(e.message); }
  };
  return (
    <>
      <div className="filters"><div className="seg">{[['', 'All'], ['sent', 'On the way'], ['received', 'Received'], ['cancelled', 'Cancelled']].map(([k, t]) =>
        <button key={k} className={status === k ? 'on' : ''} onClick={() => setStatus(k)}>{t}</button>)}</div></div>
      <ErrorNote error={error} />
      <Panel flush><DeliveryList data={data} canCancel={data?.canSend} onCancel={cancel} /></Panel>
    </>
  );
}
