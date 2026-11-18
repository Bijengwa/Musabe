// Sending an SMS (the sign-in code). Africa's Talking, set in the server's .env:
//   SMS_PROVIDER=africastalking  AT_USERNAME=...  AT_API_KEY=...  AT_SENDER_ID=MUSABE (sender id is optional)
// Not set up: in development the code is written to the server console (never sent to the browser);
// in production nothing is sent, and sign-ins that would need a code are refused with a clear message.
const live = () => process.env.SMS_PROVIDER === 'africastalking' && !!process.env.AT_USERNAME && !!process.env.AT_API_KEY;
const mode = () => (live() ? 'live' : process.env.NODE_ENV === 'production' ? null : 'dev');
// 0754123456 -> +255754123456
const intl = (p) => `+255${String(p || '').replace(/\D/g, '').replace(/^0/, '').replace(/^255/, '')}`;
const hint = (p) => { const d = String(p || '').replace(/\D/g, ''); return d.length >= 9 ? `${d.slice(0, 4)} *** ${d.slice(-3)}` : ''; };

async function send(phone, text) {
  const m = mode();
  if (m === 'dev') { console.log(`\n==== [DEV SMS to ${phone ? intl(phone) : 'no phone'}] ${text} ====\n`); return true; }
  if (m !== 'live') return false;
  const body = new URLSearchParams({ username: process.env.AT_USERNAME, to: intl(phone), message: text });
  if (process.env.AT_SENDER_ID) body.set('from', process.env.AT_SENDER_ID);
  const base = process.env.AT_USERNAME === 'sandbox' ? 'https://api.sandbox.africastalking.com' : 'https://api.africastalking.com';
  const r = await fetch(`${base}/version1/messaging`, { method: 'POST', headers: { apiKey: process.env.AT_API_KEY, Accept: 'application/json', 'Content-Type': 'application/x-www-form-urlencoded' }, body, signal: AbortSignal.timeout(15000) });
  if (!r.ok) return false;
  const j = await r.json().catch(() => null);
  const rec = j?.SMSMessageData?.Recipients?.[0];
  return !!rec && /success/i.test(rec.status || '');
}
module.exports = { send, mode, hint, intl };
