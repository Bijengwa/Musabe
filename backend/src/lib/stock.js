// Stock changes go through ONE function, so the level and its history never disagree.
// Every call runs inside the caller's transaction: the stock row is locked until the transaction ends,
// so two librarians cannot give the last item twice.
const { HttpError } = require('./util');

// change > 0 adds (delivery confirmed), change < 0 takes out (given, damaged / lost).
// Returns { before, after, reorder, low } — low = this move took the level to the reorder level or below.
async function move(trx, { schoolId, itemId, itemName, change, kind, ref = null, refId = null, note = null, by = null }) {
  if (!Number.isInteger(change) || change === 0) throw new Error('stock.move: change must be a whole number, not 0');
  // schoolId null = the main store (one row per item there).
  schoolId = schoolId ?? null;
  if (schoolId === null) await trx.raw('INSERT INTO stock_levels (school_id, item_id, qty) VALUES (NULL, ?, 0) ON CONFLICT (item_id) WHERE school_id IS NULL DO NOTHING', [itemId]);
  else await trx('stock_levels').insert({ school_id: schoolId, item_id: itemId, qty: 0 }).onConflict(['school_id', 'item_id']).ignore();
  const row = await trx('stock_levels').where({ school_id: schoolId, item_id: itemId }).forUpdate().first();
  const after = row.qty + change;
  if (after < 0) {
    const name = itemName || `Item ${itemId}`;
    if (schoolId === null) throw new HttpError(409, row.qty === 0
      ? `${name}: there is none recorded in the main store. A purchase must be written and confirmed by the accountant office first.`
      : `${name}: only ${row.qty} recorded in the main store, you tried ${-change}.`);
    throw new HttpError(409, row.qty === 0
      ? `${name}: there is no stock of this item recorded in the library. Confirm the incoming stock first, or ask the finance office to send it.`
      : `${name}: only ${row.qty} recorded in the library stock, you tried ${-change}. Confirm the incoming stock first, or ask the finance office.`);
  }
  await trx('stock_levels').where({ school_id: schoolId, item_id: itemId }).update({ qty: after, updated_at: trx.fn.now() });
  await trx('stock_moves').insert({ school_id: schoolId, item_id: itemId, kind, change, balance: after, ref, ref_id: refId, note, by });
  const low = change < 0 && row.reorder_level > 0 && row.qty > row.reorder_level && after <= row.reorder_level;
  return { before: row.qty, after, reorder: row.reorder_level, low };
}

// REC.0001-style numbers for stock papers: DLV.0003, REQ.0012, DMG.0004, ISS.0007, PUR.0002, CNT.0005
const paperNo = (prefix, id) => `${prefix}.${String(id).padStart(4, '0')}`;

module.exports = { move, paperNo };
