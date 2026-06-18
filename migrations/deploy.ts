// Migrations are an early Anchor feature still in active development.
// Currently the migration file simply does nothing, but it is kept here
// so that `anchor migrate` works without errors.
const anchor = require("@coral-xyz/anchor");

module.exports = async function (provider: typeof anchor.Provider) {
  anchor.setProvider(provider);
  // Add any post-deploy setup steps here (e.g. calling `initialize`).
};
