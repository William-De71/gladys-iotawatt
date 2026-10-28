// -----------------------------------------------------------------------------
// What the integration keeps across restarts, under /data (the only writable
// place of the container), in /data/iotawatt.json (mode 0600):
//
//   - `meters`  per IoTaWatt, by MAC address:
//       `address`        where it answered last;
//       `name`, `status` its name and what /status said last (firmware,
//                        Wi-Fi signal, clock battery, uptime);
//       `channels`       its inputs and outputs (parse.js channelsOf), with
//                        their last values;
//       `totals`         the energy indexes per channel (`importWh`,
//                        `exportWh`, energy.js), and `cursor`, the first
//                        second not counted yet: a restart loses nothing;
//       `bidirectional`  the channels seen negative (they get the export
//                        index), `checked` those already looked at;
//       `readAt`, `failures`, `down` reachability for the triggers.
//   - `lastError` the last error (diagnostic).
// Never the password.
// -----------------------------------------------------------------------------

import { readFile, writeFile, rename, mkdir, chmod } from 'node:fs/promises';
import { dirname, join } from 'node:path';

const DEFAULT_DIR = '/data';
const FILE = 'iotawatt.json';
const EMPTY = () => ({ meters: {}, lastError: null });

/**
 * @description Read a JSON file; an absent or broken file is null.
 * @param {string} path - The file.
 * @param {object} [logger] - Logger.
 * @returns {Promise<object|null>} The value.
 */
async function readJson(path, logger) {
  try {
    const value = JSON.parse(await readFile(path, 'utf8'));
    return value && typeof value === 'object' ? value : null;
  } catch (err) {
    if (err.code !== 'ENOENT') {
      logger?.warn(`Unable to read ${path}: ${err.message}`);
    }
    return null;
  }
}

/**
 * @description Write a JSON file atomically (a temporary file, then a
 * rename), readable by its owner only.
 * @param {string} path - The file.
 * @param {object} value - The value.
 * @param {object} [logger] - Logger.
 * @returns {Promise<void>}
 */
async function writeJson(path, value, logger) {
  try {
    await mkdir(dirname(path), { recursive: true });
    const temporary = `${path}.tmp`;
    await writeFile(temporary, JSON.stringify(value), { mode: 0o600 });
    await chmod(temporary, 0o600);
    await rename(temporary, path);
  } catch (err) {
    logger?.warn(`Unable to write ${path}: ${err.message}`);
  }
}

const isObject = (value) => Boolean(value) && typeof value === 'object' && !Array.isArray(value);

/**
 * @description The store.
 * @param {object} [options] - `{ dir, logger }`.
 * @returns {object} `{ data, load, save, reset, path }`.
 */
function createStore({ dir = DEFAULT_DIR, logger } = {}) {
  const path = join(dir, FILE);
  let writing = Promise.resolve();
  const store = {
    path,
    data: EMPTY(),
    /**
     * @description Read the file.
     * @returns {Promise<void>}
     */
    async load() {
      const raw = (await readJson(path, logger)) ?? {};
      const data = EMPTY();
      if (isObject(raw.meters)) {
        for (const [mac, meter] of Object.entries(raw.meters)) {
          if (/^[0-9a-f]{12}$/.test(mac) && isObject(meter)) {
            data.meters[mac] = {
              ...meter,
              mac,
              channels: Array.isArray(meter.channels) ? meter.channels.filter(isObject) : [],
              totals: isObject(meter.totals) ? meter.totals : {},
              bidirectional: isObject(meter.bidirectional) ? meter.bidirectional : {},
              checked: isObject(meter.checked) ? meter.checked : {},
              status: isObject(meter.status) ? meter.status : {},
            };
          }
        }
      }
      data.lastError = isObject(raw.lastError) ? raw.lastError : null;
      store.data = data;
    },
    /**
     * @description Forget everything.
     */
    reset() {
      store.data = EMPTY();
    },
    /**
     * @description Write the state (one write at a time).
     * @returns {Promise<void>}
     */
    save() {
      writing = writing.then(() => writeJson(path, store.data, logger));
      return writing;
    },
  };
  return store;
}

export { DEFAULT_DIR, FILE, createStore };
