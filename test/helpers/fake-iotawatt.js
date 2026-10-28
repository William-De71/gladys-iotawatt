// A fake IoTaWatt network for the tests: the `get` transport of the client
// (src/iotawatt-api.js), answering /status, /query?show=series and
// /query?select=… like the firmware does (shapes from the documentation and
// the firmware sources), on a fake clock. Optional HTTP Digest, checked like
// the firmware (auth.cpp): a session per nonce, `nc` increasing.
// Nothing starts on import (node --test also runs this folder).

import { createHash, randomBytes } from 'node:crypto';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const md5 = (text) => createHash('md5').update(text, 'utf8').digest('hex');

/**
 * @description A made-up IoTaWatt: 1 VT, 4 CT inputs (channel 3 is unused), 3 outputs.
 * @param {object} [overrides] - Fields to replace.
 * @returns {object} The device.
 */
function sampleDevice(overrides = {}) {
  return {
    name: 'IotaWatt',
    mac: '5C:CF:7F:12:34:56',
    firmware: '02_08_04',
    ip: '192.168.1.20',
    rssi: -61,
    lowbat: false,
    startedAt: Date.parse('2026-10-20T00:00:00Z'),
    password: null,
    inputs: [
      { channel: 0, name: 'Voltage', type: 'VT', value: 231.4 },
      { channel: 1, name: 'Mains', type: 'CT', value: 1520 },
      { channel: 2, name: 'Heat_Pump', type: 'CT', value: 840 },
      { channel: 4, name: 'Solar', type: 'CT', value: -1200 },
      { channel: 5, name: 'Oven', type: 'CT', value: 0 },
    ],
    outputs: [
      { name: 'Total', units: 'Watts', value: 2720 },
      { name: 'Mains_amps', units: 'Amps', value: 6.6 },
      { name: 'Mains_pf', units: 'PF', value: 0.92 },
    ],
    ...overrides,
  };
}

/**
 * @description The fake network.
 * @param {object} options - `{ clock }` (`clock.now` in ms).
 * @returns {object} `{ get, devices, calls, callsTo, clock }`.
 */
function createFakeNetwork({ clock }) {
  const devices = new Map();
  const calls = [];
  const sessions = new Map();

  const unix = () => Math.floor(clock.now / 1000);
  const seriesOf = (device) => [
    ...device.inputs.map((input) => ({
      name: input.name,
      unit: input.type === 'VT' ? 'Volts' : 'Watts',
      input,
    })),
    ...device.outputs.map((output) => ({ name: output.name, unit: output.units, output })),
  ];

  /**
   * @description A relative or absolute time of the query (UTC here).
   * @param {string} value - "s-24h", "d", "1761638400".
   * @returns {number|null} Unix seconds.
   */
  function timeOf(value) {
    if (/^\d{10}$/.test(value)) return Number(value);
    const match = String(value).match(/^([yMwdhms])((?:[+-]\d*[yMwdhms])*)$/);
    if (!match) return null;
    const now = new Date(Math.floor(unix() / 5) * 5 * 1000);
    const base = {
      y: Date.UTC(now.getUTCFullYear(), 0, 1),
      M: Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1),
      w: Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate() - now.getUTCDay()),
      d: Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()),
      h: Math.floor(now.getTime() / 3600000) * 3600000,
      m: Math.floor(now.getTime() / 60000) * 60000,
      s: now.getTime(),
    }[match[1]];
    let date = new Date(base);
    for (const [, sign, count, unit] of match[2].matchAll(/([+-])(\d*)([yMwdhms])/g)) {
      const n = (sign === '-' ? -1 : 1) * Number(count || 1);
      if (unit === 'y') date.setUTCFullYear(date.getUTCFullYear() + n);
      else if (unit === 'M') date.setUTCMonth(date.getUTCMonth() + n);
      else
        date = new Date(
          date.getTime() + n * { w: 604800, d: 86400, h: 3600, m: 60, s: 1 }[unit] * 1000,
        );
    }
    return Math.floor(date.getTime() / 1000);
  }

  const stepOf = (group) => {
    const match = String(group).match(/^(\d+)([smhdwM])$/);
    if (!match) return null;
    return { n: Number(match[1]), unit: match[2] };
  };

  /**
   * @description The rows of a select query.
   * @param {object} device - The device.
   * @param {URLSearchParams} params - The query.
   * @returns {{ status: number, body: string }} The answer.
   */
  function select(device, params) {
    const columns = params
      .get('select')
      .replace(/^\[|\]$/g, '')
      .split(',');
    const begin = timeOf(params.get('begin'));
    const end = Math.min(timeOf(params.get('end')), device.lastKey ?? unix());
    const group = params.get('group');
    if (begin === null || end === null || end < begin) {
      return { status: 400, body: JSON.stringify({ error: 'invalid query. Invalid begin/end' }) };
    }
    const series = seriesOf(device);
    const parsed = [];
    for (const column of columns) {
      const [name, ...methods] = column.split('.');
      if (name === 'time') {
        parsed.push({ time: true, unix: methods.includes('unix') });
        continue;
      }
      const found = series.find((entry) => entry.name === name);
      if (!found) {
        return {
          status: 400,
          body: JSON.stringify({ error: `invalid query. Invalid series: ${name}` }),
        };
      }
      const unit = methods.find((method) => !/^d\d$/.test(method)) ?? null;
      const decimals = Number((methods.find((method) => /^d\d$/.test(method)) ?? 'd1').slice(1));
      parsed.push({ found, unit, decimals });
    }
    // Group boundaries.
    const starts = [];
    if (group === 'all') {
      starts.push(begin);
    } else {
      const step = stepOf(group);
      let at = begin;
      while (at < end && starts.length < 1000) {
        starts.push(at);
        if (step.unit === 'M') {
          const date = new Date(at * 1000);
          date.setUTCMonth(date.getUTCMonth() + step.n);
          at = Math.floor(date.getTime() / 1000);
        } else {
          at += step.n * { s: 1, m: 60, h: 3600, d: 86400, w: 604800 }[step.unit];
        }
      }
    }
    const rows = starts.map((start, index) => {
      const stop = group === 'all' ? end : Math.min(starts[index + 1] ?? end, end);
      const seconds = Math.max(0, stop - start);
      return parsed.map((column) => {
        if (column.time)
          return column.unix ? start : new Date(start * 1000).toISOString().slice(0, 19);
        const { found, unit, decimals } = column;
        // A made-up history (`history(unixSeconds)`) is averaged over the
        // group, sampled every 5 minutes; otherwise the value is steady.
        const source = found.input ?? found.output;
        let watts = source.value;
        if (typeof source.history === 'function') {
          const step = Math.max(1, Math.min(300, seconds));
          let sum = 0;
          let count = 0;
          for (let at = start; at < Math.max(stop, start + 1); at += step) {
            sum += source.history(at);
            count += 1;
          }
          watts = sum / count;
        }
        let value;
        if (unit === 'wh') value = (watts * seconds) / 3600;
        else value = watts;
        const factor = 10 ** decimals;
        return Math.round(value * factor) / factor;
      });
    });
    if (params.get('header') === 'yes') {
      return {
        status: 200,
        body: JSON.stringify({ range: [begin, end], labels: columns, data: rows }),
      };
    }
    return { status: 200, body: JSON.stringify(rows) };
  }

  /**
   * @description Check the Digest header like the firmware.
   * @param {object} device - The device.
   * @param {string} header - The Authorization header.
   * @param {string} uri - The path.
   * @returns {boolean} Authorized.
   */
  function authorized(device, header, uri) {
    if (!device.password) return true;
    if (!header?.startsWith('Digest ')) return false;
    const params = Object.fromEntries(
      [...header.slice(7).matchAll(/(\w+)=(?:"([^"]*)"|([^,\s]*))/g)].map((m) => [
        m[1],
        m[2] ?? m[3],
      ]),
    );
    const session = sessions.get(params.nonce);
    if (!session || params.uri !== uri || !params.cnonce) return false;
    const nc = parseInt(params.nc, 16);
    if (!(nc > session.nc)) return false;
    const ha1 = md5(`${params.username}:${device.name}:${device.password}`);
    const ha2 = md5(`GET:${uri}`);
    const expected = md5(`${ha1}:${params.nonce}:${params.nc}:${params.cnonce}:auth:${ha2}`);
    if (params.response !== expected || !['user', 'admin'].includes(params.username)) return false;
    session.nc = nc;
    return true;
  }

  /**
   * @description The transport of the client.
   * @param {object} request - `{ host, port, path, headers }`.
   * @returns {Promise<object>} `{ status, headers, body }`.
   */
  async function get({ host, port, path, headers = {} }) {
    const address = port === 80 ? host : `${host}:${port}`;
    calls.push({ address, path, authorization: headers.Authorization ?? null, at: clock.now });
    const device = devices.get(address);
    if (!device || device.offline) {
      throw new Error('connect EHOSTUNREACH');
    }
    if (device.httpError) {
      return { status: device.httpError, headers: {}, body: '' };
    }
    if (device.notIotaWatt) {
      return { status: 200, headers: {}, body: '<html>router</html>' };
    }
    if (!authorized(device, headers.Authorization, path)) {
      const nonce = randomBytes(16).toString('hex');
      sessions.set(nonce, { nc: 0 });
      return {
        status: 401,
        headers: {
          'www-authenticate': `Digest realm="${device.name}",qop="auth",nonce="${nonce}"`,
        },
        body: 'IoTaWatt-Login',
      };
    }
    const url = new URL(path, 'http://device');
    if (url.pathname === '/status') {
      const runseconds = Math.floor((clock.now - device.startedAt) / 1000);
      return {
        status: 200,
        headers: {},
        body: JSON.stringify({
          device: { name: device.name, timediff: 0, allowdst: false, update: 'MAJOR' },
          stats: {
            cyclerate: 400,
            chanrate: 30,
            starttime: Math.floor(device.startedAt / 1000),
            currenttime: unix(),
            runseconds,
            stack: 20000,
            version: device.firmware,
            frequency: 50.01,
            lowbat: device.lowbat,
          },
          inputs: device.inputs.map((input) =>
            input.type === 'VT'
              ? { channel: input.channel, Vrms: input.value, Hz: 50.01, phase: 0 }
              : {
                  channel: input.channel,
                  Watts: String(Math.round(input.value)),
                  Pf: 0.9,
                  phase: 1,
                  lastphase: 1,
                },
          ),
          outputs: device.outputs.map((output) => ({
            name: output.name,
            units: output.units,
            value: output.value,
          })),
          wifi: {
            connecttime: 100,
            SSID: 'home',
            IP: device.ip,
            channel: 6,
            RSSI: device.rssi,
            mac: device.mac,
          },
          datalogs: [
            {
              id: 'Current',
              firstkey: 1,
              lastkey: device.lastKey ?? Math.floor(unix() / 5) * 5,
              size: 1,
              interval: 5,
            },
            { id: 'History', firstkey: 1, lastkey: 1, size: 1, interval: 60 },
          ],
        }),
      };
    }
    if (url.pathname === '/query' && url.searchParams.get('show') === 'series') {
      return {
        status: 200,
        headers: {},
        body: JSON.stringify({
          series: seriesOf(device).map(({ name, unit }) => ({ name, unit })),
        }),
      };
    }
    if (url.pathname === '/query' && url.searchParams.has('select')) {
      return { headers: {}, ...select(device, url.searchParams) };
    }
    return { status: 404, headers: {}, body: 'Not found' };
  }

  return {
    get,
    devices,
    calls,
    clock,
    /**
     * @description The calls to a path (without the query).
     * @param {string} pathname - "/status".
     * @returns {object[]} The calls.
     */
    callsTo: (pathname) => calls.filter((call) => call.path.split('?')[0] === pathname),
    /**
     * @description Put a device on the network.
     * @param {string} address - Its address.
     * @param {object} [device] - sampleDevice() by default.
     * @returns {object} The device.
     */
    add(address, device = sampleDevice()) {
      devices.set(address, device);
      return device;
    },
  };
}

/**
 * @description A fresh /data folder.
 * @returns {string} The folder.
 */
const dataDir = () => mkdtempSync(join(tmpdir(), 'gladys-iotawatt-'));

/**
 * @description A logger that keeps what it is given.
 * @returns {object} The logger, with `lines`.
 */
function recordingLogger() {
  const lines = [];
  const keep =
    (level) =>
    (...args) =>
      lines.push([
        level,
        args.map((arg) => (arg instanceof Error ? arg.message : String(arg))).join(' '),
      ]);
  return {
    lines,
    debug: keep('debug'),
    info: keep('info'),
    warn: keep('warn'),
    error: keep('error'),
  };
}

const PASSWORD = 'not-a-real-password';

export { sampleDevice, createFakeNetwork, dataDir, recordingLogger, PASSWORD };
