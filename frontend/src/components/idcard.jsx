/* eslint-disable react-refresh/only-export-components */
// ID cards in the layout of the national ID card (front and back), with the Musabe emblem and the person's photo.
// Each school has its own colour, and staff have their own colour in each school; administration staff have theirs.
// The QR code holds the ID code (MS000123 / MU000045) that QR scanners read when a person receives or returns things.
// The School Admin adds the photo and records when the card is handed over (issued / not issued).
import { useCallback, useEffect, useRef, useState } from 'react';
import { api } from '../api';
import { useLive } from '../live';
import { ErrorNote, Icon, Modal, Panel, fmtPhone, fmtWhen, useToast, Loading } from './ui';
import { QR } from './qr';
import { PrintButton } from './barcode';

const initials = (name) => String(name || '').split(/\s+/).filter(Boolean).slice(0, 2).map((w) => w[0]).join('');
const kindOf = (h) => h.kind || h.type;
// Colour of the card: the school (pre = English Medium / Primary, boys, girls) and student or staff.
export const themeOf = (h) => `idt-${['pre', 'boys', 'girls'].includes(h.schoolCode) ? h.schoolCode : 'admin'}-${kindOf(h) === 'student' ? 'student' : 'staff'}`;
const dmy = (v) => (v ? new Date(v).toLocaleDateString('en-GB', { day: '2-digit', month: '2-digit', year: 'numeric', timeZone: 'Africa/Dar_es_Salaam' }) : '');
const prettyCode = (c) => `${c.slice(0, 2)}-${c.slice(2)}`;
const photoUrl = (h) => (h.photo ? `/api/idcards/photo/${kindOf(h)}/${h.id}?v=${h.photo}` : null);

const Field = ({ sw, en, value, wide }) => (
  <div className={`idf${wide ? ' wide' : ''}`}><span className="idf-l"><b>{sw}</b> / <i>{en}</i></span><span className="idf-v">{value || '—'}</span></div>
);

export function IdCardFront({ h }) {
  const student = kindOf(h) === 'student';
  const url = photoUrl(h);
  return (
    <div className={`nid front ${themeOf(h)}`}>
      <div className="nid-guilloche" />
      <header className="nid-head">
        <img className="nid-emblem" src="/musabe-logo.png" alt="" />
        <div className="nid-titles">
          <span className="t1">SHULE ZA MUSABE · MUSABE SCHOOLS</span>
          <b className="t2">{student ? 'KITAMBULISHO CHA MWANAFUNZI' : 'KITAMBULISHO CHA MFANYAKAZI'}</b>
          <span className="t3">{student ? 'STUDENT IDENTITY CARD' : 'STAFF IDENTITY CARD'}</span>
        </div>
        <span className="nid-badge">{(h.schoolName || 'Musabe Schools').replace(/^Musabe\s+/i, '').replace(/\s+School$/i, '').toUpperCase()}</span>
      </header>
      <div className="nid-no">{prettyCode(h.code)}</div>
      <div className="nid-body">
        <div className="nid-fields">
          <Field sw="JINA LA KWANZA" en="First Name" value={h.firstName} />
          <Field sw="JINA LA KATI" en="Middle Name" value={h.middleName} />
          <Field sw="JINA LA MWISHO" en="Surname" value={h.lastName} />
          {student ? <div className="idf-row"><Field sw="JINSIA" en="Sex" value={h.sex === 'Female' ? 'F' : h.sex === 'Male' ? 'M' : h.sex} />
            <Field sw="DARASA" en="Class" value={h.className || h.detail} /></div>
            : <Field sw="CHEO" en="Position" value={h.role || h.detail} />}
          {student ? <Field sw="NAMBA YA USAJILI" en="Admission No." value={h.admissionNo} /> : <Field sw="SHULE" en="School" value={h.school === 'Administration' ? 'UTAWALA / ADMINISTRATION' : h.schoolName} />}
          <div className="idf sig"><span className="idf-l"><b>SAINI</b> / <i>Signature</i></span><span className="idf-sigline" /></div>
        </div>
        <div className="nid-photo">{url ? <img src={url} alt="" /> : <span>{initials(h.name)}</span>}</div>
      </div>
    </div>
  );
}

export function IdCardBack({ h, issuedAt }) {
  const student = kindOf(h) === 'student';
  return (
    <div className={`nid back ${themeOf(h)}`}>
      <div className="nid-guilloche" />
      <div className="nid-backhead">MUSABE SCHOOLS {student ? 'STUDENT' : 'STAFF'} IDENTITY CARD</div>
      <div className="nid-backmain">
        <div className="nid-qr"><QR value={h.code} /></div>
        <div className="nid-backtext">
          <b className="nid-bigno">{prettyCode(h.code)}</b>
          <p className="sw">Kitambulisho hiki ni mali ya Shule za Musabe. Kitumiwe na mwenye jina lililoandikwa tu. Ukikiokota, tafadhali kirudishe shuleni au ofisi ya Shule za Musabe, Buhongwa, Mwanza.</p>
          <p className="en">This card is the property of Musabe Schools and is used only by the person named on it. If found, please return it to the school or to the Musabe Schools office, Buhongwa, Mwanza.</p>
        </div>
      </div>
      <div className="nid-backfoot">
        <div className="nid-facts">
          <span>Imetolewa / Issued: <b>{dmy(issuedAt) || '........................'}</b></span>
          {student && h.parentPhone && <span>Simu ya mzazi / Guardian: <b>{fmtPhone(h.parentPhone)}</b></span>}
          {!student && h.phone && <span>Simu / Phone: <b>{fmtPhone(h.phone)}</b></span>}
        </div>
        <div className="nid-director"><span className="line" /><span>MKURUGENZI / DIRECTOR</span><span>MUSABE SCHOOLS</span></div>
      </div>
    </div>
  );
}

// A4 sheets: a page of up to 10 fronts, then the same cards' backs with each row mirrored, so that printing on both
// sides (flip on the long edge) puts every back behind its front.
export function CardSheet({ cards }) {
  const pages = [];
  for (let i = 0; i < cards.length; i += 10) pages.push(cards.slice(i, i + 10));
  return pages.map((page, n) => {
    const backs = [];
    for (let i = 0; i < page.length; i += 2) backs.push(page[i + 1] || null, page[i]);
    return (
      <div key={n}>
        <div className="cardpage">{page.map((c) => <IdCardFront key={c.code} h={c} />)}</div>
        <div className="cardpage">{backs.map((c, i) => (c ? <IdCardBack key={c.code} h={c} issuedAt={c.issued?.at || new Date()} /> : <div key={`e${i}`} className="nid-empty" />))}</div>
      </div>
    );
  });
}

const REASONS = [['lost', 'Lost'], ['damaged', 'Damaged'], ['returned', 'Returned (left school / work)'], ['mistake', 'Issued by mistake']];

// A small photo (360 x 480 JPEG) made in the browser from the chosen picture: the middle part, like a passport photo.
function shrink(file) {
  return new Promise((resolve, reject) => {
    const img = new Image();
    const url = URL.createObjectURL(file);
    img.onload = () => {
      const W = 360, H = 480, c = document.createElement('canvas');
      c.width = W; c.height = H;
      const s = Math.max(W / img.width, H / img.height);
      const w = img.width * s, h = img.height * s;
      const g = c.getContext('2d');
      g.fillStyle = '#fff'; g.fillRect(0, 0, W, H);
      g.drawImage(img, (W - w) / 2, (H - h) / 2.6, w, h);
      URL.revokeObjectURL(url);
      resolve(c.toDataURL('image/jpeg', 0.85));
    };
    img.onerror = () => { URL.revokeObjectURL(url); reject(new Error('This file is not a picture.')); };
    img.src = url;
  });
}

// kind 'student' | 'staff', id; or me = true for "My profile".
export function IdCardPanel({ kind, id, me, flush }) {
  const toast = useToast();
  const [d, setD] = useState(null);
  const [error, setError] = useState('');
  const [closing, setClosing] = useState(false);
  const [busy, setBusy] = useState(false);
  const file = useRef();
  const url = me ? '/idcards/me' : `/idcards/${kind}/${id}`;
  const load = useCallback(() => api.get(url).then((x) => { setD(x); setError(''); }).catch((e) => setError(e.message)), [url]);
  useEffect(() => { load(); }, [load]);
  useLive(['idcard'], load);
  const issue = async () => {
    setBusy(true);
    try { await api.post('/idcards/issue', { kind: d.holder.kind, id: d.holder.id }); toast(`ID card recorded as given to ${d.holder.name}`); load(); } catch (e) { toast(e.message); }
    setBusy(false);
  };
  const photo = async (e) => {
    const f = e.target.files?.[0];
    e.target.value = '';
    if (!f) return;
    setBusy(true);
    try { await api.post(`/idcards/photo/${d.holder.kind}/${d.holder.id}`, { image: await shrink(f) }); toast('Photo saved'); load(); } catch (x) { toast(x.message); }
    setBusy(false);
  };
  if (error) return <Panel title="ID card"><ErrorNote error={error} /></Panel>;
  if (!d) return <Panel title="ID card"><Loading /></Panel>;
  const c = d.current;
  return (
    <Panel title="ID card" flush={flush}
      right={d.issued ? <span className="pill ok"><Icon name="check" /> Issued</span> : <span className="pill warn">Not issued</span>}>
      <div className="idpanel">
        <div className="idfaces"><IdCardFront h={d.holder} /><IdCardBack h={d.holder} issuedAt={c?.issuedAt} /></div>
        <div className="stack idside">
          {d.issued
            ? <p className="small" style={{ margin: 0 }}>Card <b>no. {c.no}</b> given on <b>{fmtWhen(c.issuedAt)}</b> by {c.issuedBy}.{c.note ? ` ${c.note}` : ''}</p>
            : <p className="small" style={{ margin: 0 }}>{me ? 'You have not received your ID card yet. Ask the School Admin.' : `${d.holder.name} has not taken the ID card yet.`}
              {d.cards.length ? ` Last card (no. ${d.cards[0].no}): ${d.cards[0].endLabel?.toLowerCase()}.` : ''}</p>}
          {!d.holder.photo && <p className="small muted" style={{ margin: 0 }}>No photo yet{d.canIssue ? ': add one before printing.' : '.'}</p>}
          <div className="row">
            {d.canIssue && <><input ref={file} type="file" accept="image/*" hidden onChange={photo} />
              <button className="btn" disabled={busy} onClick={() => file.current.click()}><Icon name="camera" /> {d.holder.photo ? 'Change photo' : 'Add photo'}</button></>}
            {d.canIssue && !d.issued && <button className="btn p" disabled={busy || !d.holder.active} onClick={issue}><Icon name="check" /> {d.cards.length ? `Give card no. ${d.cards[0].no + 1}` : 'Mark as issued'}</button>}
            {d.canIssue && d.issued && <button className="btn" onClick={() => setClosing(true)}>Lost / returned…</button>}
            {d.canIssue && <PrintButton className="btn" label="Print card"><CardSheet cards={[{ ...d.holder, issued: c ? { at: c.issuedAt } : null }]} /></PrintButton>}
          </div>
          {!d.holder.active && <p className="small muted" style={{ margin: 0 }}>{d.holder.kind === 'student' ? 'Marked as left school.' : 'Account switched off.'}</p>}
          {d.cards.filter((x) => !x.open).length > 0 && (
            <div className="list bordered">{d.cards.filter((x) => !x.open).map((x) => (
              <div className="li" key={x.id}><div className="grow"><b className="fw5">Card no. {x.no}: {x.endLabel}</b>
                <span>Given {fmtWhen(x.issuedAt)} by {x.issuedBy} · closed {fmtWhen(x.endedAt)} by {x.endedBy}{x.endNote ? ` · ${x.endNote}` : ''}</span></div></div>
            ))}</div>
          )}
        </div>
      </div>
      {closing && <CloseCard card={c} name={d.holder.name} onClose={() => setClosing(false)} onDone={() => { setClosing(false); load(); }} />}
    </Panel>
  );
}

function CloseCard({ card, name, onClose, onDone }) {
  const toast = useToast();
  const [reason, setReason] = useState('lost');
  const [note, setNote] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const go = async () => {
    setBusy(true); setError('');
    try { await api.post(`/idcards/${card.id}/close`, { reason, note }); toast(`Card no. ${card.no} of ${name} closed`); onDone(); } catch (e) { setError(e.message); setBusy(false); }
  };
  return (
    <Modal title={`Card no. ${card.no} · ${name}`} onClose={onClose}
      footer={<><button className="btn" onClick={onClose}>Cancel</button><button className="btn p" disabled={busy || (reason !== 'returned' && note.trim().length < 3)} onClick={go}>{busy ? 'Saving…' : 'Close this card'}</button></>}>
      <div className="stack">
        <div className="seg wrap">{REASONS.map(([k, t]) => <button key={k} type="button" className={reason === k ? 'on' : ''} onClick={() => setReason(k)}>{t}</button>)}</div>
        <label>{reason === 'returned' ? 'Note (not required)' : 'What happened'}<input value={note} maxLength={200} onChange={(e) => setNote(e.target.value)} placeholder="e.g. lost at the bus stop" /></label>
        <p className="small muted" style={{ margin: 0 }}>The card stays in the history. After closing it you can give a new card (it gets the next number).</p>
        <ErrorNote error={error} />
      </div>
    </Modal>
  );
}
