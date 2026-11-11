// Items and prices from the English Medium sales book (UNIFORM SALES-2026.xlsx).
// Only adds items that are missing. Boys and Girls Secondary prices are set by the Finance Manager in the app.
const ITEMS = [
  ['SCHOOL UNIFORM', 'uniform', 36000], ['CASUAL UNIFORM', 'uniform', 31000], ['ISLAMIC UNIFORM', 'uniform', 40000],
  ['TRACK SUIT', 'uniform', 31000], ['SPORT WEAR', 'uniform', 70000], ['SWEATER', 'uniform', 21000], ['T-SHIRT', 'uniform', 16000],
  ['SHAMBA DRESS', 'uniform', 31000], ['SARE ZA KUSHINDIA', 'uniform', 31000], ['SOCKS', 'uniform', 5000], ['BELT', 'uniform', 5000],
  ['NDOO NA BESENI', 'other', 8000], ['NET', 'other', 8000], ['BLANKET', 'other', 30000], ['BED SHEET', 'other', 21000],
  ['SHUKA', 'other', 21000], ['MASHUKA', 'other', 20000], ['CHANDARUA', 'other', 8000], ['USHUNGI', 'other', 20000],
];
// Special Uniform: boys 36,000, girls 41,000
const GENDER_ITEMS = [['SPECIAL UNIFORM', 'uniform', 36000, 41000]];

exports.seed = async (knex) => {
  const em = await knex('schools').where({ code: 'pre' }).first();
  if (!em) return;
  const add = async (name, category, genderPriced, price) => {
    if (await knex('items').whereRaw('lower(name) = ?', [name.toLowerCase()]).first()) return;
    const [{ id }] = await knex('items').insert({ name, category, gender_priced: genderPriced }).returning('id');
    await knex('item_prices').insert({ item_id: id, school_id: em.id, ...price });
  };
  for (const [n, c, p] of ITEMS) await add(n, c, false, { price: p });
  for (const [n, c, b, g] of GENDER_ITEMS) await add(n, c, true, { price_boys: b, price_girls: g });
};
