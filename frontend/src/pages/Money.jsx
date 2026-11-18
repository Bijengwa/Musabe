// Daily money. The accountant checks each bursar's day: the receipts say how much cash came in; the accountant
// types the cash received (or seen on the bank slip) and saves the check once. It cannot be changed afterwards.
// A bursar sees only their own days.
import { useCallback, useEffect, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { api } from '../api';
import { useAuth } from '../auth/AuthContext';
import { useLive } from '../live';
import { Empty, ErrorNote, ExcelButton, Kpi, Modal, PageHead, Panel, SchoolPill, fmtWhen, tsh, useToast } from '../components/ui';
import { DateRange, todayStr, useSchoolQs } from '../components/common';

const TONE = { ok: 'ok', short: 'bad', over: 'warn' };
const dayName = (d) => new Date(`${d}T12:00:00`).toLocaleDateString('en-GB', { weekday: 'short', day: 'numeric', month: 'short' });
const back = (n) => { const x = new Date(`${todayStr()}T12:00:00Z`); x.setUTCDate(x.getUTCDate() - n); return x.toISOString().slice(0, 10); };

export default function Money() {
  const { user } = useAuth();
  const school = useSchoolQs();
  const [from, setFrom] = useState(back(13));
  const [to, setTo] = useState(todayStr());
  const [params] = useSearchParams();
  const [status, setStatus] = useState(() => params.get('status') || '');
  const [data, setData] = useState(null);
  const [error, setError] = useState('');
  const [checking, setChecking] = useState(null);
  const qs = new URLSearchParams({ from, to, ...(school ? { school } : {}), ...(status ? { status } : {}) }).toString();
  const load = useCallback(() => api.get(`/money?${qs}`).then((d) => { setData(d); setError(''); }).catch((e) => setError(e.message)), [qs]);
  useEffect(() => { load(); }, [load]);
  useLive(['money', 'receipt'], load);
  const mine = user.role === 'bursar';
  const all = user.scope === 'all';
  return (
    <>
      <PageHead title="Daily money" sub={mine ? 'Your money each day, and the accountant\'s check.' : 'Each bursar\'s money per day. Count the cash (or check the bank slip) and confirm.'}>
        <ExcelButton href={`/api/money/export.xlsx?${qs}`} />
      </PageHead>
      {data && (
        <div className="kpis">
          <Kpi tone="hi" label="Money in these days (TSh)" value={tsh(data.totals.total)} sub={`cash ${tsh(data.totals.cash)}`} />
          <Kpi tone={data.totals.open ? 'warn' : 'ok'} label="Days not checked" value={data.totals.open} />
          <Kpi tone={data.totals.problems ? 'bad' : 'ok'} label="Short or over" value={data.totals.problems} />
        </div>
      )}
      <div className="filters">
        <DateRange from={from} to={to} onChange={(a, b) => { setFrom(a); setTo(b); }} />
        <div className="seg">{[['', 'All'], ['open', 'Not checked'], ['checked', 'Checked'], ['problem', 'Short / over']].map(([k, t]) =>
          <button key={k} className={status === k ? 'on' : ''} onClick={() => setStatus(k)}>{t}</button>)}</div>
      </div>
      <ErrorNote error={error} />
      <Panel flush>
        {!data ? <Empty>Loading…</Empty> : !data.rows.length ? <Empty>No receipts by bursars in these days.</Empty> : (
          <div className="tw"><table className="stafftable">
            <thead><tr><th className="stick">Day</th>{!mine && <th>Bursar</th>}{all && <th>School</th>}<th className="n">Receipts</th><th className="n">Cash</th><th className="n">Bank</th>
              <th className="n">Mobile</th><th className="n">Control no.</th><th className="n">Total</th><th>Check</th></tr></thead>
            <tbody>{data.rows.map((r) => (
              <tr key={`${r.bursarId}:${r.day}`}>
                <td className="stick"><b>{dayName(r.day)}</b></td>
                {!mine && <td>{r.bursar}</td>}
                {all && <td><SchoolPill code={r.code} name={r.school} /></td>}
                <td className="n">{r.receipts}</td><td className="n"><b>{tsh(r.cash)}</b></td><td className="n">{tsh(r.bank)}</td><td className="n">{tsh(r.mobile)}</td>
                <td className="n">{tsh(r.control)}</td><td className="n"><b>{tsh(r.total)}</b></td>
                <td>{r.check ? (
                  <span title={`${r.check.by} · ${fmtWhen(r.check.at)}${r.check.note ? ` · ${r.check.note}` : ''}`}>
                    <span className={`pill ${TONE[r.check.result]}`}>{r.check.resultLabel}{r.check.result !== 'ok' ? ` ${tsh(Math.abs(r.check.difference))}` : ''}</span>
                    <div className="small muted">{r.check.by}{r.check.bankSlip ? ` · slip ${r.check.bankSlip}` : ''}</div>
                    {r.check.changedSince && <div className="small warn-t">receipts added after the check</div>}
                  </span>
                ) : data.canCheck ? <button className="btn sm p" onClick={() => setChecking(r)}>Check</button> : <span className="pill warn">Not checked</span>}</td>
              </tr>
            ))}</tbody>
          </table></div>
        )}
      </Panel>
      {checking && <Check r={checking} onClose={() => setChecking(null)} />}
    </>
  );
}

function Check({ r, onClose }) {
  const toast = useToast();
  const [counted, setCounted] = useState(String(r.cash));
  const [slip, setSlip] = useState('');
  const [note, setNote] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const n = Number(counted || 0);
  const diff = n - r.cash;
  const save = async () => {
    setBusy(true); setError('');
    try { await api.post('/money/check', { bursarId: r.bursarId, day: r.day, cashCounted: n, bankSlip: slip, note }); toast(`${r.bursar}, ${dayName(r.day)}: checked`); onClose(); }
    catch (e) { setError(e.message); setBusy(false); }
  };
  return (
    <Modal title={`${r.bursar} · ${dayName(r.day)}`} onClose={onClose}
      footer={<><button className="btn" onClick={onClose}>Cancel</button><button className="btn p" disabled={busy || (diff !== 0 && note.trim().length < 3)} onClick={save}>{busy ? 'Saving…' : 'Save check'}</button></>}>
      <div className="stack">
        <div className="kvgrid"><span>Receipts</span><b>{r.receipts}</b><span>Cash on receipts</span><b>TSh {tsh(r.cash)}</b>
          <span>Bank / mobile / control</span><b>TSh {tsh(r.bank)} / {tsh(r.mobile)} / {tsh(r.control)}</b></div>
        <div className="fg">
          <label>Cash received or banked (TSh)<input inputMode="numeric" value={counted} onChange={(e) => setCounted(e.target.value.replace(/\D/g, ''))} autoFocus /></label>
          <label>Bank slip of the cash<input value={slip} onChange={(e) => setSlip(e.target.value)} placeholder="Optional" /></label>
        </div>
        {diff !== 0 && <p className={`note ${diff < 0 ? 'warnnote' : 'okmsg'}`} style={{ margin: 0 }}>{diff < 0 ? 'Short' : 'Over'} by TSh {tsh(Math.abs(diff))}. Write a note.</p>}
        <label>Note<input value={note} onChange={(e) => setNote(e.target.value)} placeholder={diff ? 'Needed, e.g. 1,000 to follow tomorrow' : 'Optional'} /></label>
        <p className="small muted" style={{ margin: 0 }}>This check cannot be changed after it is saved.</p>
        <ErrorNote error={error} />
      </div>
    </Modal>
  );
}
