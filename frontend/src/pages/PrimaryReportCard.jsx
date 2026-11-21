export default function PrimaryReportCard({card, school}) {
  const subjects=Array.isArray(card?.subjects)?card.subjects:[];
  return <div className="primary-report-card">
    <header><b>{school?.name||'MUSABE SCHOOL'}</b><span>{school?.address||''}</span><h2>PRIMARY CONTINUOUS ASSESSMENT REPORT</h2></header>
    <section className="report-meta"><div><span>Student</span><b>{card?.student}</b></div><div><span>Admission No.</span><b>{card?.admissionNo}</b></div><div><span>Class</span><b>{card?.className}</b></div><div><span>Term</span><b>{card?.term||''}</b></div><div><span>Year</span><b>{card?.year||''}</b></div></section>
    <table><thead><tr><th>Subject</th><th>Mark</th><th>Out of</th><th>%</th><th>Grade</th><th>Remark</th></tr></thead><tbody>{subjects.map((s,i)=><tr key={i}><td>{s.subject}</td><td>{s.total}</td><td>{s.max}</td><td>{Number(s.percent).toFixed(1)}</td><td>{s.grade}</td><td>{s.percent>=75?'Excellent':s.percent>=65?'Very good':s.percent>=50?'Good':s.percent>=40?'Average':'Needs support'}</td></tr>)}</tbody></table>
    <section className="report-summary"><div><span>Total</span><b>{card?.total}</b></div><div><span>Average</span><b>{Number(card?.average||0).toFixed(1)}%</b></div><div><span>Position</span><b>{card?.position||'—'} / {card?.outOf||'—'}</b></div><div><span>Grade</span><b>{card?.grade||'—'}</b></div></section>
    <section className="report-remarks"><div><b>Teacher's remarks</b><p>{card?.teacherRemark||''}</p></div><div><b>Head Master's remarks</b><p>{card?.headRemark||''}</p></div></section>
    <footer><div>Class teacher: ____________________</div><div>Head Master: ____________________</div></footer>
  </div>
}
