// Help chat (2026-11-20): a button on every account that explains HOW to use the system.
// Safety by design: the AI gets ONLY the how-to notes of the pages this role can open (src/help/pages.js) and the role's name.
// It gets no database data, no tools and no other person's details, so it cannot tell anybody who paid fees, stock numbers,
// names or money. Chats are not saved. Needs ANTHROPIC_API_KEY in .env (HELP_MODEL to change the model).
const express = require('express');
const { HttpError } = require('../lib/util');
const { requireAuth } = require('../auth/session');
const { ROLES, ACCESS } = require('../auth/roles');
const NOTES = require('../help/pages');

const router = express.Router();
router.use(requireAuth);

const MODEL = process.env.HELP_MODEL || 'claude-haiku-5-5';
const PER_HOUR = Number(process.env.HELP_PER_HOUR) || 40;
const used = new Map();   // userId -> [timestamps] (memory only)

function notesFor(role) {
  const pages = Object.keys(ACCESS[role] || {});
  return pages.filter((k) => NOTES[k]).map((k) => `- ${NOTES[k]}${ACCESS[role][k] === 'v' ? ' (You can only VIEW this page.)' : ''}`).join('\n');
}

function systemFor(user) {
  const role = ROLES[user.role]?.label || user.role;
  return `You are the help assistant inside the Musabe Schools system (Musabe English Medium, Musabe Boys Secondary and Musabe Girls Secondary, Mwanza, Tanzania).
You help a ${role}${ROLES[user.role]?.scope === 'all' ? ' in the administration' : ' of one school'} learn HOW to use the pages of their own account.

Rules you must always follow:
1. You have NO access to any data: no students, parents, fees, receipts, money, stock, prices, orders, staff or names. Never state, guess or invent any such data. If asked (e.g. "has X paid fees?", "how much stock is there?"), say you cannot see data and tell them which page of THEIR account shows it, or that it is not part of their work.
2. Only explain the pages listed below for this role. If they ask about work that belongs to another role (for example fees for a store-keeper), say politely that it is not part of their account and who does it, without explaining that other role's pages.
3. Never help anyone get around a rule: no cancelling receipts, no signing for someone else, no sharing passwords or PINs, no approving their own papers.
4. Answer in the language the person writes in (Kiswahili or English). Use simple words and short numbered steps. Keep answers short.
5. If you do not know, say so and suggest asking the Super Admin.

Pages of this ${role} account and how they work:
${notesFor(user.role)}
- ${NOTES._always}`;
}

router.post('/chat', async (req, res) => {
  const key = process.env.ANTHROPIC_API_KEY;
  if (!key) throw new HttpError(424, 'The help chat is not set up yet. Ask the Super Admin.');
  const now = Date.now();
  const mine = (used.get(req.user.id) || []).filter((t) => now - t < 3600000);
  if (mine.length >= PER_HOUR) throw new HttpError(429, 'You asked many questions this hour. Please wait a little.');
  const raw = Array.isArray(req.body?.messages) ? req.body.messages.slice(-12) : [];
  const messages = raw.map((m) => ({ role: m?.role === 'assistant' ? 'assistant' : 'user', content: String(m?.content ?? '').slice(0, 1500) })).filter((m) => m.content.trim());
  if (!messages.length || messages[messages.length - 1].role !== 'user') throw new HttpError(400, 'Write your question.');
  while (messages.length && messages[0].role !== 'user') messages.shift();
  mine.push(now); used.set(req.user.id, mine);
  let r;
  try {
    r = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'x-api-key': key, 'anthropic-version': '2023-06-01' },
      body: JSON.stringify({ model: MODEL, max_tokens: 700, system: systemFor(req.user), messages }),
      signal: AbortSignal.timeout(30000),
    });
  } catch {
    throw new HttpError(424, 'The help chat could not be reached. Check the internet and try again.');
  }
  const d = await r.json().catch(() => null);
  if (!r.ok) throw new HttpError(424, 'The help chat had a problem. Try again in a moment.');
  const text = (d?.content || []).filter((c) => c.type === 'text').map((c) => c.text).join('\n').trim();
  res.json({ reply: text || 'Sorry, I have no answer for that. Ask the Super Admin.' });
});

module.exports = router;
module.exports.systemFor = systemFor;
