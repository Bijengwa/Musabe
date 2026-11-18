// "Is this paper real?" The QR on a printed paper opens /verify/<type>/<id>?c=<code>. No sign-in: anyone with the paper may check it.
// It tells only: the paper's number, if the seal is still good, if the code on the paper is the code of the paper now, and who signed when.
// Never the lines, the names of payees or the signature pictures.
const express = require('express');
const db = require('../db');
const { HttpError } = require('../lib/util');
const seal = require('../lib/seal');
const docs = require('../lib/docs');

const router = express.Router();
const TYPES = { requisition: docs.requisition, voucher: docs.voucher };

router.get('/:type/:id', async (req, res) => {
  const load = TYPES[req.params.type];
  const id = Number(req.params.id);
  if (!load || !Number.isInteger(id) || id < 1) throw new HttpError(404, 'Paper not found.');
  const content = await load(db, id);
  if (!content) throw new HttpError(404, 'Paper not found.');
  const s = await seal.seal(db, req.params.type, id, content);
  const sigs = await seal.signaturesOf(db, req.params.type, [id]);
  const given = String(req.query.c || '').toUpperCase();
  const matches = given.length > 0 && given === s.code;
  res.set('Cache-Control', 'no-store');
  res.json({
    type: req.params.type, number: content.number, genuine: s.status === 'valid' && matches,
    seal: s.status, codeMatches: matches, reason: s.status === 'broken' ? s.reason : (!matches ? 'The code on the paper is not the code of this paper now.' : null),
    signatures: sigs.map((x) => ({ step: x.step, by: x.user_name, at: x.signed_at })),
  });
});

module.exports = router;
