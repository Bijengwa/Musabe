// Sell: the bursar takes the full payment and writes a receipt. The parent then takes it to the library.
// A receipt can never be cancelled or changed, so the bursar checks everything on a last screen before saving.
import { useCallback, useEffect, useMemo, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { api } from '../api';
import { useAuth } from '../auth/AuthContext';
import { useLive } from '../live';
import { useSchools } from '../layout/scope';
import { Empty, ErrorNote, Icon, Modal, PageHead, Panel, PhoneInput, fmtPhone, phoneProblem, tsh, useToast, Loading } from '../components/ui';
import { PrintButton, ReceiptBook, ReceiptModal, StatusPill, inWords } from '../components/receipt';
import StudentPicker from '../components/StudentPicker';
import { ControlSlip, PrintSlipButton } from '../components/common';

const METHODS = [['cash', 'Cash'], ['bank', 'Bank'], ['mobile', 'Mobile money'], ['control', 'Control number']];
const newKey = () => (crypto.randomUUID ? crypto.randomUUID() : `${Date.now()}-${Math.random().toString(36).slice(2)}`);
const EMPTY = { studentName: '', studentClass: '', gender: '', payerName: '', payerPhone: '', method: 'cash', reference: '', note: '' };

export default function Sell() {
  const { user } = useAuth();
  const toast = useToast();
  const school = useSchools().find((s) => s.id === user.school?.id);
  const [items, setItems] = useState(null);
  const [error, setError] = useState('');
  const [q, setQ] = useState('');
  const [cat, setCat] = useState('');
  const [params] = useSearchParams();
  const [form, setForm] = useState(() => ({ ...EMPTY, method: params.get('pay') === 'control' ? 'control' : 'cash' }));
  const [cart, setCart] = useState([]);    // [{ itemId, qty }]
  const [key, setKey] = useState(newKey);  // one per receipt: a double click never writes two
  const [confirm, setConfirm] = useState(false);
  const [done, setDone] = useState(null);  // the receipt just written
  const [student, setStudent] = useState(null); // picked from the school's list
  const [manual, setManual] = useState(false);   // student not in the list yet: type the name
  const set = (k, v) => setForm((f) => ({ ...f, [k]: v }));

  const load = useCallback(() => api.get('/items').then((d) => { setItems(d.items); setError(''); }).catch((e) => setError(e.message)), []);
  useEffect(() => { load(); }, [load]);
  useLive(['item'], load); // a new price shows at once
  // What the library can still give (stock less what is paid and not collected). Selling more is allowed:
  // the receipt and the parent are told "given when it arrives".
  const [free, setFree] = useState({});
  const loadFree = useCallback(() => api.get('/receipts/availability').then((d) => setFree(d.free)).catch(() => {}), []);
  useEffect(() => { loadFree(); }, [loadFree]);
  useLive(['stock', 'receipt', 'give', 'delivery'], loadFree);

  const sid = user.school?.id;
  const onSale = useMemo(() => (items || []).filter((i) => i.active && i.prices[sid]), [items, sid]);
  const cats = useMemo(() => [...new Map(onSale.map((i) => [i.category, i.categoryLabel])).entries()], [onSale]);
  const shown = onSale.filter((i) => (!cat || i.category === cat) && (!q.trim() || i.name.toLowerCase().includes(q.trim().toLowerCase())));

  // Gender: fixed by the school (Boys / Girls Secondary), chosen for English Medium.
  const fixedGender = school?.students === 'boys' ? 'boy' : school?.students === 'girls' ? 'girl' : null;
  const gender = student ? (student.sex === 'M' ? 'boy' : 'girl') : fixedGender || form.gender;
  const priceOf = (i) => {
    const p = i.prices[sid];
    if (!p) return null;
    if (!i.genderPriced) return p.price;
    return gender === 'boy' ? p.boys : gender === 'girl' ? p.girls : null;
  };
  const byId = Object.fromEntries(onSale.map((i) => [i.id, i]));
  const lines = cart.map((c) => ({ ...c, item: byId[c.itemId] })).filter((l) => l.item);
  const needGender = lines.some((l) => l.item.genderPriced) && !gender;
  const total = lines.reduce((s, l) => s + (priceOf(l.item) || 0) * l.qty, 0);

  const add = (i) => setCart((c) => (c.some((x) => x.itemId === i.id) ? c.map((x) => (x.itemId === i.id ? { ...x, qty: x.qty + 1 } : x)) : [...c, { itemId: i.id, qty: 1 }]));
  const setQty = (id, qty) => setCart((c) => (qty <= 0 ? c.filter((x) => x.itemId !== id) : c.map((x) => (x.itemId === id ? { ...x, qty: Math.min(qty, 500) } : x))));

  // What still stops saving, in plain words.
  const missing = [];
  if (!student && !manual) missing.push('the student');
  if (manual && form.studentName.trim().length < 3) missing.push("student's name");
  if (manual && !form.studentClass.trim()) missing.push('class');
  if (!lines.length) missing.push('at least one item');
  if (needGender) missing.push('boy or girl');
  if (['bank', 'mobile'].includes(form.method) && !form.reference.trim()) missing.push(form.method === 'bank' ? 'bank slip number' : 'transaction number');
  if (phoneProblem(form.payerPhone)) missing.push('a correct phone number');

  const reset = () => { setForm((f) => ({ ...EMPTY, method: f.method === 'control' ? 'control' : 'cash' })); setCart([]); setKey(newKey()); setQ(''); setStudent(null); setManual(false); };
  const pickStudent = (st) => {
    setStudent(st);
    const g = st.guardians?.[0];
    setForm((f) => ({ ...f, payerName: f.payerName || g?.fullName || '', payerPhone: f.payerPhone || g?.phone || '' }));
  };

  return (
    <>
      <PageHead title="Sell" sub={`${user.school?.name || ''} · The parent pays the full amount here, then takes the receipt to the library.`} />
      <ErrorNote error={error} />
      <div className="sellgrid">
        <div className="stack">
          <Panel title="1. Student and payment">
            {student ? (
              <div className="pickedcard">
                <div className="grow"><b>{student.fullName}</b>
                  <span>{student.className || 'No class'} · {student.sexLabel} · Adm. {student.admissionNo}</span>
                  {student.guardians?.length > 1 && (
                    <span className="row" style={{ gap: 4, marginTop: 4 }}><span className="small muted">Who pays?</span>
                      {student.guardians.map((g) => (
                        <button type="button" key={g.id} className={`btn sm${form.payerPhone === g.phone ? ' p' : ''}`}
                          onClick={() => setForm((f) => ({ ...f, payerName: g.fullName, payerPhone: g.phone }))}>{g.fullName} ({g.relationshipLabel})</button>
                      ))}</span>
                  )}</div>
                <button type="button" className="btn sm" onClick={() => setStudent(null)}>Change</button>
              </div>
            ) : !manual ? (
              <div className="stack" style={{ gap: 6 }}>
                <StudentPicker onPick={pickStudent} autoFocus />
                <span className="small muted">Type 2 or more letters of any of the names, or the admission number, then pick the student. <button type="button" className="linkbtn" onClick={() => setManual(true)}>Not in the list? Type the name</button></span>
              </div>
            ) : (
              <div className="stack" style={{ gap: 6 }}>
                <div className="fg">
                  <label>Student's full name<input value={form.studentName} onChange={(e) => set('studentName', e.target.value)} placeholder="e.g. NEEMA JOHN MASANJA" autoFocus /></label>
                  <label>Class<input value={form.studentClass} onChange={(e) => set('studentClass', e.target.value)} placeholder="e.g. STD 4, FORM 1" /></label>
                  {!fixedGender && (
                    <div className="lab">Boy or girl{lines.some((l) => l.item.genderPriced) && <em> (needed for the price)</em>}
                      <div className="seg">{[['boy', 'Boy'], ['girl', 'Girl']].map(([k, t]) => <button type="button" key={k} className={form.gender === k ? 'on' : ''} onClick={() => set('gender', form.gender === k ? '' : k)}>{t}</button>)}</div>
                    </div>
                  )}
                </div>
                <span className="small warn-t">Use this only for a student the School Admin has not added yet. <button type="button" className="linkbtn" onClick={() => setManual(false)}>Search the list instead</button></span>
              </div>
            )}
            <div className="fg" style={{ marginTop: 12 }}>
              <label>Paid by (parent / guardian)<input value={form.payerName} onChange={(e) => set('payerName', e.target.value)} placeholder="Optional" /></label>
              <label>Phone<PhoneInput value={form.payerPhone} onChange={(v) => set('payerPhone', v)} /></label>
            </div>
            <div className="fg" style={{ marginTop: 12 }}>
              <div className="lab">Paid with
                <div className="seg">{METHODS.map(([k, t]) => <button type="button" key={k} className={form.method === k ? 'on' : ''} onClick={() => set('method', k)}>{t}</button>)}</div>
              </div>
              {form.method === 'control' && <span className="small muted">The parent pays later at the bank or by mobile money with the control number. The receipt is written when the payment is seen (Control numbers page).</span>}
              {['bank', 'mobile'].includes(form.method) && <label>{form.method === 'bank' ? 'Bank slip number' : 'Transaction number'}<input value={form.reference} onChange={(e) => set('reference', e.target.value)} placeholder={form.method === 'bank' ? 'e.g. NMB 1234567' : 'e.g. 8HG5K2L9QP'} /></label>}
            </div>
          </Panel>

          <Panel title="2. Items" sub="Tap an item to add it" flush>
            <div className="filters pad">
              <div className="searchbox"><Icon name="search" /><input placeholder="Search item" value={q} onChange={(e) => setQ(e.target.value)} /></div>
              <div className="seg">
                <button className={!cat ? 'on' : ''} onClick={() => setCat('')}>All</button>
                {cats.map(([k, t]) => <button key={k} className={cat === k ? 'on' : ''} onClick={() => setCat(k)}>{t}</button>)}
              </div>
            </div>
            {!items ? <Loading /> : !shown.length ? <Empty>No items match.</Empty> : (
              <div className="itemgrid">
                {shown.map((i) => {
                  const inCart = cart.find((c) => c.itemId === i.id);
                  const p = i.prices[sid];
                  return (
                    <button key={i.id} type="button" className={`itembtn${inCart ? ' on' : ''}`} onClick={() => add(i)}>
                      <b>{i.name}</b>
                      <span className="money">{p.price != null ? tsh(p.price) : [p.boys != null && `B ${tsh(p.boys)}`, p.girls != null && `G ${tsh(p.girls)}`].filter(Boolean).join(' · ')}</span>
                      {inCart && <em className="badge">{inCart.qty}</em>}
                      <span className={`stk ${(free[i.id] ?? 0) > 0 ? 'in' : 'out'}`}>{(free[i.id] ?? 0) > 0 ? `${free[i.id]} in library` : 'none yet'}</span>
                    </button>
                  );
                })}
              </div>
            )}
          </Panel>
        </div>

        <div className="cartcol" id="cart">
          <Panel title="3. Receipt" right={lines.length ? <button className="linkbtn" onClick={() => setCart([])}>Clear</button> : null} flush>
            {!lines.length ? <Empty>No items yet. Tap the items to add them.</Empty> : (
              <div className="list">
                {lines.map((l) => {
                  const p = priceOf(l.item);
                  return (
                    <div className="li cartline" key={l.itemId}>
                      <div className="grow"><b>{l.item.name}</b><span>{p ? `${tsh(p)} each` : 'Choose boy or girl for the price'}</span>
                        {(free[l.itemId] ?? 0) < l.qty && <span className="nostock">Not enough in the library now: given when it arrives</span>}</div>
                      <div className="stepper">
                        <button type="button" onClick={() => setQty(l.itemId, l.qty - 1)} aria-label="One less">−</button>
                        <input inputMode="numeric" value={l.qty} onChange={(e) => setQty(l.itemId, Number(e.target.value.replace(/\D/g, '')) || 0)} aria-label="Quantity" />
                        <button type="button" onClick={() => setQty(l.itemId, l.qty + 1)} aria-label="One more">+</button>
                      </div>
                      <b className="money amt">{p ? tsh(p * l.qty) : '—'}</b>
                    </div>
                  );
                })}
              </div>
            )}
            <div className="carttotal"><span>Total (TSh)</span><b className="money">{tsh(total)}</b></div>
            <div className="pad stack" style={{ gap: 8 }}>
              {missing.length > 0 && lines.length > 0 && <p className="small muted" style={{ margin: 0 }}>Still needed: {missing.join(', ')}.</p>}
              <button className="btn p big" disabled={missing.length > 0} onClick={() => setConfirm(true)}><Icon name="check" /> {form.method === 'control' ? 'Check and make control number' : 'Check and save'}</button>
            </div>
          </Panel>
          <Today />
        </div>
      </div>

      {lines.length > 0 && (
        <button type="button" className="cartbar" onClick={() => document.getElementById('cart')?.scrollIntoView({ behavior: 'smooth' })}>
          <span>{lines.reduce((n, l) => n + l.qty, 0)} items</span><b className="money">TSh {tsh(total)}</b><span>View receipt <Icon name="chev" /></span>
        </button>
      )}
      {confirm && (
        <Confirm free={free} form={form} student={student} gender={gender} lines={lines.map((l) => ({ ...l, price: priceOf(l.item) }))} total={total} skey={key}
          onClose={() => setConfirm(false)}
          onSaved={(r) => { setConfirm(false); setDone(r); reset(); toast(r.controlNo ? `Control number ${r.controlSpaced} made` : `Receipt ${r.number} saved`); }}
          onPriceChanged={() => { setConfirm(false); load(); }} />
      )}
      {done?.controlNo && (
        <Modal wide title={`Control number ${done.controlSpaced}`} onClose={() => setDone(null)}
          footer={<><button className="btn" onClick={() => setDone(null)}>Next</button><PrintSlipButton b={done} /></>}>
          <p className="okmsg" style={{ marginBottom: 12 }}><Icon name="check" /> Give this number to the parent (print it, or read it out). Nothing is paid yet: mark it paid on "Control numbers" when the money is seen.</p>
          <div className="rpreview"><ControlSlip b={done} /></div>
        </Modal>
      )}
      {done && !done.controlNo && (
        <Modal wide title={`Receipt ${done.number} saved`} onClose={() => setDone(null)}
          footer={<><button className="btn" onClick={() => setDone(null)}>Next sale</button><PrintButton r={done} autoFocus /></>}>
          <p className="okmsg" style={{ marginBottom: 12 }}><Icon name="check" /> Paid in full. Print the receipt and give it to the parent. The library can see it now.</p>
          <div className="rpreview"><ReceiptBook r={done} /></div>
        </Modal>
      )}
    </>
  );
}

// Last check: a receipt can never be cancelled.
function Confirm({ form, student, gender, lines, total, skey, onClose, onSaved, onPriceChanged, free = {} }) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const save = async () => {
    setBusy(true); setError('');
    try {
      const body = { ...form, studentId: student?.id, gender: gender || undefined, key: skey, expectTotal: total, lines: lines.map((l) => ({ itemId: l.itemId, qty: l.qty })) };
      if (control) { const r = await api.post('/bills', body); onSaved(r.bill); } else { const r = await api.post('/receipts', body); onSaved(r.receipt); }
    } catch (e) {
      setBusy(false); setError(e.message);
      if (e.status === 409) setTimeout(onPriceChanged, 2500);
    }
  };
  const method = METHODS.find(([k]) => k === form.method)[1];
  const control = form.method === 'control';
  return (
    <Modal title="Check before saving" onClose={busy ? () => {} : onClose}
      footer={<><button className="btn" onClick={onClose} disabled={busy}>Go back</button><button className="btn p" onClick={save} disabled={busy} autoFocus>{busy ? 'Saving…' : control ? `Make control number · TSh ${tsh(total)}` : `Save receipt · TSh ${tsh(total)}`}</button></>}>
      <div className="stack">
        <div className="kvgrid">
          <span>Student</span><b>{student ? `${student.fullName} · ${student.className} · Adm. ${student.admissionNo}` : `${form.studentName.toUpperCase()} · ${form.studentClass.toUpperCase()}`}{gender ? ` · ${gender === 'boy' ? 'Boy' : 'Girl'}` : ''}</b>
          {form.payerName && <><span>Paid by</span><b>{form.payerName.toUpperCase()}{form.payerPhone ? ` · ${fmtPhone(form.payerPhone)}` : ''}</b></>}
          <span>Payment</span><b>{control ? 'Control number: the parent pays the full amount at the bank or by mobile money' : `${method}${form.reference ? ` · ${form.reference.toUpperCase()}` : ''} · paid in full`}</b>
        </div>
        <div className="tw"><table className="lines">
          <thead><tr><th>Item</th><th className="n">Qty</th><th className="n">Price</th><th className="n">Amount</th></tr></thead>
          <tbody>{lines.map((l) => <tr key={l.itemId}><td>{l.item.name}{(free[l.itemId] ?? 0) < l.qty && <span className="nostock"> · not in the library now</span>}</td><td className="n">{l.qty}</td><td className="n">{tsh(l.price)}</td><td className="n money">{tsh(l.price * l.qty)}</td></tr>)}</tbody>
          <tfoot><tr><td colSpan={3}>Total (TSh)</td><td className="n money">{tsh(total)}</td></tr></tfoot>
        </table></div>
        <p className="small muted" style={{ margin: 0 }}>{inWords(total)}.</p>
        {lines.some((l) => (free[l.itemId] ?? 0) < l.qty) && <p className="note warnnote" style={{ margin: 0 }}><Icon name="alert" /> Some items are not in the library now. Tell the parent: the child gets them when they arrive. The receipt says so, and the parent is told.</p>}
        {control ? <p className="note okmsg" style={{ margin: 0 }}>A 12-digit control number is made, valid for 7 days. The price is fixed now. No receipt yet: it is written when the payment is seen.</p>
          : <p className="note warnnote" style={{ margin: 0 }}><Icon name="alert" /> Count the money first. After saving, this receipt <b>cannot be cancelled or changed</b> by anyone.</p>}
        <ErrorNote error={error} />
      </div>
    </Modal>
  );
}

// The bursar's own receipts today, newest first.
function Today() {
  const [data, setData] = useState(null);
  const [open, setOpen] = useState(null);
  const today = new Date().toLocaleDateString('en-CA');
  const load = useCallback(() => api.get(`/receipts?mine=1&from=${today}&to=${today}`).then(setData).catch(() => {}), [today]);
  useEffect(() => { load(); }, [load]);
  useLive(['receipt', 'give'], load);
  if (!data) return <Panel title="My receipts today" flush><Loading rows={3} columns={3} /></Panel>;
  return (
    <Panel title="My receipts today" sub={`${data.totals.count} · TSh ${tsh(data.totals.money)}`} flush>
      {!data.receipts.length ? <Empty>None yet today.</Empty> : (
        <div className="list">
          {data.receipts.slice(0, 15).map((r) => (
            <button key={r.id} className="li libtn" onClick={() => setOpen(r.id)}>
              <div className="grow"><b>{r.number} · {r.studentName}</b><span>{r.studentClass} · {r.methodLabel} · {new Date(r.soldAt).toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' })}</span></div>
              <div className="stack" style={{ gap: 4, alignItems: 'flex-end' }}><b className="money">{tsh(r.total)}</b><StatusPill r={r} /></div>
            </button>
          ))}
        </div>
      )}
      {open && <ReceiptModal id={open} onClose={() => setOpen(null)} />}
    </Panel>
  );
}
