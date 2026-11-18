// Opened by the QR on a printed paper. Public: no sign-in needed. Says if the paper is genuine and who signed it.
import { useEffect, useState } from 'react';
import { useLocation, useParams } from 'react-router-dom';
import { api } from '../api';
import { fmtWhen } from '../components/ui';

const STEP = { applicant: 'Applicant', acad: 'First signer', head: 'Head Master', store: 'Store-keeper', manager: 'Manager', prepared: 'Prepared by', authorized: 'Authorized by', paid: 'Paid by', payee: 'Payee' };

export default function Verify() {
  const { type, id } = useParams();
  const code = new URLSearchParams(useLocation().search).get('c') || '';
  const [r, setR] = useState(null);
  const [error, setError] = useState('');
  useEffect(() => { api.get(`/verify/${type}/${id}?c=${encodeURIComponent(code)}`).then(setR).catch((e) => setError(e.message)); }, [type, id, code]);
  return (
    <div className="boot" style={{ alignContent: 'start', padding: 24 }}>
      <img className="logo lg" src="/musabe-logo.png" alt="Musabe Schools" />
      <div className="panel" style={{ maxWidth: 480, width: '100%', textAlign: 'left' }}>
        <h2>Check a paper</h2>
        {error && <p className="rq-note bad">{error}</p>}
        {!r && !error && <p className="muted">Checking…</p>}
        {r && <>
          <p><span className={`pill ${r.genuine ? 'ok' : 'bad'}`}>{r.genuine ? 'Genuine' : 'NOT genuine'}</span> <b>{r.number}</b></p>
          {r.reason && <p className="rq-note bad">{r.reason}</p>}
          <ul>{r.signatures.map((s, i) => <li key={i}>{STEP[s.step] || s.step}: <b>{s.by}</b> <span className="muted small">{fmtWhen(s.at)}</span></li>)}</ul>
        </>}
      </div>
    </div>
  );
}
