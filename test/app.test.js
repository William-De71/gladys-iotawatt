// The whole integration against the fake Gladys of the SDK
// (`@gladysassistant/integration-sdk/testing`), which checks the discovered
// devices, the states and the scene events like the host API does, and a fake
// IoTaWatt network (test/helpers/fake-iotawatt.js) on a fake clock.
// No test touches the network.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { createFakeGladys } from '@gladysassistant/integration-sdk/testing';
import { validateWidgetContent } from '@gladysassistant/integration-sdk';

import { createApp, ACTIONS } from '../src/app.js';
import { WIDGETS } from '../src/widgets.js';
import { TRIGGERS, SCENE_ACTIONS, ENERGY_OUTPUTS } from '../src/events.js';
import { FILE } from '../src/store.js';
import { LANGUAGES } from '../src/i18n.js';
import {
  createFakeNetwork,
  sampleDevice,
  dataDir,
  recordingLogger,
  PASSWORD,
} from './helpers/fake-iotawatt.js';

const NOW = Date.parse('2026-10-28T09:00:02Z');
const SECOND = 1000;
const MINUTE = 60 * SECOND;
const HOUR = 60 * MINUTE;
const ADDRESS = '192.168.1.20';
const MAC = '5ccf7f123456';
const CONFIG = { hosts: ADDRESS, interval: '30', language: 'en' };
const PREFIX = 'ext:test-integration';
const meterId = (feature) => `${PREFIX}:meter:${MAC}${feature ? `:${feature}` : ''}`;
const channelId = (key, feature) =>
  `${PREFIX}:channel:${MAC}-${key}${feature ? `:${feature}` : ''}`;

/**
 * @description The integration, connected to a fake Gladys and a fake network.
 * @param {object} t - The test context.
 * @param {object} [options] - `{ config, dir, clock, network, scanResults, device }`.
 * @returns {Promise<object>} `{ gladys, app, network, clock, dir, logger }`.
 */
async function startApp(
  t,
  {
    config = CONFIG,
    dir = dataDir(),
    clock = { now: NOW },
    network,
    scanResults = {},
    device,
  } = {},
) {
  if (!network) {
    network = createFakeNetwork({ clock });
    network.add(ADDRESS, device ?? sampleDevice());
  }
  const logger = recordingLogger();
  const gladys = createFakeGladys({ config, scanResults });
  const app = createApp(gladys, {
    get: network.get,
    dataDir: dir,
    now: () => clock.now,
    sleep: async () => {},
    timeZone: 'Europe/Paris',
    timers: false,
    logger,
  });
  await gladys.connect();
  await app.whenReady();
  t.after(async () => {
    await gladys.fake.shutdown().catch(() => {});
  });
  return { gladys, app, network, clock, dir, logger };
}

/**
 * @description Run the timer like the real one (every 30 s) for a while.
 * @param {object} env - `{ app, clock }`.
 * @param {number} ms - How long.
 * @param {number} [step] - The interval.
 */
async function run({ app, clock }, ms, step = 30 * SECOND) {
  const end = clock.now + ms;
  while (clock.now < end) {
    await app.tick();
    clock.now += step;
  }
}

/**
 * @description Create every offered device, like the user would.
 * @param {object} gladys - The fake Gladys.
 */
async function createAll(gladys) {
  for (const device of gladys.fake.discoveredDevices) {
    await gladys.fake.deviceCreated(structuredClone(device));
  }
}
const widget = async (gladys, key, options) =>
  (await gladys.fake.widgetGet(key, options)).data.content;
const events = (gladys, key) => gladys.fake.sceneEvents.filter((event) => event.key === key);
const lastState = (gladys, id) =>
  gladys.fake.states.filter((state) => state.device_feature_external_id === id).at(-1);
const featureKeys = (device) =>
  device.features.map((feature) => feature.external_id.split(':').pop());

test('startup: the typed address is read, the meter and its channels are offered', async (t) => {
  const env = await startApp(t);
  const { gladys, network } = env;
  assert.deepEqual(network.calls, [], 'no request before the timer');
  await run(env, 30 * SECOND);
  assert.deepEqual(
    gladys.fake.discoveredDevices.map((device) => [
      device.name,
      device.external_id,
      featureKeys(device),
    ]),
    [
      ['IoTaWatt', meterId(), ['rssi', 'rtc_battery_low', 'firmware']],
      ['Voltage (IoTaWatt)', channelId('in0'), ['voltage']],
      ['Mains (IoTaWatt)', channelId('in1'), ['power', 'energy']],
      ['Heat Pump (IoTaWatt)', channelId('in2'), ['power', 'energy']],
      // Negative over the last 7 days: the export index too.
      ['Solar (IoTaWatt)', channelId('in4'), ['power', 'energy', 'energy_export']],
      ['Oven (IoTaWatt)', channelId('in5'), ['power', 'energy']],
      ['Total (IoTaWatt)', channelId('out-Total'), ['power', 'energy']],
      ['Mains amps (IoTaWatt)', channelId('out-Mains_amps'), ['current']],
    ],
    'the PF output has no Gladys feature',
  );
  for (const device of gladys.fake.discoveredDevices) {
    assert.equal(device.should_poll, false);
    assert.equal(device.poll_frequency, undefined);
    for (const feature of device.features) {
      for (const field of ['min', 'max', 'read_only', 'has_feedback']) {
        assert.notEqual(feature[field], undefined, `${feature.external_id} ${field}`);
      }
    }
  }
  assert.equal(gladys.fake.connectionStatus.connected, true);
  assert.equal(gladys.fake.connectionStatus.message.en, '1 IoTaWatt, 7 channel(s).');
  assert.deepEqual(gladys.fake.states, [], 'no state before the devices exist');
  assert.deepEqual(gladys.fake.sceneEvents, [], 'never at the first reading');
});

test('states: power, voltage, current, Wi-Fi, clock battery, firmware; energy counted every minute', async (t) => {
  const env = await startApp(t);
  const { gladys } = env;
  await run(env, 30 * SECOND);
  await createAll(gladys);
  assert.equal(lastState(gladys, channelId('in1', 'power')).state, 1520);
  assert.equal(lastState(gladys, channelId('in4', 'power')).state, -1200);
  assert.equal(lastState(gladys, channelId('in0', 'voltage')).state, 231.4);
  assert.equal(lastState(gladys, channelId('out-Mains_amps', 'current')).state, 6.6);
  assert.equal(lastState(gladys, meterId('rssi')).state, -61);
  assert.equal(lastState(gladys, meterId('rtc_battery_low')).state, 0);
  assert.equal(lastState(gladys, meterId('firmware')).text, '02_08_04');
  // The counting starts at the first reading: 0.
  assert.equal(lastState(gladys, channelId('in1', 'energy')).state, 0);
  await run(env, 10 * MINUTE);
  // 1520 W for about 10 minutes: about 0.25 kWh.
  const mains = lastState(gladys, channelId('in1', 'energy')).state;
  assert.ok(mains > 0.2 && mains < 0.27, `mains ${mains}`);
  const exported = lastState(gladys, channelId('in4', 'energy_export')).state;
  assert.ok(exported > 0.15 && exported < 0.21, `solar export ${exported}`);
  assert.equal(lastState(gladys, channelId('in4', 'energy')).state, 0, 'nothing drawn');
  // Only what changed is sent: the steady power is not repeated.
  const powers = gladys.fake.states.filter(
    (state) => state.device_feature_external_id === channelId('in1', 'power'),
  );
  assert.equal(powers.length, 1);
});

test('energy: a restart of the container catches up from the IoTaWatt log', async (t) => {
  const dir = dataDir();
  const clock = { now: NOW };
  const network = createFakeNetwork({ clock });
  network.add(ADDRESS);
  const first = await startApp(t, { dir, clock, network });
  await run(first, 3 * MINUTE);
  await first.gladys.fake.shutdown();
  const stored = JSON.parse(readFileSync(join(dir, FILE), 'utf8'));
  const before = stored.meters[MAC].totals.in1.importWh;
  assert.ok(before > 0);
  assert.equal(JSON.stringify(stored).includes(PASSWORD), false);
  // Two hours later.
  clock.now += 2 * HOUR;
  const second = await startApp(t, { dir, clock, network });
  await run(second, 2 * MINUTE);
  const after = second.app.store.data.meters[MAC].totals.in1.importWh;
  // 1520 W for two hours: about 3 kWh more.
  assert.ok(after - before > 3000 && after - before < 3200, `${after - before} Wh`);
});

test('mDNS: the IoTaWatt names are tried, other web servers are left alone', async (t) => {
  const clock = { now: NOW };
  const network = createFakeNetwork({ clock });
  network.add('192.168.1.31', sampleDevice({ name: 'IotaWatt', mac: '5C:CF:7F:AA:BB:CC' }));
  network.add('192.168.1.1', { ...sampleDevice(), notIotaWatt: true });
  const env = await startApp(t, {
    config: { language: 'en' },
    clock,
    network,
    scanResults: {
      mdns: [
        {
          name: 'IotaWatt',
          host: 'IotaWatt.local',
          addresses: ['192.168.1.31'],
          port: 80,
          txt: [],
        },
        {
          name: 'Living room printer',
          host: 'printer.local',
          addresses: ['192.168.1.40'],
          port: 80,
          txt: [],
        },
      ],
    },
  });
  await env.gladys.fake.scanRequest();
  assert.deepEqual(
    [...new Set(network.calls.map((call) => call.address))],
    ['192.168.1.31'],
    'only the IoTaWatt name is asked',
  );
  assert.ok(
    env.gladys.fake.discoveredDevices.some(
      (device) => device.external_id === `${PREFIX}:meter:5ccf7faabbcc`,
    ),
  );
});

test('a password: HTTP Digest, the nonce kept, a refused password reported', async (t) => {
  const device = sampleDevice({ password: PASSWORD });
  const env = await startApp(t, { config: { ...CONFIG, password: PASSWORD }, device });
  await run(env, 3 * MINUTE);
  assert.ok(env.gladys.fake.discoveredDevices.length > 1);
  const challenges = env.network.calls.filter((call) => !call.authorization).length;
  assert.equal(challenges, 1, 'one 401, then the session is reused');
  assert.ok(env.network.calls.every((call) => !String(call.authorization).includes(PASSWORD)));

  const refused = await startApp(t, {
    config: { ...CONFIG, password: 'not-the-right-one' },
    device,
  });
  await run(refused, 30 * SECOND);
  assert.equal(refused.gladys.fake.connectionStatus.connected, false);
  assert.match(refused.gladys.fake.connectionStatus.message.en, /password/);
  const none = await startApp(t, { config: CONFIG, device });
  const ack = await none.gladys.fake.action(ACTIONS.SEARCH);
  assert.match(ack.data.message?.en ?? JSON.stringify(ack.data), /password/);
});

test('triggers: unreachable after 3 readings and a minute, back online, restarted', async (t) => {
  const env = await startApp(t);
  const { gladys, network } = env;
  await run(env, MINUTE);
  const device = network.devices.get(ADDRESS);
  device.offline = true;
  await run(env, 30 * SECOND);
  assert.equal(events(gladys, TRIGGERS.UNREACHABLE).length, 0, 'one failure is not enough');
  await run(env, 2 * MINUTE);
  const [down] = events(gladys, TRIGGERS.UNREACHABLE);
  assert.equal(down.data.meter, meterId());
  assert.equal(down.data.meter_name, 'IoTaWatt');
  assert.equal(down.data.message, 'IoTaWatt does not answer any more.');
  assert.equal(gladys.fake.connectionStatus.connected, false);
  await run(env, 5 * MINUTE);
  assert.equal(events(gladys, TRIGGERS.UNREACHABLE).length, 1, 'once per transition');
  device.offline = false;
  device.startedAt = env.clock.now - 20 * SECOND;
  await run(env, 30 * SECOND);
  assert.equal(events(gladys, TRIGGERS.BACK_ONLINE).length, 1);
  assert.equal(events(gladys, TRIGGERS.RESTARTED).length, 1);
  assert.ok(events(gladys, TRIGGERS.BACK_ONLINE)[0].data.down_minutes >= 7);
  assert.equal(gladys.fake.connectionStatus.connected, true);
  for (const event of gladys.fake.sceneEvents) {
    for (const value of Object.values(event.data)) {
      assert.ok(value === null || ['string', 'number', 'boolean'].includes(typeof value));
    }
  }
});

test('scene action: the energy of a channel over a period, only the declared outputs', async (t) => {
  const env = await startApp(t);
  await run(env, 30 * SECOND);
  const ack = await env.gladys.fake.sceneAction(SCENE_ACTIONS.GET_ENERGY, {
    channel: channelId('in2'),
    period: 'yesterday',
  });
  const outputs = ack.data.outputs ?? ack.data;
  assert.deepEqual(Object.keys(outputs).sort(), [...ENERGY_OUTPUTS].sort());
  assert.equal(outputs.channel_name, 'Heat Pump');
  // 840 W for 24 hours.
  assert.equal(outputs.energy_kwh, 20.16);
  assert.equal(outputs.average_watts, 840);
  assert.equal(outputs.period_start, '2026-10-27T00:00:00.000Z');
  assert.equal(outputs.period_end, '2026-10-28T00:00:00.000Z');
  assert.equal(outputs.summary, 'Heat Pump: 20.16 kWh yesterday (average 840 W).');
  // A voltage channel is not a power one: the first power channel instead.
  const fallback = await env.gladys.fake.sceneAction(SCENE_ACTIONS.GET_ENERGY, {
    channel: channelId('in0'),
  });
  assert.equal((fallback.data.outputs ?? fallback.data).channel_name, 'Mains');
});

test('widgets: overview and channel in every language, valid contents', async (t) => {
  const env = await startApp(t);
  await run(env, 30 * SECOND);
  for (const language of LANGUAGES) {
    const overview = await widget(env.gladys, WIDGETS.OVERVIEW, { language, settings: {} });
    assert.deepEqual(validateWidgetContent(overview), [], `overview ${language}`);
    assert.equal(overview.components.filter((component) => component.type === 'value').length, 5);
    for (const view of ['power_day', 'energy_days', 'energy_months']) {
      const content = await widget(env.gladys, WIDGETS.CHANNEL, {
        language,
        settings: { channel: channelId('in1'), view },
      });
      assert.deepEqual(validateWidgetContent(content), [], `channel ${view} ${language}`);
      assert.ok(
        content.components.some((component) => component.type === 'chart'),
        view,
      );
    }
    const volts = await widget(env.gladys, WIDGETS.CHANNEL, {
      language,
      settings: { channel: channelId('in0') },
    });
    assert.deepEqual(validateWidgetContent(volts), []);
  }
  const before = env.network.callsTo('/query').length;
  await widget(env.gladys, WIDGETS.CHANNEL, {
    language: 'en',
    settings: { channel: channelId('in1') },
  });
  assert.equal(env.network.callsTo('/query').length, before, 'the history is cached');
});

test('no IoTaWatt: a clear status, the widgets say how to add one', async (t) => {
  const env = await startApp(t, { config: { language: 'fr' } });
  await run(env, 30 * SECOND);
  assert.equal(env.gladys.fake.connectionStatus.connected, false);
  assert.match(env.gladys.fake.connectionStatus.message.fr, /Aucun IoTaWatt/);
  const content = await widget(env.gladys, WIDGETS.OVERVIEW, { language: 'fr', settings: {} });
  assert.deepEqual(validateWidgetContent(content), []);
  const ack = await env.gladys.fake.action(ACTIONS.SEARCH);
  assert.ok(JSON.stringify(ack.data).includes('Aucun IoTaWatt'));
});

test('diagnostic: in the logs, never the password', async (t) => {
  const device = sampleDevice({ password: PASSWORD });
  const env = await startApp(t, { config: { ...CONFIG, password: PASSWORD }, device });
  await run(env, 30 * SECOND);
  await env.gladys.fake.action(ACTIONS.DIAGNOSTIC);
  const lines = env.logger.lines.filter(([, line]) => line.includes('diagnostic'));
  assert.ok(lines.length >= 1);
  assert.equal(JSON.stringify(env.logger.lines).includes(PASSWORD), false);
});

test('a passing HTTP error of a known IoTaWatt never sets it aside', async (t) => {
  const env = await startApp(t);
  await run(env, 30 * SECOND);
  const device = env.network.devices.get(ADDRESS);
  device.httpError = 500;
  await run(env, 30 * SECOND);
  device.httpError = null;
  const before = env.network.callsTo('/status').length;
  await run(env, 30 * SECOND);
  assert.equal(env.network.callsTo('/status').length, before + 1, 'asked again at the next round');
  assert.equal(env.gladys.fake.connectionStatus.connected, true);
});
