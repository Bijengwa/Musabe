// Help chat: a button on every account. The AI explains only HOW to use the pages of this account (Kiswahili or English).
// It sees no data at all (the server gives it only how-to notes for this role), so it cannot tell anybody about fees, money or stock.
// The chat lives only on this screen: nothing is saved.
import { useEffect, useRef, useState } from 'react';
import { api } from '../api';
import { Icon } from './ui';
import './helpchat.css';

const HELLO = 'Habari! Uliza jinsi ya kufanya kitu kwenye akaunti yako. / Hello! Ask how to do something in your account.';

export default function HelpChat() {
  const [open, setOpen] = useState(false);
  const [msgs, setMsgs] = useState([]);
  const [text, setText] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const end = useRef(null);
  useEffect(() => { end.current?.scrollIntoView({ block: 'end' }); }, [msgs, busy, open]);
  const send = async (e) => {
    e?.preventDefault();
    const q = text.trim();
    if (!q || busy) return;
    const next = [...msgs, { role: 'user', content: q }];
    setMsgs(next); setText(''); setBusy(true); setError('');
    try {
      const d = await api.post('/help/chat', { messages: next });
      setMsgs((m) => [...m, { role: 'assistant', content: d.reply }]);
    } catch (err) { setError(err.message); } finally { setBusy(false); }
  };
  return (
    <>
      <button type="button" className="hc-fab" onClick={() => setOpen((o) => !o)} aria-label={open ? 'Close help' : 'Help: how do I…?'} title="Help: how do I…?">
        <Icon name={open ? 'x' : 'chat'} /><span>{open ? 'Close' : 'Help'}</span>
      </button>
      {open && (
        <div className="hc-panel" role="dialog" aria-label="Help chat">
          <div className="hc-head"><b>Help · Msaada</b><span>Only how to use your own pages. It cannot see any data.</span></div>
          <div className="hc-body">
            <div className="hc-msg bot">{HELLO}</div>
            {msgs.map((m, i) => <div key={i} className={`hc-msg ${m.role === 'user' ? 'me' : 'bot'}`}>{m.content}</div>)}
            {busy && <div className="hc-msg bot hc-dots"><i /><i /><i /></div>}
            {error && <div className="hc-err" role="alert">{error}</div>}
            <div ref={end} />
          </div>
          <form className="hc-form" onSubmit={send}>
            <textarea rows={2} maxLength={1500} value={text} placeholder="e.g. Nitaandikaje requisition? / How do I write an order?" onChange={(e) => setText(e.target.value)}
              onKeyDown={(e) => { if (e.key === 'Enter' && !e.shiftKey) send(e); }} />
            <button className="btn p" disabled={busy || !text.trim()}>Send</button>
          </form>
        </div>
      )}
    </>
  );
}
