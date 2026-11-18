// Reports: each person sees only the reports their role may download (backend/src/auth/roles.js REPORTS).
// Choose the days (and the school at the top, for administration), then download the Excel file.
import { useEffect, useState } from 'react';
import { api } from '../api';
import { useAuth } from '../auth/AuthContext';
import { useSchools } from '../layout/scope';
import { Empty, ErrorNote, Icon, PageHead, Panel } from '../components/ui';
import { DateRange, presets, useSchoolQs } from '../components/common';

export default function Reports() {
  const { user } = useAuth();
  const school = useSchoolQs();
  const schools = useSchools();
  const month = presets().find(([k]) => k === 'month');
  const [from, setFrom] = useState(month[2]);
  const [to, setTo] = useState(month[3]);
  const [data, setData] = useState(null);
  const [error, setError] = useState('');
  useEffect(() => { api.get('/reports').then(setData).catch((e) => setError(e.message)); }, []);
  const groups = data ? [...new Set(data.reports.map((r) => r.group))] : [];
  const where = user.scope === 'all' ? (school ? schools.find((s) => String(s.id) === String(school))?.name : 'All schools (choose one at the top to narrow)') : user.school?.name;
  const href = (r) => `/api/reports/${r.key}.xlsx?${new URLSearchParams({ ...(r.dates ? { from, to } : {}), ...(school ? { school } : {}) })}`;
  return (
    <>
      <PageHead title="Reports" sub={`Excel files for your work. ${where || ''}`} />
      <div className="filters"><DateRange from={from} to={to} onChange={(a, b) => { setFrom(a); setTo(b); }} /></div>
      <ErrorNote error={error} />
      {!data ? <Empty>Loading…</Empty> : !data.reports.length ? <Panel><p className="muted" style={{ margin: 0 }}>{data.note}</p></Panel> : groups.map((g) => (
        <Panel key={g} title={g} flush>
          <div className="list">{data.reports.filter((r) => r.group === g).map((r) => (
            <div key={r.key} className="li">
              <Icon name="excel" />
              <div className="grow"><b>{r.title}</b><span>{r.about}{!r.dates && ' (as it is now — the dates are not used)'}</span></div>
              <a className="btn xl" href={href(r)} download><Icon name="excel" /> Download</a>
            </div>
          ))}</div>
        </Panel>
      ))}
      <p className="small muted" style={{ margin: 0 }}>
        {user.role === 'bursar' ? 'You get your own school. Daily money shows only your own receipts.' : user.scope === 'all' ? 'Each file covers the school chosen at the top, or all schools.' : 'Files cover your own school only.'}
      </p>
    </>
  );
}
