// Phone numbers: Tanzanian mobile only, saved as exactly 10 digits (e.g. 0754123456).
// Existing numbers are cleaned (spaces removed, +255 changed to 0). Numbers that cannot be fixed are cleared.
exports.up = async (knex) => {
  await knex.raw(`
    UPDATE users SET phone = CASE
      WHEN regexp_replace(phone, '[^0-9+]', '', 'g') ~ '^0[67][0-9]{8}$' THEN regexp_replace(phone, '[^0-9+]', '', 'g')
      WHEN regexp_replace(phone, '[^0-9+]', '', 'g') ~ '^[+]{0,1}255[67][0-9]{8}$' THEN '0' || right(regexp_replace(phone, '[^0-9]', '', 'g'), 9)
      ELSE NULL END
    WHERE phone IS NOT NULL`);
  await knex.raw(`ALTER TABLE users ADD CONSTRAINT users_phone_tz_chk CHECK (phone IS NULL OR phone ~ '^0[67][0-9]{8}$')`);
};

exports.down = async (knex) => {
  await knex.raw('ALTER TABLE users DROP CONSTRAINT IF EXISTS users_phone_tz_chk');
};
