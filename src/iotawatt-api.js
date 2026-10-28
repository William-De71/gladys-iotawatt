// -----------------------------------------------------------------------------
// HTTP client of an IoTaWatt energy monitor, on the local network, through
// its documented local API (https://docs.iotawatt.com/en/master/query.html and
// the firmware, https://github.com/boblemaire/IoTaWatt, GPL-3.0: only the
// facts are used, none of its code):
//
//   GET /status?device&stats&inputs&outputs&wifi&datalogs
//        -> { device: { name, … }, stats: { version, runseconds, lowbat, … },
//             inputs: [{ channel, Vrms, Hz } | { channel, Watts: "123", Pf }],
//             outputs: [{ name, units, value }], wifi: { mac, RSSI, … },
//             datalogs: [{ id: "Current", lastkey, interval, … }, …] }
//   GET /query?show=series
//        -> { series: [{ name, unit }] } (active inputs in channel order,
//           then outputs)
//   GET /query?select=[…]&begin=…&end=…&group=…&format=json
//        -> [[…], …] (rows), 400 { error } for an invalid query
//
// Authentication: none by default. When the owner set passwords, every
// request needs HTTP Digest (RFC 2617, MD5, qop=auth) with the user "user"
// (read) or "admin", unless "local access" is allowed and the request comes
// from the subnet of the IoTaWatt (the container's requests leave through
// the host, so they usually do). The firmware opens a session per nonce and
// accepts each `nc` once, increasing: the client keeps the nonce and counts.
//
// An IoTaWatt is an ESP8266: one request at a time per device (a queue), no
// keep-alive, a 10-second timeout, a short pause between requests.
// -----------------------------------------------------------------------------

import http from 'node:http';
import { createHash, randomBytes } from 'node:crypto';

const TIMEOUT_MS = 10000;
const SPACING_MS = 150;
const MAX_BODY = 512 * 1024;

/**
 * @description An error of an IoTaWatt.
 */
class IotaWattError extends Error {
  /**
   * @param {string} kind - `auth` (refused), `unreachable` (no answer,
   * timeout), `http` (another status), `query` (400 of a query), `invalid`
   * (not the JSON of an IoTaWatt).
   * @param {string} message - What went wrong (never a password).
   * @param {object} [extra] - `{ status }`.
   */
  constructor(kind, message, extra = {}) {
    super(message);
    this.name = 'IotaWattError';
    this.kind = kind;
    Object.assign(this, extra);
  }
}

const md5 = (text) => createHash('md5').update(text, 'utf8').digest('hex');

/**
 * @description Read the parameters of a `WWW-Authenticate: Digest …` header.
 * @param {string} header - The header.
 * @returns {object|null} `{ realm, nonce, qop, opaque }`, null when not Digest.
 */
function parseChallenge(header) {
  const text = String(header ?? '');
  if (!/^\s*Digest\s/i.test(text)) {
    return null;
  }
  const params = {};
  for (const match of text.matchAll(/(\w+)=(?:"([^"]*)"|([^,\s]*))/g)) {
    params[match[1].toLowerCase()] = match[2] ?? match[3];
  }
  return params.nonce ? params : null;
}

/**
 * @description The Authorization header of a Digest request.
 * @param {object} options - `{ username, password, challenge, method, uri, nc, cnonce }`.
 * @returns {string} The header.
 */
function digestHeader({ username, password, challenge, method = 'GET', uri, nc, cnonce }) {
  const ha1 = md5(`${username}:${challenge.realm ?? ''}:${password}`);
  const ha2 = md5(`${method}:${uri}`);
  const count = nc.toString(16).padStart(8, '0');
  const auth = String(challenge.qop ?? '')
    .split(',')
    .map((value) => value.trim())
    .includes('auth');
  const response = auth
    ? md5(`${ha1}:${challenge.nonce}:${count}:${cnonce}:auth:${ha2}`)
    : md5(`${ha1}:${challenge.nonce}:${ha2}`);
  const parts = [
    `username="${username}"`,
    `realm="${challenge.realm ?? ''}"`,
    `nonce="${challenge.nonce}"`,
    `uri="${uri}"`,
    `response="${response}"`,
    // The firmware requires a cnonce even without qop.
    `cnonce="${cnonce}"`,
    ...(auth ? ['qop=auth', `nc=${count}`] : []),
    ...(challenge.opaque ? [`opaque="${challenge.opaque}"`] : []),
  ];
  return `Digest ${parts.join(', ')}`;
}

/**
 * @description A GET with node:http, without keep-alive.
 * @param {object} options - `{ host, port, path, headers, timeout }`.
 * @returns {Promise<{ status: number, headers: object, body: string }>} The answer.
 */
function httpGet({ host, port, path, headers, timeout }) {
  return new Promise((resolve, reject) => {
    const request = http.request(
      { host, port, path, method: 'GET', headers, agent: false, timeout },
      (response) => {
        const chunks = [];
        let size = 0;
        response.on('data', (chunk) => {
          size += chunk.length;
          if (size > MAX_BODY) {
            request.destroy(new Error('answer too large'));
            return;
          }
          chunks.push(chunk);
        });
        response.on('end', () =>
          resolve({
            status: response.statusCode,
            headers: response.headers,
            body: Buffer.concat(chunks).toString('utf8'),
          }),
        );
        response.on('error', reject);
      },
    );
    request.on('timeout', () => request.destroy(new Error('timeout')));
    request.on('error', reject);
    request.end();
  });
}

/**
 * @description Split "192.168.1.20", "iotawatt.local:8080" or "[fe80::1]:80".
 * @param {string} address - The address.
 * @returns {{ host: string, port: number }} The host and the port (80 by default).
 */
function splitAddress(address) {
  const text = String(address ?? '').trim();
  const bracket = text.match(/^\[([^\]]+)\](?::(\d+))?$/);
  if (bracket) {
    return { host: bracket[1], port: Number(bracket[2] ?? 80) };
  }
  const colon = text.match(/^([^:]+):(\d+)$/);
  if (colon) {
    return { host: colon[1], port: Number(colon[2]) };
  }
  return { host: text, port: 80 };
}

/**
 * @description The client of one IoTaWatt.
 * @param {object} options - Options.
 * @param {string} options.address - IP address or name (optionally `:port`).
 * @param {Function} options.getCredentials - `() => ({ username, password })`.
 * @param {Function} [options.get] - Transport `({ host, port, path, headers, timeout }) => answer` (tests).
 * @param {Function} [options.sleep] - `(ms) => Promise` (tests).
 * @returns {object} `{ address, status, series, query, counts }`.
 */
function createIotaWattClient({ address, getCredentials, get = httpGet, sleep }) {
  const { host, port } = splitAddress(address);
  const wait = sleep ?? ((ms) => new Promise((resolve) => setTimeout(resolve, ms)));
  let queue = Promise.resolve();
  let challenge = null;
  let nc = 0;
  const counts = { requests: 0, failures: 0, authRetries: 0 };

  /**
   * @description One answer, with one Digest retry after a 401.
   * @param {string} path - The path and query.
   * @returns {Promise<object>} The answer.
   */
  async function send(path) {
    const attempt = async () => {
      const headers = { Accept: 'application/json', Connection: 'close' };
      const { username, password } = getCredentials();
      if (challenge && password) {
        nc += 1;
        headers.Authorization = digestHeader({
          username: username || 'user',
          password,
          challenge,
          uri: path,
          nc,
          cnonce: randomBytes(8).toString('hex'),
        });
      }
      counts.requests += 1;
      try {
        return await get({ host, port, path, headers, timeout: TIMEOUT_MS });
      } catch (err) {
        counts.failures += 1;
        throw new IotaWattError('unreachable', `${address}: ${err.message}`);
      }
    };
    let answer = await attempt();
    if (answer.status === 401) {
      const fresh = parseChallenge(answer.headers?.['www-authenticate']);
      const { password } = getCredentials();
      if (!fresh || !password) {
        throw new IotaWattError('auth', `${address}: a password is required`, { status: 401 });
      }
      // A new session (or the first): its nonce, its counter from 1.
      challenge = fresh;
      nc = 0;
      counts.authRetries += 1;
      answer = await attempt();
      if (answer.status === 401) {
        challenge = null;
        throw new IotaWattError('auth', `${address}: the user or the password is refused`, {
          status: 401,
        });
      }
    }
    return answer;
  }

  /**
   * @description A JSON GET, queued behind the other requests to this device.
   * @param {string} path - The path and query.
   * @returns {Promise<unknown>} The JSON.
   */
  function getJson(path) {
    const run = queue.then(async () => {
      try {
        const answer = await send(path);
        if (answer.status === 400 && path.startsWith('/query')) {
          let message = answer.body;
          try {
            message = JSON.parse(answer.body)?.error ?? answer.body;
          } catch {
            // A plain-text error.
          }
          throw new IotaWattError('query', `${address}: ${String(message).slice(0, 200)}`, {
            status: 400,
          });
        }
        if (answer.status !== 200) {
          throw new IotaWattError('http', `${address}: HTTP ${answer.status}`, {
            status: answer.status,
          });
        }
        try {
          return JSON.parse(answer.body);
        } catch {
          return repairJson(answer.body, address);
        }
      } finally {
        await wait(SPACING_MS);
      }
    });
    // A failure never blocks the next request.
    queue = run.catch(() => {});
    return run;
  }

  return {
    address,
    host,
    port,
    /**
     * @description The status of the device.
     * @returns {Promise<object>} The JSON.
     */
    status: () =>
      getJson('/status?device=yes&stats=yes&inputs=yes&outputs=yes&wifi=yes&datalogs=yes'),
    /**
     * @description The list of the series (inputs, then outputs).
     * @returns {Promise<object>} The JSON.
     */
    series: () => getJson('/query?show=series'),
    /**
     * @description A query of values.
     * @param {object} params - `{ select: string[], begin, end, group, header }`.
     * @returns {Promise<unknown>} The JSON (rows, or `{ data, range, labels }` with header).
     */
    query: ({ select, begin, end, group, header = false }) => {
      const search = [
        `select=${encodeURIComponent(`[${select.join(',')}]`)}`,
        `begin=${encodeURIComponent(String(begin))}`,
        `end=${encodeURIComponent(String(end))}`,
        `group=${encodeURIComponent(String(group))}`,
        'format=json',
        ...(header ? ['header=yes'] : []),
      ].join('&');
      return getJson(`/query?${search}`);
    },
    counts: () => ({ ...counts }),
  };
}

/**
 * @description The series list of a firmware without any input is not valid
 * JSON (`{"series":{"name"…},{…}]}` or `{"series":]}`): put it right.
 * @param {string} body - The answer.
 * @param {string} address - The device (for the error).
 * @returns {unknown} The JSON.
 */
function repairJson(body, address) {
  const text = String(body ?? '');
  const fixed = text
    .replace(/^\{"series":\]\}$/, '{"series":[]}')
    .replace(/^\{"series":\{/, '{"series":[{');
  try {
    return JSON.parse(fixed);
  } catch {
    throw new IotaWattError('invalid', `${address}: not the answer of an IoTaWatt`);
  }
}

export {
  IotaWattError,
  TIMEOUT_MS,
  parseChallenge,
  digestHeader,
  splitAddress,
  repairJson,
  createIotaWattClient,
};
