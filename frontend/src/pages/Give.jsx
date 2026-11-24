// Give items: the student brings the bursar's receipt; the librarian scans the student's ID card (or types the receipt
// number), then scans the QR on each thing while handing it over. Items can be given in parts (e.g. a size is not in
// the store today); the rest stays on the receipt. Nothing that is not in the library's stock can be given.
// The parents' app is told what the child collected.
import { useCallback, useEffect, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { api } from '../api';
import { useAuth } from '../auth/AuthContext';
import { useLive } from '../live';
import { Empty, ErrorNote, Icon, Modal, PageHead, Panel, fmtWhen, tsh, useToast, Loading } from '../components/ui';
import { ReceiptDetails, ReceiptModal, StatusPill, waited } from '../components/receipt';
import { ScanBox } from '../components/scan';

export default function Give() {
  const { user } = useAuth();
  const [tab, setTab] = useState('open');
  const [params] = useSearchParams();
  const [q, setQ] = useState(() => params.get('q') || ''); // from the home page: Give on one receipt
  const [data, setData] = useState(null);
  const [error, setError] = useState('');
  const [giving, setGiving] = useState(null); // receipt id
  const [view, setView] = useState(null);
  const [who, setWho] = useState(null);       // the student whose ID card was scanned
  const [scanError, setScanError] = useState('');

  // A scanned ID card shows that student's receipts; a scanned receipt number opens it.
  const onScan = async (code) => {
    setScanError('');
    if (/^(rec\.?\s*)?\d{1,9}$/i.test(code)) { setWho(null); setQ(code); return; }
    try {
      const { found } = await api.get(`/store/scan?code=${encodeURIComponent(code)}`);
      if (found.type !== 'student') return setScanError('Scan the student\'s ID card (or the receipt number). Item QR codes are scanned after you open the receipt.');
      setQ(''); setWho(found);
    } catch (e) { setScanError(e.message); }
  };

  const today = new Date().toLocaleDateString('en-CA');
  const load = useCallback(() => {
    const p = new URLSearchParams();
    if (who) { p.set('student', who.id); p.set('status', 'open'); }
    else if (q.trim()) p.set('q', q.trim()); // search looks at every receipt of the school
    else if (tab === 'open') p.set('status', 'open');
    else { p.set('status', 'given'); p.set('from', today); p.set('to', today); }
    return api.get(`/receipts?${p}`).then((d) => { setData(d); setError(''); }).catch((e) => setError(e.message));
  }, [q, tab, today, who]);
  useEffect(() => { const t = setTimeout(load, q ? 250 : 0); return () => clearTimeout(t); }, [load, q]);
  useLive(['receipt', 'give'], load);

  // Not given yet: oldest first, so nobody waits too long.
  const rows = data ? (tab === 'open' && !q.trim() ? [...data.receipts].reverse() : data.receipts) : null;

  return (
    <>
      <PageHead title="Give items" sub={`${user.school?.name} · Give items only against a bursar's receipt. Check the number on the paper matches.`} />
      <ScanBox onScan={onScan} placeholder="Scan the student's ID card (or the receipt number)" />
      <ErrorNote error={scanError} />
      {who && (
        <div className="personcard boxed">
          <span className="pill info">Student</span>
          <div className="grow"><b>{who.name}</b><span>{[who.detail, who.admissionNo && `Adm. ${who.admissionNo}`, who.code].filter(Boolean).join(' · ')}</span></div>
          {who.card === null && <span className="pill warn">ID card not issued</span>}
          <button className="iconbtn" onClick={() => setWho(null)} aria-label="Clear"><Icon name="x" /></button>
        </div>
      )}
      <div className="givesearch">
        <Icon name="search" />
        <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Type the receipt number (e.g. 125) or the student's name" autoFocus inputMode="search" />
        {q && <button className="iconbtn" onClick={() => setQ('')} aria-label="Clear"><Icon name="x" /></button>}
      </div>
      {!q.trim() && (
        <div className="filters">
          <div className="seg">
            <button className={tab === 'open' ? 'on' : ''} onClick={() => setTab('open')}>Waiting{data && tab === 'open' ? ` (${data.open.count})` : ''}</button>
            <button className={tab === 'done' ? 'on' : ''} onClick={() => setTab('done')}>Given today</button>
          </div>
          {data?.open.late > 0 && <span className="pill bad"><Icon name="clock" /> {data.open.late} waiting more than {data.lateHours} hours</span>}
        </div>
      )}
      <ErrorNote error={error} />
      <Panel flush>
        {!rows ? <Loading /> : !rows.length ? <Empty>{who ? `${who.name} has nothing waiting to collect.` : q.trim() ? 'No receipt found. Check the number with the bursar.' : tab === 'open' ? 'Nothing waiting. Every paid receipt has been given.' : 'Nothing given yet today.'}</Empty> : (
          <div className="list">
            {rows.map((r) => (
              <div key={r.id} className={`li${r.late ? ' lateli' : ''}`}>
                <div className="grow">
                  <b><span className="rnum sm">{r.number}</span> · {r.studentName}</b>
                  <span>{r.studentClass} · TSh {tsh(r.total)} · paid {fmtWhen(r.soldAt)}{r.status !== 'given' ? ` · waiting ${waited(r.waitingHours)}` : ''}</span>
                </div>
                <StatusPill r={r} />
                {r.status === 'given'
                  ? <button className="btn sm" onClick={() => setView(r.id)}>View</button>
                  : <button className="btn p" onClick={() => setGiving(r.id)}><Icon name="hand" /> Give</button>}
              </div>
            ))}
          </div>
        )}
      </Panel>
      {giving && <GiveForm id={giving} onClose={() => setGiving(null)} />}
      {view && <ReceiptModal id={view} onClose={() => setView(null)} />}
    </>
  );
}

function GiveForm({ id, onClose }) {
  const toast = useToast();
  const [r, setR] = useState(null);
  const [qty, setQty] = useState({});     // lineId -> number to give now
  const [collectedBy, setCollectedBy] = useState('');
  const [note, setNote] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [scanned, setScanned] = useState(false); // after the first scan only scanned things are given

  // Scan the QR on each thing as it is handed over.
  const onScanItem = async (code) => {
    setError('');
    try {
      const { found } = await api.get(`/store/scan?code=${encodeURIComponent(code)}`);
      const itemId = found.type === 'copy' ? found.itemId : found.type === 'item' ? found.id : null;
      if (!itemId) return setError('Scan the QR code on the thing you are giving.');
      const line = r.lines.find((l) => l.itemId === itemId && l.left > 0);
      if (!line) return setError(`${found.name || found.item} is not on this receipt (or is already given).`);
      setQty((x) => {
        const base = scanned ? x : Object.fromEntries(r.lines.map((l) => [l.id, 0]));
        if (base[line.id] >= line.left) { setError(`${line.name}: all ${line.left} already scanned.`); return base; }
        return { ...base, [line.id]: base[line.id] + 1 };
      });
      setScanned(true);
    } catch (e) { setError(e.message); }
  };

  useEffect(() => {
    api.get(`/receipts/${id}`).then((d) => {
      setR(d.receipt);
      setQty(Object.fromEntries(d.receipt.lines.map((l) => [l.id, l.left]))); // all that is left, by default
      setCollectedBy(d.receipt.payerName || '');
    }).catch((e) => setError(e.message));
  }, [id]);

  const count = Object.values(qty).reduce((s, n) => s + n, 0);
  const all = r && r.lines.every((l) => qty[l.id] === l.left);
  const give = async () => {
    setBusy(true); setError('');
    try {
      const d = await api.post(`/receipts/${id}/give`, { lines: Object.entries(qty).map(([lineId, n]) => ({ lineId: Number(lineId), qty: n })), collectedBy, note });
      toast(d.status === 'given' ? `${d.receipt.number}: all items given` : `${d.receipt.number}: part given, ${d.left} still to give`);
      onClose();
    } catch (e) { setError(e.message); setBusy(false); }
  };

  return (
    <Modal wide title={r ? `Give items · ${r.number}` : 'Give items'} onClose={onClose}
      footer={<><button className="btn" onClick={onClose}>Cancel</button>
        <button className="btn p" disabled={!r || busy || !count} onClick={give}>{busy ? 'Saving…' : all ? `Give all (${count})` : `Give ${count} item${count === 1 ? '' : 's'}`}</button></>}>
      <ErrorNote error={error} />
      {!r ? <Loading /> : (
        <div className="stack">
          <div className="row" style={{ justifyContent: 'space-between' }}>
            <div><b>{r.studentName}</b> <span className="muted">· {r.studentClass}{r.gender ? ` · ${r.gender === 'boy' ? 'Boy' : 'Girl'}` : ''}</span></div>
            <StatusPill r={r} />
          </div>
          <ScanBox onScan={onScanItem} placeholder="Scan the QR on each thing as you hand it over" />
          {!scanned && <p className="small muted" style={{ margin: 0 }}>When you scan, only the scanned things are given. Without scanning, choose below.</p>}
          <div className="list bordered">
            {r.lines.filter((l) => l.left > 0).map((l) => (
              <div className="li" key={l.id}>
                <label className="chk grow"><input type="checkbox" checked={qty[l.id] > 0} onChange={(e) => setQty((x) => ({ ...x, [l.id]: e.target.checked ? l.left : 0 }))} />
                  <span><b>{l.name}</b><span className="small muted"> · paid {l.qty}{l.given ? `, already given ${l.given}` : ''}</span>
                    {l.outOfStock && <span className="nostock"> · was not in the library when paid</span>}</span></label>
                <div className="stepper">
                  <button type="button" onClick={() => setQty((x) => ({ ...x, [l.id]: Math.max(0, x[l.id] - 1) }))} aria-label="One less">−</button>
                  <input readOnly value={qty[l.id]} aria-label="Give now" />
                  <button type="button" onClick={() => setQty((x) => ({ ...x, [l.id]: Math.min(l.left, x[l.id] + 1) }))} aria-label="One more">+</button>
                </div>
                <span className="small muted">of {l.left}</span>
              </div>
            ))}
          </div>
          <div className="fg">
            <label>Collected by<input value={collectedBy} onChange={(e) => setCollectedBy(e.target.value)} placeholder="Parent or student name" /></label>
            <label>Note<input value={note} onChange={(e) => setNote(e.target.value)} placeholder="Optional, e.g. size 32 not available" /></label>
          </div>
          {!all && count > 0 && <p className="small muted" style={{ margin: 0 }}>The rest stays on the receipt. The parent can come back for it.</p>}
          {r.gives.length > 0 && <details><summary className="small">Earlier gives on this receipt</summary><ReceiptDetails r={r} /></details>}
        </div>
      )}
    </Modal>
  );
}
