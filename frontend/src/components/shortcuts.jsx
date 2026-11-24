import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAuth } from '../auth/AuthContext';
import { Modal } from './ui';

const typing = (e) => {
  const t = e.target;
  return t && (t.isContentEditable || ['INPUT', 'TEXTAREA', 'SELECT'].includes(t.tagName));
};

const SHORTCUTS = [
  ['/', 'Jump to the search box on this page'],
  ['G then H', 'Go to Home'],
  ['G then P', 'Go to My profile'],
  ['G then S', 'Go to Settings'],
  ['G then L', 'Sign out (it asks you to confirm first)'],
  [']', 'Next page of a long list'],
  ['[', 'Previous page of a long list'],
  ['Esc', 'Close a window or menu'],
  ['?', 'Show this list'],
];

// Global keyboard shortcuts. Ignored while typing in a field, or with Ctrl/Alt/Cmd held.
export default function Shortcuts() {
  const nav = useNavigate();
  const { askLogout } = useAuth();
  const [help, setHelp] = useState(false);
  useEffect(() => {
    let g = 0;
    const onKey = (e) => {
      if (e.ctrlKey || e.metaKey || e.altKey || typing(e) || document.querySelector('.mwrap')) return;
      if (e.key === '/') {
        const box = document.querySelector('.searchbox input, input[type="search"]');
        if (box) { e.preventDefault(); box.focus(); box.select?.(); }
      } else if (e.key === '?') { e.preventDefault(); setHelp(true); }
      else if (e.key.toLowerCase() === 'g') { g = Date.now(); }
      else if (Date.now() - g < 1200) {
        const to = { h: '/', p: '/profile', s: '/settings' }[e.key.toLowerCase()];
        g = 0;
        if (to) nav(to);
        else if (e.key.toLowerCase() === 'l') askLogout();
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [nav, askLogout]);
  if (!help) return null;
  return (
    <Modal title="Keyboard shortcuts" onClose={() => setHelp(false)} footer={<button className="btn p" onClick={() => setHelp(false)}>Close</button>}>
      <dl className="kbdlist">{SHORTCUTS.map(([k, t]) => <div key={k}><dt>{k.split(' then ').map((x, i) => <span key={x}>{i > 0 && ' then '}<kbd>{x}</kbd></span>)}</dt><dd>{t}</dd></div>)}</dl>
    </Modal>
  );
}
