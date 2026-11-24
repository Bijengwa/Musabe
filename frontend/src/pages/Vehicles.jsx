// Vehicles and their responsible driver (2026-11-21). Changing the driver keeps the history.
import { useCallback, useEffect, useState } from 'react';
import { api } from '../api';
import { useAuth } from '../auth/AuthContext';
import { useLive } from '../live';
import { useSchools } from '../layout/scope';
import { Empty, ErrorNote, ExcelButton, Icon, Kpi, Modal, PageHead, Panel, PhoneInput, fmtPhone, useToast, Loading } from '../components/ui';
import { todayStr } from '../components/common';

export default function Vehicles() {
  const { can } = useAuth();
  const edit = can('vehicles', 'f');
  const toast = useToast();
  const [d, setD] = useState(null);
  const [error, setError] = useState('');
  const [modal, setModal] = useState(null);
  const load = useCallback(() => api.get('/vehicles').then((x) => { setD(x); setError(''); }).catch((e) => setError(e.message)), []);
  useEffect(() => { load(); }, [load]);
  useLive(['vehicle'], load);
  return (
    <>
      <PageHead title="Vehicles" sub="Each vehicle and the driver responsible for it now.">
        <ExcelButton href="/api/vehicles/export.xlsx" />
        {edit && <button className="btn p" onClick={() => setModal({ kind: 'vehicle' })}><Icon name="plus" /> Add vehicle</button>}
      </PageHead>
      <ErrorNote error={error} />
      {d && <div className="kpis"><Kpi tone="hi" label="Vehicles in use" value={d.vehicles.filter((v) => v.active).length} /><Kpi tone={d.noDriver ? 'warn' : 'ok'} label="Without a responsible driver" value={d.noDriver} /></div>}
      <Panel flush>
        {!d ? <Loading /> : !d.vehicles.length ? <Empty icon="swap" title="No vehicles yet"
          steps={['Add each school vehicle with its plate number.', 'Name the driver who is responsible for it now.', 'Change the driver here whenever it is handed over; the history is kept.']}
          action={edit && <button className="btn p" onClick={() => setModal({ kind: 'vehicle' })}><Icon name="plus" /> Add vehicle</button>} /> : (
          <div className="tw"><table className="stafftable">
            <thead><tr><th className="stick">Plate</th><th>Make / model</th><th>Use</th><th>School</th><th>Responsible driver</th><th>Phone</th><th>Since</th><th /></tr></thead>
            <tbody>{d.vehicles.map((v) => (
              <tr key={v.id} className={v.active ? '' : 'off'}>
                <td className="stick nowrap"><b className="mono">{v.plate}</b>{!v.active && <span className="pill sm">Out of use</span>}</td><td>{v.make || ''}</td><td>{v.use || ''}</td><td>{v.school || <span className="muted">Office</span>}</td>
                <td>{v.driver ? <b>{v.driver.name}</b> : <span className="pill warn">No driver</span>}</td><td className="nowrap">{v.driver?.phone ? fmtPhone(v.driver.phone) : ''}</td><td className="nowrap">{v.driver?.from || ''}</td>
                <td className="acts-cell"><div className="row nowrap">
                  <button className="btn sm" onClick={() => setModal({ kind: 'history', v })}>History</button>
                  {edit && <button className="btn sm p" onClick={() => setModal({ kind: 'driver', v })}>Change driver</button>}
                  {edit && <button className="btn sm" onClick={async () => { try { await api.patch(`/vehicles/${v.id}`, { active: !v.active }); toast(v.active ? 'Out of use' : 'Back in use'); load(); } catch (e) { setError(e.message); } }}>{v.active ? 'Out of use' : 'Back in use'}</button>}
                </div></td>
              </tr>
            ))}</tbody>
          </table></div>
        )}
      </Panel>
      {modal?.kind === 'vehicle' && <VehicleForm onClose={() => setModal(null)} onSaved={() => { setModal(null); load(); toast('Vehicle added'); }} />}
      {modal?.kind === 'driver' && <DriverForm v={modal.v} onClose={() => setModal(null)} onSaved={() => { setModal(null); load(); toast('Driver saved'); }} />}
      {modal?.kind === 'history' && <History v={modal.v} onClose={() => setModal(null)} />}
    </>
  );
}

function VehicleForm({ onClose, onSaved }) {
  const schools = useSchools();
  const [f, setF] = useState({ plate: '', make: '', use: '', schoolId: '' });
  const [error, setError] = useState('');
  const set = (k, v) => setF((x) => ({ ...x, [k]: v }));
  const save = async (e) => { e.preventDefault(); setError(''); try { await api.post('/vehicles', { ...f, schoolId: Number(f.schoolId) || undefined }); onSaved(); } catch (err) { setError(err.message); } };
  return (
    <Modal title="Add vehicle" onClose={onClose} footer={<><button className="btn" onClick={onClose}>Cancel</button><button className="btn p" form="vform">Save</button></>}>
      <form id="vform" className="stack" onSubmit={save}>
        <div className="fg"><label>Plate number<input value={f.plate} onChange={(e) => set('plate', e.target.value)} placeholder="T 123 ABC" required autoFocus /></label><label>Make / model<input value={f.make} onChange={(e) => set('make', e.target.value)} placeholder="Toyota Coaster" /></label></div>
        <div className="fg"><label>Use<input value={f.use} onChange={(e) => set('use', e.target.value)} placeholder="School bus, lorry, office car…" /></label>
          <label>School<select value={f.schoolId} onChange={(e) => set('schoolId', e.target.value)}><option value="">Administration office</option>{schools.map((s) => <option key={s.id} value={s.id}>{s.shortName}</option>)}</select></label></div>
        <ErrorNote error={error} />
      </form>
    </Modal>
  );
}

function DriverForm({ v, onClose, onSaved }) {
  const [f, setF] = useState({ name: '', phone: '', licence: '', from: todayStr() });
  const [error, setError] = useState('');
  const set = (k, x) => setF((y) => ({ ...y, [k]: x }));
  const save = async (e) => { e.preventDefault(); setError(''); try { await api.post(`/vehicles/${v.id}/driver`, f); onSaved(); } catch (err) { setError(err.message); } };
  return (
    <Modal title={`Responsible driver of ${v.plate}`} onClose={onClose} footer={<><button className="btn" onClick={onClose}>Cancel</button><button className="btn p" form="dform">Save</button></>}>
      <form id="dform" className="stack" onSubmit={save}>
        {v.driver && <p className="small muted" style={{ margin: 0 }}>Now: <b>{v.driver.name}</b> since {v.driver.from}. He stops on the date the new driver starts.</p>}
        <div className="fg"><label>Driver's name<input value={f.name} onChange={(e) => set('name', e.target.value)} required autoFocus /></label><label>Phone<PhoneInput value={f.phone} onChange={(x) => set('phone', x)} /></label></div>
        <div className="fg"><label>Driving licence no.<input value={f.licence} onChange={(e) => set('licence', e.target.value)} /></label><label>Responsible from<input type="date" value={f.from} onChange={(e) => set('from', e.target.value)} /></label></div>
        <ErrorNote error={error} />
      </form>
    </Modal>
  );
}

function History({ v, onClose }) {
  const [d, setD] = useState(null);
  useEffect(() => { api.get(`/vehicles/${v.id}`).then(setD).catch(() => {}); }, [v.id]);
  return (
    <Modal title={`${v.plate}: drivers`} onClose={onClose} footer={<button className="btn" onClick={onClose}>Close</button>}>
      {!d ? <Loading /> : !d.drivers.length ? <Empty>No driver recorded yet.</Empty> : (
        <div className="tw"><table className="stafftable"><thead><tr><th>Driver</th><th>Phone</th><th>From</th><th>To</th><th>Recorded by</th></tr></thead>
          <tbody>{d.drivers.map((x) => <tr key={x.id}><td><b>{x.name}</b>{x.licence && <div className="small muted">{x.licence}</div>}</td><td className="nowrap">{x.phone ? fmtPhone(x.phone) : ''}</td><td className="nowrap">{x.from}</td><td className="nowrap">{x.to || <span className="pill ok">Now</span>}</td><td className="small">{x.by}</td></tr>)}</tbody></table></div>
      )}
    </Modal>
  );
}
