import { useState } from 'react';
import { api } from '../api';
import { useAuth } from '../auth/AuthContext';
import { useReloadSchools, useSchools } from '../layout/scope';
import { ErrorNote, Icon, Modal, PageHead, SchoolPill, useToast } from '../components/ui';

export default function Schools() {
  const { can } = useAuth();
  const schools = useSchools();
  const reload = useReloadSchools();
  const toast = useToast();
  const [edit, setEdit] = useState(null); // {} new, or a school

  return (
    <>
      <PageHead title="Schools" sub="Each school has its own staff, students, library and receipt book.">
        {can('schools', 'f') ? <button className="btn p" onClick={() => setEdit({})}><Icon name="plus" /> Add school</button>
          : <span className="pill"><Icon name="eye" /> View only</span>}
      </PageHead>
      <div className="grid3">
        {schools.map((s) => (
          <section className="panel" key={s.id}>
            <div className="hd"><SchoolPill code={s.code} name={s.shortName} /><h2>{s.name}</h2></div>
            <div className="bd stack small">
              <div className="kv"><span>Levels</span><b>{s.levels || '—'}</b></div>
              <div className="kv"><span>Students</span><b>{{ boys: 'Boys only', girls: 'Girls only', mixed: 'Boys and girls' }[s.students] || '—'}</b></div>
              <div className="kv"><span>Next receipt</span><b className="rnum sm">{s.nextReceipt}</b></div>
              <div className="kv"><span>Active staff</span><b>{s.staffCount}</b></div>
              <div className="kv"><span>School Admin</span><b>{s.schoolAdmins || <span className="pill bad">None yet</span>}</b></div>
              {can('schools', 'f') && <div><button className="btn sm" onClick={() => setEdit(s)}><Icon name="edit" /> Edit</button></div>}
            </div>
          </section>
        ))}
      </div>
      {edit && <SchoolForm s={edit} onClose={() => setEdit(null)} onDone={() => { setEdit(null); reload(); toast('Saved'); }} />}
    </>
  );
}

function SchoolForm({ s, onClose, onDone }) {
  const [f, setF] = useState({ name: s.name || '', shortName: s.shortName || '', levels: s.levels || '', students: s.students || 'mixed',
    receiptTitle: s.receiptTitle || '', receiptContact: s.receiptContact || '', receiptSigner: s.receiptSigner || '', nextReceiptNo: '' });
  const [error, setError] = useState('');
  const set = (k) => (e) => setF((x) => ({ ...x, [k]: e.target.value }));
  const submit = async (e) => {
    e.preventDefault(); setError('');
    try { s.id ? await api.patch(`/schools/${s.id}`, f) : await api.post('/schools', f); onDone(); } catch (err) { setError(err.message); }
  };
  return (
    <Modal title={s.id ? `Edit ${s.name}` : 'Add school'} onClose={onClose}
      footer={<><button className="btn" onClick={onClose}>Cancel</button><button className="btn p" form="schoolf">{s.id ? 'Save' : 'Add school'}</button></>}>
      <form id="schoolf" className="stack" onSubmit={submit}>
        <label>School name<input id="sc-name" value={f.name} onChange={set('name')} required placeholder="e.g. Musabe High School" /></label>
        <div className="fg">
          <label>Short name<input id="sc-short" value={f.shortName} onChange={set('shortName')} placeholder="e.g. High School" /></label>
          <label>Levels<input id="sc-levels" value={f.levels} onChange={set('levels')} placeholder="e.g. Form V–VI" /></label>
          <label>Students<select id="sc-students" value={f.students} onChange={set('students')}>
            <option value="mixed">Boys and girls</option><option value="boys">Boys only</option><option value="girls">Girls only</option>
          </select></label>
        </div>
        <h3 className="small" style={{ margin: '6px 0 0' }}>Printed receipt (like the receipt book)</h3>
        <label>Name at the top<input value={f.receiptTitle} onChange={set('receiptTitle')} placeholder="e.g. MUSABE BOYS SEC. SCHOOL" /></label>
        <label>Address, phones, email (one per line)<textarea rows={3} value={f.receiptContact} onChange={set('receiptContact')}
          placeholder={'P.O. Box 5154, BUGANDO, MWANZA, TEL: +255 782 110494,\n+255 754 654545, +255 769 197 221\nEmail:musabeschools@yahoo.co.uk'} /></label>
        <label>Under the signature ("For :")<input value={f.receiptSigner} onChange={set('receiptSigner')} placeholder="e.g. ACCOUNTANT MUSABE MEDIUM" /></label>
        {s.id && <label>Next receipt number<input value={f.nextReceiptNo} onChange={(e) => setF((x) => ({ ...x, nextReceiptNo: e.target.value.replace(/\D/g, '').slice(0, 7) }))}
          inputMode="numeric" placeholder={`Now: ${s.nextReceipt}. To continue from the paper book, type e.g. 463`} /></label>}
        {!s.id && <p className="small muted">After adding the school, create its School Admin in Staff accounts.</p>}
        <ErrorNote error={error} />
      </form>
    </Modal>
  );
}
