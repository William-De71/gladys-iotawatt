// -----------------------------------------------------------------------------
// The IoTaWatt integration: every handler, registered on a Gladys client.
//
// Brings the IoTaWatt energy monitors of the local network into Gladys,
// through their local API (read only):
//   - devices (device.js): the meter itself, and one device per input or
//     output (power, energy drawn and exported, voltage, current);
//   - scene triggers (events.js): unreachable, back online, restarted;
//   - scene action: the energy of a channel over a period;
//   - dashboard widgets (widgets.js): overview, one channel;
//   - configuration buttons: search and test, diagnostic.
//
// Pace: a timer reads the /status of each IoTaWatt every 10, 30 or 60 s
// (power, voltage, Wi-Fi…), and once a minute the energy of the minutes not
// counted yet (energy.js). The series names are read again every 10 minutes
// or when the inputs change. The IoTaWatt devices are looked for (typed
// addresses, mDNS through the Gladys core) at startup, on a scan, and every
// 30 minutes while one is missing or unreachable (its address may have
// changed: a meter is known by its MAC address, not by its address).
//
// index.js only creates the SDK client; the tests drive this module with the
// fake Gladys of the SDK and a fake IoTaWatt (test/helpers/fake-iotawatt.js).
// -----------------------------------------------------------------------------

import { readFileSync } from 'node:fs';
import { logger as sdkLogger } from '@gladysassistant/integration-sdk';
import {
  normalizeConfig,
  readLanguage,
  guessLanguage,
  INTERNAL_KEYS,
  AUTO_LANGUAGE,
} from './config.js';
import { createIotaWattClient } from './iotawatt-api.js';
import { createStore } from './store.js';
import { parseStatus, parseSeries, channelsOf, parseRows, UNITS } from './parse.js';
import { mdnsCandidates } from './discovery.js';
import { nextWindow, energySelect, addEnergy, negativeKeys } from './energy.js';
import {
  meterIds,
  channelIds,
  targetOf,
  meterName,
  prettyName,
  buildMeterDevices,
  buildMeterStates,
} from './device.js';
import {
  SCENE_ACTIONS,
  ENERGY_OUTPUTS,
  PERIODS,
  DEFAULT_PERIOD,
  pick,
  rounded,
  detectMeter,
} from './events.js';
import {
  WIDGETS,
  VIEWS,
  messageContent,
  buildOverviewWidget,
  buildChannelWidget,
} from './widgets.js';
import { MINUTE_MS, defaultTimeZone, usableTimeZone } from './time.js';
import { t, all, formatNumber, LANGUAGES } from './i18n.js';

const ACTIONS = {
  SEARCH: 'search',
  DIAGNOSTIC: 'diagnostic',
};
const STARTUP_DELAY_MS = 3 * 1000;
const ENERGY_EVERY_MS = MINUTE_MS;
const SERIES_EVERY_MS = 10 * MINUTE_MS;
const DISCOVERY_EVERY_MS = 30 * MINUTE_MS;
const MDNS_TIMEOUT_S = 5;
// Re-send unchanged values now and then, so that Gladys does not show them as outdated.
const HEARTBEAT_MS = 30 * MINUTE_MS;
const HISTORY_CACHE_MS = 5 * MINUTE_MS;
const DIAGNOSTIC_CHUNK = 3000;
const { version: VERSION } = JSON.parse(
  readFileSync(new URL('../package.json', import.meta.url), 'utf8'),
);

/**
 * @description Register every handler of the integration on a Gladys client.
 * @param {object} gladys - A GladysIntegration (or the fake Gladys of the SDK).
 * @param {object} [options] - Options.
 * @param {Function} [options.get] - HTTP transport of the IoTaWatt devices (tests).
 * @param {string} [options.dataDir] - The writable folder (/data).
 * @param {Function} [options.now] - `() => number` in ms (tests).
 * @param {Function} [options.sleep] - `(ms) => Promise` (tests).
 * @param {string} [options.timeZone] - IANA timezone of Gladys (TZ by default).
 * @param {boolean} [options.timers] - Arm the reading timer (false in tests).
 * @param {object} [options.logger] - Logger.
 * @returns {object} Handles for the tests.
 */
function createApp(
  gladys,
  {
    get,
    dataDir,
    now = () => Date.now(),
    sleep,
    timeZone: zone = defaultTimeZone(),
    timers = true,
    logger = sdkLogger,
  } = {},
) {
  const timeZone = usableTimeZone(zone);
  let config = normalizeConfig();
  let language = guessLanguage(timeZone);
  let createdNames = new Map();
  let lastStatus = null;
  let lastDiscovery = null;
  let discoveredAddresses = [];
  let discoveredAt = 0;
  let timer = null;
  let startTimer = null;
  let running = null;
  let stopped = false;
  const clients = new Map();
  const notIotaWatt = new Map();
  const historyCache = new Map();

  const store = createStore({ ...(dataDir ? { dir: dataDir } : {}), logger });

  /**
   * @description The client of an address (one per address: its queue and its Digest session).
   * @param {string} address - The address.
   * @returns {object} The client.
   */
  function clientOf(address) {
    if (!clients.has(address)) {
      clients.set(
        address,
        createIotaWattClient({
          address,
          getCredentials: () => ({ username: config.username, password: config.password }),
          ...(get ? { get } : {}),
          ...(sleep ? { sleep } : {}),
        }),
      );
    }
    return clients.get(address);
  }

  const meters = () => Object.values(store.data.meters);

  /**
   * @description Remember the language of a widget request, and store it when it changed.
   * @param {string} next - The language.
   */
  function rememberLanguage(next) {
    if (!LANGUAGES.includes(next) || next === language) {
      return;
    }
    language = next;
    gladys
      .setConfig({ [INTERNAL_KEYS.language]: next })
      .catch((err) => logger.warn(`Unable to store the language: ${err.message}`));
  }

  /**
   * @description Language of the texts Gladys does not ask for in a language.
   * @returns {string} The language.
   */
  const textLanguage = () => (config.language === AUTO_LANGUAGE ? language : config.language);

  // --- Names -------------------------------------------------------------------------

  /**
   * @description The name of a meter: the one the user gave it in Gladys, else its own.
   * @param {object} meter - The stored meter.
   * @returns {string} The name.
   */
  const nameOfMeter = (meter) =>
    createdNames.get(meterIds(gladys, meter.mac).device) || meterName(meter);

  /**
   * @description The name of a channel: the one the user gave it in Gladys, else the series name.
   * @param {object} meter - The stored meter.
   * @param {object} channel - The channel.
   * @returns {string} The name.
   */
  const nameOfChannel = (meter, channel) =>
    createdNames.get(channelIds(gladys, meter.mac, channel.key).device) || prettyName(channel.name);

  /**
   * @description The meter and the channel a widget or a scene points to.
   * @param {unknown} externalId - A `source: "devices"` value.
   * @param {object} [options] - `{ power }`: only a power channel will do.
   * @returns {{ meter: object|null, channel: object|null }} The target; the first by default.
   */
  function resolve(externalId, { power = false } = {}) {
    const target = targetOf(externalId);
    const meter = (target && store.data.meters[target.mac]) || meters()[0] || null;
    if (!meter) {
      return { meter: null, channel: null };
    }
    const usable = (channel) =>
      channel.series && (power ? channel.unit === UNITS.WATTS : channel.supported);
    const wanted =
      target?.key && target.mac === meter.mac
        ? meter.channels.find((channel) => channel.key === target.key && usable(channel))
        : null;
    return { meter, channel: wanted ?? meter.channels.find(usable) ?? null };
  }

  // --- Errors and status -------------------------------------------------------------

  /**
   * @description The message of an error, for a user.
   * @param {object} err - The error (`kind`).
   * @param {string} lang - The language.
   * @returns {string} The message.
   */
  function errorText(err, lang) {
    const key = {
      auth: 'errAuth',
      unreachable: 'errUnreachable',
      invalid: 'errNotIotaWatt',
      http: 'errNotIotaWatt',
    }[err?.kind];
    if (key) {
      return t(key, lang, { address: err.address ?? '' });
    }
    return t('errFailed', lang, { detail: String(err?.message ?? '').slice(0, 120) });
  }

  /**
   * @description Report the connection status, only when it changed.
   * @param {boolean} connected - Connected or not.
   * @param {object} message - The multi-language message.
   * @returns {Promise<void>}
   */
  async function reportStatus(connected, message) {
    const clipped = Object.fromEntries(
      Object.entries(message).map(([lang, text]) => [lang, text.slice(0, 200)]),
    );
    const signature = JSON.stringify([connected, clipped]);
    if (signature === lastStatus) {
      return;
    }
    lastStatus = signature;
    try {
      await gladys.setConnectionStatus(connected, clipped);
    } catch (err) {
      lastStatus = null;
      logger.error('Unable to report the connection status', err);
    }
  }

  /**
   * @description Work out the connection status.
   * @returns {Promise<void>}
   */
  async function refreshStatus() {
    const list = meters();
    if (!list.length) {
      const error = store.data.lastError;
      await reportStatus(
        false,
        all((lang) => (error?.kind === 'auth' ? errorText(error, lang) : t('statusNoMeter', lang))),
      );
      return;
    }
    const down = list.filter((meter) => meter.seen?.down);
    if (down.length === list.length) {
      await reportStatus(false, all('statusDown', { names: down.map(nameOfMeter).join(', ') }));
      return;
    }
    const channels = list.reduce(
      (sum, meter) => sum + meter.channels.filter((channel) => channel.supported).length,
      0,
    );
    await reportStatus(
      true,
      all((lang) =>
        [
          t('statusOk', lang, { meters: list.length, channels }),
          ...(down.length
            ? [t('statusSomeDown', lang, { names: down.map(nameOfMeter).join(', ') })]
            : []),
        ].join(' '),
      ),
    );
  }

  /**
   * @description Refresh the devices the user created, and their names.
   * @returns {Promise<void>}
   */
  async function refreshCreatedDevices() {
    try {
      const devices = await gladys.getDevices();
      createdNames = new Map(devices.map((device) => [device.external_id, device.name ?? '']));
    } catch (err) {
      logger.warn(`Unable to read the devices: ${err.message}`);
    }
  }

  /**
   * @description Ask the open widgets to pull their content again.
   */
  function refreshWidgets() {
    for (const key of Object.values(WIDGETS)) {
      Promise.resolve(gladys.requestWidgetRefresh(key)).catch(() => {});
    }
  }

  /**
   * @description Publish scene events, one by one.
   * @param {Array<{ key: string, data: object }>} events - The events.
   * @returns {Promise<void>}
   */
  async function publishEvents(events) {
    for (const { key, data } of events) {
      logger.info(`IoTaWatt: ${key} (${data.meter_name})`);
      try {
        await gladys.publishSceneEvent(key, data);
      } catch (err) {
        logger.warn(`Unable to fire ${key}: ${err.message}`);
      }
    }
  }

  // --- Devices -----------------------------------------------------------------------

  /**
   * @description Offer the devices of every meter, when they changed.
   * @param {boolean} [force] - Publish even when unchanged.
   * @returns {Promise<number>} How many devices were offered.
   */
  async function publishDiscoveredDevices(force = false) {
    const lang = textLanguage();
    const devices = meters().flatMap((meter) =>
      buildMeterDevices(gladys, meter, { language: lang }),
    );
    const signature = JSON.stringify(devices);
    if (force || signature !== lastDiscovery) {
      await gladys.publishDiscoveredDevices(devices);
      lastDiscovery = signature;
    }
    return devices.length;
  }

  /**
   * @description Publish the states of the created devices.
   * @returns {Promise<void>}
   */
  async function publishAllStates() {
    for (const meter of meters()) {
      if (meter.seen?.down) {
        // Unreachable: the values age, Gladys shows them as outdated.
        continue;
      }
      const states = buildMeterStates(gladys, meter).filter((state) =>
        createdNames.has(state.device_feature_external_id.replace(/:[a-z_]+$/, '')),
      );
      if (!states.length) continue;
      await gladys
        .publishChangedStates(states, { heartbeat: HEARTBEAT_MS })
        .catch((err) =>
          logger.warn(`Unable to publish the states of ${meter.mac}: ${err.message}`),
        );
    }
  }

  // --- Reading -----------------------------------------------------------------------

  /**
   * @description Note an error.
   * @param {Error} err - The error.
   * @param {string} address - The address.
   */
  function noteError(err, address) {
    const kind = err.kind ?? 'failed';
    logger.warn(`IoTaWatt ${address} (${kind}): ${err.message}`);
    store.data.lastError = { kind, address, message: String(err.message).slice(0, 200), at: now() };
  }

  /**
   * @description The addresses to read: typed, found by mDNS, last known.
   * @returns {string[]} The addresses.
   */
  function addresses() {
    const known = meters()
      .map((meter) => meter.address)
      .filter(Boolean);
    return [...new Set([...config.hosts, ...known, ...discoveredAddresses])].filter(
      (address) => !(notIotaWatt.get(address) > now()),
    );
  }

  /**
   * @description Look for IoTaWatt devices with mDNS (through the Gladys core).
   * @returns {Promise<void>}
   */
  async function discover() {
    discoveredAt = now();
    try {
      const services = await gladys.scanNetwork('mdns', { timeoutSeconds: MDNS_TIMEOUT_S });
      discoveredAddresses = mdnsCandidates(services);
      logger.info(`mDNS: ${discoveredAddresses.length} candidate(s)`);
    } catch (err) {
      logger.warn(`mDNS scan failed: ${err.message}`);
    }
  }

  /**
   * @description The first look at new power series: were they negative over the last 7 days?
   * @param {object} client - The client.
   * @param {object} meter - The stored meter.
   * @returns {Promise<boolean>} Whether a channel became bidirectional.
   */
  async function checkDirections(client, meter) {
    const unchecked = meter.channels.filter(
      (channel) => channel.unit === UNITS.WATTS && channel.series && !meter.checked[channel.key],
    );
    if (!unchecked.length) return false;
    const rows = parseRows(
      await client.query({
        select: unchecked.map((channel) => `${channel.series}.wh.d1`),
        begin: 's-7d',
        end: 's',
        group: '1h',
      }),
    );
    let changed = false;
    for (const key of negativeKeys(
      rows,
      unchecked.map((channel) => channel.key),
    )) {
      if (!meter.bidirectional[key]) {
        meter.bidirectional[key] = true;
        changed = true;
      }
    }
    for (const channel of unchecked) meter.checked[channel.key] = true;
    return changed;
  }

  /**
   * @description Count the energy of the minutes logged since the last count.
   * @param {object} client - The client.
   * @param {object} meter - The stored meter.
   * @param {number|null} lastKey - The last logged point.
   * @returns {Promise<boolean>} Whether a channel became bidirectional.
   */
  async function countEnergy(client, meter, lastKey) {
    const power = meter.channels.filter(
      (channel) => channel.unit === UNITS.WATTS && channel.series,
    );
    const window = nextWindow(meter.cursor, lastKey);
    if (!window || !power.length) return false;
    meter.energyAt = now();
    if (window.start) {
      // The indexes start at 0, now: Gladys only uses their increases.
      for (const channel of power) meter.totals[channel.key] ??= { importWh: 0, exportWh: 0 };
      meter.cursor = window.end;
      return false;
    }
    const rows = parseRows(
      await client.query({
        select: energySelect(power.map((channel) => channel.series)),
        begin: window.begin,
        end: window.end,
        group: '1m',
      }),
    );
    const { cursor, negative } = addEnergy({
      rows,
      keys: power.map((channel) => channel.key),
      totals: meter.totals,
      window,
    });
    meter.cursor = cursor;
    let changed = false;
    for (const key of negative) {
      if (!meter.bidirectional[key]) {
        meter.bidirectional[key] = true;
        changed = true;
      }
    }
    return changed;
  }

  /**
   * @description Whether an address is the last known one of a meter (a passing
   * HTTP error of a real IoTaWatt never sets it aside).
   * @param {string} address - The address.
   * @returns {boolean} True for a meter address.
   */
  const isMeterAddress = (address) => meters().some((meter) => meter.address === address);

  /**
   * @description Read one address.
   * @param {string} address - The address.
   * @param {Set<string>} done - The MAC addresses already read this round.
   * @returns {Promise<{ mac: string|null, changed: boolean, error: object|null }>} What happened.
   */
  async function readAddress(address, done) {
    const client = clientOf(address);
    let status;
    try {
      status = parseStatus(await client.status());
    } catch (err) {
      err.address = address;
      noteError(err, address);
      if ((err.kind === 'invalid' || err.kind === 'http') && !isMeterAddress(address)) {
        // Not an IoTaWatt (another web server announced over mDNS): leave it alone a while.
        notIotaWatt.set(address, now() + DISCOVERY_EVERY_MS);
      }
      return { mac: null, changed: false, error: err };
    }
    if (!status.mac || !status.firmware) {
      const err = Object.assign(new Error(`${address}: not the answer of an IoTaWatt`), {
        kind: 'invalid',
        address,
      });
      noteError(err, address);
      if (!isMeterAddress(address)) notIotaWatt.set(address, now() + DISCOVERY_EVERY_MS);
      return { mac: null, changed: false, error: err };
    }
    if (done.has(status.mac)) {
      return { mac: status.mac, changed: false, error: null };
    }
    done.add(status.mac);
    const known = Boolean(store.data.meters[status.mac]);
    const meter = (store.data.meters[status.mac] ??= {
      mac: status.mac,
      channels: [],
      totals: {},
      bidirectional: {},
      checked: {},
      status: {},
      cursor: 0,
    });
    if (!known) {
      logger.info(`IoTaWatt found: ${status.name ?? '?'} (${status.mac}) at ${address}`);
    }
    const before = JSON.stringify([
      meter.name,
      meter.channels.map((channel) => [channel.key, channel.name, channel.unit]),
    ]);
    meter.address = address;
    meter.name = status.name;
    meter.status = {
      firmware: status.firmware,
      rssi: status.rssi,
      lowBattery: status.lowBattery,
      uptime: status.uptime,
      ip: status.ip,
    };
    meter.readAt = now();
    let changed = false;
    const shape = JSON.stringify(status.inputs.map((input) => [input.channel, input.kind]));
    try {
      if (
        !meter.series ||
        now() - (meter.seriesAt ?? 0) >= SERIES_EVERY_MS ||
        shape !== meter.shape
      ) {
        meter.series = parseSeries(await client.series());
        meter.seriesAt = now();
        meter.shape = shape;
      }
      meter.channels = channelsOf(status, meter.series);
      changed =
        JSON.stringify([
          meter.name,
          meter.channels.map((channel) => [channel.key, channel.name, channel.unit]),
        ]) !== before;
      changed = (await checkDirections(client, meter)) || changed;
      if (now() - (meter.energyAt ?? 0) >= ENERGY_EVERY_MS - 1000) {
        changed = (await countEnergy(client, meter, status.lastKey)) || changed;
      }
    } catch (err) {
      // The status was read: the meter answers; only a query failed.
      err.address = address;
      noteError(err, address);
      meter.channels = channelsOf(status, meter.series ?? []);
    }
    return { mac: status.mac, changed: changed || !known, error: null };
  }

  /**
   * @description One reading round of every IoTaWatt.
   * @param {object} [options] - `{ rediscover }`: look for devices first.
   * @returns {Promise<{ found: string[], errors: object[] }>} The MAC addresses read and the errors.
   */
  async function runReading({ rediscover = false } = {}) {
    const missing = config.hosts.length === 0 && meters().length === 0;
    const someDown = meters().some((meter) => meter.seen?.down);
    if (rediscover || ((missing || someDown) && now() - discoveredAt >= DISCOVERY_EVERY_MS)) {
      await discover();
    }
    const done = new Set();
    const errors = [];
    let changed = false;
    const events = [];
    const lang = textLanguage();
    for (const address of addresses()) {
      const result = await readAddress(address, done);
      if (result.error) errors.push(result.error);
      changed = changed || result.changed;
    }
    // Reachability and restarts, once per meter.
    for (const meter of meters()) {
      const ok = done.has(meter.mac);
      const found = detectMeter(meter.seen, {
        ok,
        uptime: meter.status?.uptime ?? null,
        now: now(),
      });
      const wasDown = Boolean(meter.seen?.down);
      meter.seen = found.next;
      if (wasDown !== Boolean(meter.seen.down)) changed = true;
      for (const event of found.events) {
        events.push({
          key: event.key,
          data: {
            meter: meterIds(gladys, meter.mac).device,
            meter_name: nameOfMeter(meter).slice(0, 200),
            address: meter.address ?? '',
            mac: meter.mac,
            ...event.data,
            message: t(`event_${event.key}`, lang, { name: nameOfMeter(meter) }).slice(0, 1000),
          },
        });
      }
    }
    if (done.size) store.data.lastError = errors.length ? store.data.lastError : null;
    await store.save();
    if (changed) {
      await publishDiscoveredDevices().catch((err) =>
        logger.warn(`Unable to offer the devices: ${err.message}`),
      );
    }
    await publishAllStates();
    if (events.length) await publishEvents(events);
    if (changed || events.length) refreshWidgets();
    await refreshStatus();
    return { found: [...done], errors };
  }

  /**
   * @description One round of the timer.
   * @returns {Promise<void>}
   */
  function tick() {
    if (!running) {
      running = runReading()
        .catch((err) => logger.error('Readings', err))
        .finally(() => {
          running = null;
        });
    }
    return running;
  }

  /**
   * @description (Re)arm the reading timer.
   */
  function schedule() {
    clearInterval(timer);
    clearTimeout(startTimer);
    if (!timers || stopped) {
      return;
    }
    startTimer = setTimeout(tick, STARTUP_DELAY_MS);
    startTimer.unref?.();
    timer = setInterval(tick, config.interval * 1000);
    timer.unref?.();
  }

  /**
   * @description Offer the devices, publish what is known, arm the timer.
   * @returns {Promise<void>}
   */
  async function applyConfig() {
    await store.save();
    await publishDiscoveredDevices().catch((err) =>
      logger.warn(`Unable to offer the devices: ${err.message}`),
    );
    await publishAllStates();
    await refreshStatus();
    schedule();
  }

  // --- History (widget) --------------------------------------------------------------

  /**
   * @description The rows of a query as chart points.
   * @param {Array<Array<number|null>>} rows - `[time, value]` rows.
   * @param {number} [divide] - Divide the values (Wh -> kWh).
   * @returns {Array<{ t: string, v: number }>} The points.
   */
  const pointsOf = (rows, divide = 1) =>
    rows
      .filter((row) => Number.isFinite(row[0]) && Number.isFinite(row[1]))
      .map((row) => ({
        t: new Date(row[0] * 1000).toISOString(),
        v: rounded(row[1] / divide, divide === 1 ? 1 : 3),
      }));

  /**
   * @description The history of a channel for its widget, asked to the IoTaWatt (cached 5 minutes).
   * @param {object} meter - The stored meter.
   * @param {object} channel - The channel.
   * @param {string} view - A VIEWS value.
   * @returns {Promise<object|null>} `{ today, yesterday, points }`, null when it failed.
   */
  async function historyOf(meter, channel, view) {
    const cacheKey = `${meter.mac}|${channel.key}|${view}`;
    const cached = historyCache.get(cacheKey);
    if (cached && now() - cached.at < HISTORY_CACHE_MS) {
      return cached.value;
    }
    const client = clientOf(meter.address);
    const time = 'time.utc.unix';
    let value;
    try {
      if (channel.unit === UNITS.WATTS) {
        const days = parseRows(
          await client.query({
            select: [time, `${channel.series}.wh.d3`],
            begin: 'd-1d',
            end: 's',
            group: '1d',
          }),
        );
        const spec = {
          [VIEWS.ENERGY_DAYS]: { method: 'wh.d0', begin: 'd-13d', group: '1d', divide: 1000 },
          [VIEWS.ENERGY_MONTHS]: { method: 'wh.d0', begin: 'M-11M', group: '1M', divide: 1000 },
        }[view] ?? { method: 'watts.d0', begin: 's-24h', group: '5m', divide: 1 };
        const rows = parseRows(
          await client.query({
            select: [time, `${channel.series}.${spec.method}`],
            begin: spec.begin,
            end: 's',
            group: spec.group,
          }),
        );
        const kwh = (row) => (row && Number.isFinite(row[1]) ? row[1] / 1000 : null);
        value = {
          yesterday: kwh(days[0]),
          today: kwh(days[1]),
          points: pointsOf(rows, spec.divide),
        };
      } else {
        const method = channel.unit === UNITS.VOLTS ? '.volts.d1' : '';
        const rows = parseRows(
          await client.query({
            select: [time, `${channel.series}${method}`],
            begin: 's-24h',
            end: 's',
            group: '5m',
          }),
        );
        value = { today: null, yesterday: null, points: pointsOf(rows) };
      }
    } catch (err) {
      logger.warn(`History of ${channel.name}: ${err.message}`);
      return null;
    }
    historyCache.set(cacheKey, { at: now(), value });
    return value;
  }

  // --- Dashboard widgets -------------------------------------------------------------

  /**
   * @description The message a widget shows when there is no meter.
   * @param {string} lang - The language.
   * @returns {object|null} The content, null when there are meters.
   */
  function widgetMessage(lang) {
    if (meters().length) return null;
    const error = store.data.lastError;
    return messageContent(
      error?.kind === 'auth' ? errorText(error, lang) : t('statusNoMeter', lang),
    );
  }

  gladys.onWidgetGet(WIDGETS.OVERVIEW, async ({ settings = {}, language: lang } = {}) => {
    rememberLanguage(lang);
    const message = widgetMessage(lang);
    if (message) return message;
    const { meter } = resolve(settings.meter);
    return buildOverviewWidget({
      meter,
      name: nameOfMeter(meter),
      channelName: (channel) => nameOfChannel(meter, channel),
      language: lang,
      now: now(),
    });
  });

  gladys.onWidgetGet(WIDGETS.CHANNEL, async ({ settings = {}, language: lang } = {}) => {
    rememberLanguage(lang);
    const message = widgetMessage(lang);
    if (message) return message;
    const { meter, channel } = resolve(settings.channel);
    if (!channel) {
      return messageContent(t('errNoChannel', lang));
    }
    const view = Object.values(VIEWS).includes(settings.view) ? settings.view : VIEWS.POWER_DAY;
    const down = Boolean(meter.seen?.down);
    return buildChannelWidget({
      channel,
      name: nameOfChannel(meter, channel),
      down,
      view,
      history: down ? null : await historyOf(meter, channel, view),
      language: lang,
    });
  });

  // --- Scene action ------------------------------------------------------------------

  gladys.onSceneAction(SCENE_ACTIONS.GET_ENERGY, async (fields = {}) => {
    const lang = textLanguage();
    const { meter, channel } = resolve(fields.channel, { power: true });
    if (!meter) {
      throw new Error(t('statusNoMeter', lang));
    }
    if (!channel) {
      throw new Error(t('errNoChannel', lang));
    }
    const period = Object.hasOwn(PERIODS, fields.period) ? fields.period : DEFAULT_PERIOD;
    const [begin, end] = PERIODS[period];
    const answer = await clientOf(meter.address).query({
      select: [`${channel.series}.wh.d3`, `${channel.series}.watts.d1`],
      begin,
      end,
      group: 'all',
      header: true,
    });
    const [row] = parseRows(answer);
    const range = Array.isArray(answer?.range) ? answer.range : [];
    const iso = (seconds) =>
      Number.isFinite(seconds) ? new Date(seconds * 1000).toISOString() : null;
    const kwh = row && Number.isFinite(row[0]) ? rounded(row[0] / 1000, 3) : null;
    const watts = row && Number.isFinite(row[1]) ? rounded(row[1], 1) : null;
    const name = nameOfChannel(meter, channel);
    return pick(
      {
        channel_name: name,
        energy_kwh: kwh,
        average_watts: watts,
        period_start: iso(range[0]),
        period_end: iso(range[1]),
        summary: t('summaryEnergy', lang, {
          name,
          period: t(`period_${period}`, lang),
          energy: Number.isFinite(kwh) ? formatNumber(kwh, lang, 2) : '–',
          average: Number.isFinite(watts) ? formatNumber(watts, lang, 0) : '–',
        }).slice(0, 1000),
      },
      ENERGY_OUTPUTS,
    );
  });

  // --- Configuration screen actions --------------------------------------------------

  gladys.onAction(ACTIONS.SEARCH, async () => {
    const { found, errors } = await runReading({ rediscover: true });
    lastStatus = null;
    await refreshStatus();
    await publishDiscoveredDevices(true).catch((err) =>
      logger.warn(`Unable to offer the devices: ${err.message}`),
    );
    if (!found.length) {
      const error =
        errors.find((err) => err.kind === 'auth') ??
        errors.find((err) => config.hosts.includes(err.address));
      return all((lang) => (error ? errorText(error, lang) : t('searchNone', lang)).slice(0, 1000));
    }
    const names = found.map((mac) => nameOfMeter(store.data.meters[mac])).join(', ');
    return all((lang) => t('searchOk', lang, { count: found.length, names }).slice(0, 1000));
  });

  gladys.onAction(ACTIONS.DIAGNOSTIC, async () => {
    const iso = (value) => (Number.isFinite(value) && value ? new Date(value).toISOString() : null);
    const report = {
      version: VERSION,
      timeZone,
      hosts: config.hosts,
      username: config.username,
      password: config.password ? 'set' : 'missing',
      interval: config.interval,
      language: config.language,
      mdns: { at: iso(discoveredAt), candidates: discoveredAddresses },
      lastError: store.data.lastError,
      clients: Object.fromEntries(
        [...clients].map(([address, client]) => [address, client.counts()]),
      ),
      meters: meters().map((meter) => ({
        mac: meter.mac,
        address: meter.address,
        name: meter.name,
        status: meter.status,
        readAt: iso(meter.readAt),
        seen: meter.seen,
        cursor: iso(meter.cursor * 1000),
        created: createdNames.has(meterIds(gladys, meter.mac).device),
        channels: meter.channels.map((channel) => ({
          key: channel.key,
          name: channel.name,
          series: channel.series,
          unit: channel.unit,
          value: channel.value,
          supported: channel.supported,
          bidirectional: Boolean(meter.bidirectional[channel.key]),
          totals: meter.totals[channel.key] ?? null,
          created: createdNames.has(channelIds(gladys, meter.mac, channel.key).device),
        })),
      })),
    };
    const json = JSON.stringify(report);
    const count = Math.max(1, Math.ceil(json.length / DIAGNOSTIC_CHUNK));
    for (let chunk = 0; chunk < count; chunk += 1) {
      logger.info(
        `IoTaWatt diagnostic ${chunk + 1}/${count}: ${json.slice(chunk * DIAGNOSTIC_CHUNK, (chunk + 1) * DIAGNOSTIC_CHUNK)}`,
      );
    }
    return all('diagnosticDone', { count });
  });

  // --- Devices -----------------------------------------------------------------------
  gladys.onScanRequest(async () => {
    await runReading({ rediscover: true });
    const count = await publishDiscoveredDevices(true);
    logger.info(`Scan: ${count} device(s) offered`);
  });

  gladys.onDeviceCreated(async () => {
    await refreshCreatedDevices();
    // States sent before the device existed were dropped by Gladys, and the SDK
    // forgot what it sent for this device: send everything known again.
    await publishAllStates();
    refreshWidgets();
  });

  gladys.onDeviceUpdated(refreshCreatedDevices);
  gladys.onDeviceDeleted(refreshCreatedDevices);

  // --- Configuration -----------------------------------------------------------------

  /**
   * @description Reload the whole config (internal keys included).
   * @param {object} [fallback] - Raw values to use when the read fails.
   * @returns {Promise<void>}
   */
  async function loadConfig(fallback) {
    try {
      const raw = await gladys.getConfig();
      config = normalizeConfig(raw);
      language = readLanguage(raw, language);
    } catch (err) {
      if (fallback) {
        config = normalizeConfig(fallback);
      }
      logger.error('Unable to read the configuration', err);
    }
  }

  gladys.onConfigUpdated(async (rawConfig) => {
    const previous = config;
    await loadConfig(rawConfig);
    logger.info('Configuration updated');
    lastStatus = null;
    lastDiscovery = null;
    if (previous.username !== config.username || previous.password !== config.password) {
      // New credentials: new Digest sessions.
      clients.clear();
    }
    if (previous.hosts.join() !== config.hosts.join()) {
      notIotaWatt.clear();
      discoveredAt = 0;
    }
    await applyConfig();
  });

  // --- Connection lifecycle ----------------------------------------------------------
  // Each (re)connection resynchronizes; the promise lets the tests wait for it.
  let startup = Promise.resolve();
  gladys.on('connected', () => {
    startup = (async () => {
      await store.load();
      await loadConfig();
      await refreshCreatedDevices();
      lastStatus = null;
      lastDiscovery = null;
      await applyConfig();
    })().catch((err) => logger.error('Startup', err));
  });

  // --- Graceful shutdown -------------------------------------------------------------
  gladys.handleShutdown(async (signal) => {
    logger.info(`Received ${signal} -> graceful shutdown`);
    stopped = true;
    clearInterval(timer);
    clearTimeout(startTimer);
    await running?.catch(() => {});
    await store.save();
  });

  return {
    store,
    tick,
    runReading,
    resolve,
    getConfig: () => config,
    whenReady: () => startup,
  };
}

export { createApp, ACTIONS, HEARTBEAT_MS, ENERGY_EVERY_MS, SERIES_EVERY_MS, DISCOVERY_EVERY_MS };
