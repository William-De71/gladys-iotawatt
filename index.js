// -----------------------------------------------------------------------------
// Entry point of the IoTaWatt external integration.
//
// The IoTaWatt energy monitors of the local network, through their local API
// (http://<device>/status and /query), read only:
//   - devices: the meter (Wi-Fi signal, clock battery, firmware) and one
//     device per input or output (power, energy consumed and exported,
//     voltage, current), offered on the Discovery screen (src/device.js);
//   - scene triggers: unreachable, back online, restarted;
//   - scene action: the energy of a channel over a period;
//   - dashboard widgets: overview, one channel.
//
// This file only wires the SDK client: the handlers are in src/app.js.
//
// Environment variables provided by the Gladys supervisor:
//   GLADYS_HOST_API_URL / GLADYS_INTEGRATION_TOKEN / GLADYS_INTEGRATION_SELECTOR
//   TZ (the timezone of Gladys)
// The SDK reads the first three: `new GladysIntegration()` is enough.
// -----------------------------------------------------------------------------

import { readFileSync } from 'node:fs';
import { GladysIntegration, logger } from '@gladysassistant/integration-sdk';
import { createApp } from './src/app.js';

const { version } = JSON.parse(readFileSync(new URL('./package.json', import.meta.url), 'utf8'));

const gladys = new GladysIntegration();
createApp(gladys);

// --- Startup -----------------------------------------------------------------------
logger.info(`Starting the IoTaWatt integration ${version}...`);
gladys.connect().catch((err) => {
  logger.error('Initial connection failed', err);
  process.exit(1);
});
