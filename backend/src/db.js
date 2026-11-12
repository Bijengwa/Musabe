const knex = require('knex');
const { runtime } = require('../knexfile');

// The app always uses the restricted runtime account (DATABASE_*), never the migration account.
module.exports = knex(runtime);
