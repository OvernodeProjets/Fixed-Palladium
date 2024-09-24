const Keyv = require('keyv');
const db = new Keyv("sqlite://storage/database.sqlite");

module.exports = db;