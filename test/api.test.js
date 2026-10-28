// The HTTP client of an IoTaWatt: Digest like the firmware checks it, the
// queue (one request at a time), the errors, the broken series list.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import {
  parseChallenge,
  digestHeader,
  splitAddress,
  repairJson,
  createIotaWattClient,
} from '../src/iotawatt-api.js';
import { createFakeNetwork, sampleDevice, PASSWORD } from './helpers/fake-iotawatt.js';

const md5 = (text) => createHash('md5').update(text).digest('hex');

test('Digest: the challenge is read, the answer is the one of RFC 2617 (qop=auth)', () => {
  const challenge = parseChallenge(
    'Digest realm="IotaWatt",qop="auth",nonce="0123456789abcdef0123456789abcdef"',
  );
  assert.deepEqual(challenge, {
    realm: 'IotaWatt',
    qop: 'auth',
    nonce: '0123456789abcdef0123456789abcdef',
  });
  assert.equal(parseChallenge('Basic realm="x"'), null);
  assert.equal(parseChallenge(undefined), null);
  const header = digestHeader({
    username: 'user',
    password: PASSWORD,
    challenge,
    uri: '/status?stats=yes',
    nc: 1,
    cnonce: 'abcdef',
  });
  const ha1 = md5(`user:IotaWatt:${PASSWORD}`);
  const ha2 = md5('GET:/status?stats=yes');
  const expected = md5(`${ha1}:${challenge.nonce}:00000001:abcdef:auth:${ha2}`);
  assert.ok(header.includes(`response="${expected}"`));
  assert.ok(header.includes('nc=00000001'));
  assert.ok(header.includes('cnonce="abcdef"'));
  assert.ok(!header.includes(PASSWORD));
});

test('addresses: a port, an IPv6 address in brackets', () => {
  assert.deepEqual(splitAddress('192.168.1.20'), { host: '192.168.1.20', port: 80 });
  assert.deepEqual(splitAddress('iotawatt.local:8080'), { host: 'iotawatt.local', port: 8080 });
  assert.deepEqual(splitAddress('[fe80::1]:81'), { host: 'fe80::1', port: 81 });
});

test('the series list of a firmware without inputs is repaired', () => {
  assert.deepEqual(repairJson('{"series":]}', 'x'), { series: [] });
  assert.deepEqual(
    repairJson('{"series":{"name":"a","unit":"Watts"},{"name":"b","unit":"Volts"}]}', 'x'),
    {
      series: [
        { name: 'a', unit: 'Watts' },
        { name: 'b', unit: 'Volts' },
      ],
    },
  );
  assert.throws(() => repairJson('<html>', 'x'), { kind: 'invalid' });
});

test('client: one request at a time, a Digest session reused with an increasing nc', async () => {
  const clock = { now: Date.parse('2026-10-28T09:00:00Z') };
  const network = createFakeNetwork({ clock });
  network.add('192.168.1.20', sampleDevice({ password: PASSWORD }));
  let inFlight = 0;
  let most = 0;
  const get = async (request) => {
    inFlight += 1;
    most = Math.max(most, inFlight);
    await new Promise((resolve) => setTimeout(resolve, 2));
    try {
      return await network.get(request);
    } finally {
      inFlight -= 1;
    }
  };
  const client = createIotaWattClient({
    address: '192.168.1.20',
    getCredentials: () => ({ username: 'user', password: PASSWORD }),
    get,
    sleep: async () => {},
  });
  const [status, series] = await Promise.all([client.status(), client.series(), client.status()]);
  assert.equal(most, 1, 'never two requests at once');
  assert.equal(status.stats.version, '02_08_04');
  assert.equal(series.series.length, 8);
  const counts = network.calls.map((call) => call.authorization?.match(/nc=(\w+)/)?.[1] ?? null);
  assert.deepEqual(counts, [null, '00000001', '00000002', '00000003']);
});

test('client: the errors carry a kind, never the password', async () => {
  const clock = { now: Date.parse('2026-10-28T09:00:00Z') };
  const network = createFakeNetwork({ clock });
  network.add('a', sampleDevice({ password: PASSWORD }));
  const client = (password, address = 'a') =>
    createIotaWattClient({
      address,
      getCredentials: () => ({ username: 'user', password }),
      get: network.get,
      sleep: async () => {},
    });
  await assert.rejects(client('').status(), { kind: 'auth', message: /password is required/ });
  await assert.rejects(client('wrong').status(), { kind: 'auth', message: /refused/ });
  await assert.rejects(client(PASSWORD, 'nowhere').status(), { kind: 'unreachable' });
  await assert.rejects(
    client(PASSWORD).query({ select: ['Nope.wh'], begin: 'd', end: 's', group: 'all' }),
    { kind: 'query', message: /Invalid series: Nope/ },
  );
  const rows = await client(PASSWORD).query({
    select: ['Oven.wh'],
    begin: 'd',
    end: 's',
    group: 'all',
  });
  assert.ok(Array.isArray(rows));
  // The select is URL-encoded, the brackets included.
  assert.ok(
    network.calls.at(-1).path.startsWith('/query?select=%5BOven.wh%5D&begin=d&end=s&group=all'),
  );
});
