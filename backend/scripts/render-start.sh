#!/bin/sh
set -eu

node node_modules/typeorm/cli.js migration:run -d dist/database/data-source.js
node dist/database/seeds/create-admin.seed.js
exec node dist/main.js
