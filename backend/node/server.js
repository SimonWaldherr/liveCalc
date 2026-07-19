'use strict';

const path = require('node:path');
const { loadEnvFile } = require('./lib/env');
const { createServerConfig } = require('./lib/provider-config');
const { createLiveCalcServer } = require('./lib/livecalc-server');

const rootDir = path.resolve(__dirname, '../..');
loadEnvFile(path.join(rootDir, '.env'));

const config = createServerConfig(process.env);
const server = createLiveCalcServer({ config, rootDir });

server.listen(config.port, config.host, () => {
  const configuredProviders = Object.values(config.providers)
    .filter((provider) => provider.configured)
    .map((provider) => provider.id)
    .join(', ');
  console.log(
    `LiveCalc Node backend is running at http://${config.host}:${config.port} (AI providers: ${configuredProviders || 'none configured'})`
  );
});
