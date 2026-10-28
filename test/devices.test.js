// The answers made safe, and the devices offered on the Discovery screen,
// checked like the core checks them (a single invalid field rejects the whole
// batch, and a missing min / max / read_only / has_feedback makes "Add" fail
// in 422).

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import {
  DEVICE_FEATURE_CATEGORIES as C,
  DEVICE_FEATURE_TYPES as T,
  DEVICE_FEATURE_UNITS as U,
} from '@gladysassistant/integration-sdk';
import { parseStatus, parseSeries, channelsOf, parseRows, macOf } from '../src/parse.js';
import {
  buildMeterDevices,
  buildMeterStates,
  targetOf,
  meterName,
  channelName,
} from '../src/device.js';
import { LANGUAGES } from '../src/i18n.js';

const fakeGladys = {
  externalIds: (type, id) => ({
    device: `ext:test-integration:${type}:${id}`,
    feature: (key) => `ext:test-integration:${type}:${id}:${key}`,
  }),
};
const fixture = JSON.parse(readFileSync(new URL('./fixtures/meter.json', import.meta.url), 'utf8'));
const status = parseStatus(fixture.status);
const series = parseSeries(fixture.series);
const channels = channelsOf(status, series);

// The pairs of the core (DEVICE_FEATURE_UNITS_BY_CATEGORY, master 2026-10-26).
const UNITS_OF = {
  [C.ENERGY_SENSOR]: [U.WATT, U.KILOWATT_HOUR, U.VOLT, U.AMPERE],
  [C.ENERGY_PRODUCTION_SENSOR]: [U.KILOWATT_HOUR],
  [C.SIGNAL]: [null],
  [C.BATTERY_LOW]: [null],
  [C.TEXT]: [null],
};

test('the status is made safe: MAC, firmware, inputs by kind, outputs', () => {
  assert.equal(status.mac, '5ccf7f123456');
  assert.equal(status.firmware, '02_08_04');
  assert.equal(status.name, 'IotaWatt');
  assert.equal(status.rssi, -61);
  assert.equal(status.lowBattery, false);
  assert.equal(status.lastKey % 5, 0);
  assert.deepEqual(
    status.inputs.map((input) => [input.channel, input.kind, input.value]),
    [
      [0, 'voltage', 231.4],
      [1, 'power', 1520],
      [2, 'power', 840],
      [4, 'power', -1200],
      [5, 'power', 0],
    ],
  );
  assert.equal(macOf('00:00:00:00:00:00'), null);
  assert.equal(macOf('5C-CF-7F-12-34-56'), '5ccf7f123456');
  const empty = parseStatus(null);
  assert.deepEqual([empty.mac, empty.firmware, empty.inputs, empty.outputs], [null, null, [], []]);
  assert.equal(parseStatus({ stats: { lowbat: 1 } }).lowBattery, true);
  assert.deepEqual(parseRows([[1, '2', null, 'x']]), [[1, '2', null, 'x']]);
  assert.deepEqual(parseRows({ data: [[1, 2]] }), [[1, 2]]);
});

test('channels: the inputs named by position when the kinds agree, the channel number otherwise', () => {
  assert.deepEqual(
    channels.map((channel) => [channel.key, channel.name, channel.unit, channel.supported]),
    [
      ['in0', 'Voltage', 'Volts', true],
      ['in1', 'Mains', 'Watts', true],
      ['in2', 'Heat_Pump', 'Watts', true],
      ['in4', 'Solar', 'Watts', true],
      ['in5', 'Oven', 'Watts', true],
      ['out-Total', 'Total', 'Watts', true],
      ['out-Mains_amps', 'Mains_amps', 'Amps', true],
      ['out-Mains_pf', 'Mains_pf', 'PF', false],
    ],
  );
  // The series list does not match the inputs: never a wrong name.
  const shifted = channelsOf(status, series.slice(1));
  assert.equal(shifted[1].name, 'Input 1');
  assert.equal(shifted[1].series, null, 'no query without its series name');
  assert.equal(channelsOf(status, [])[0].name, 'Input 0');
});

test('every feature is complete and uses a category / type / unit pair of the core', () => {
  const meter = { mac: status.mac, name: status.name, channels, bidirectional: { in4: true } };
  for (const language of LANGUAGES) {
    const devices = buildMeterDevices(fakeGladys, meter, { language });
    assert.equal(devices.length, 8, 'the PF output is left out');
    for (const device of devices) {
      assert.equal(device.should_poll, false);
      assert.equal(device.poll_frequency, undefined, 'its own timer');
      assert.ok(device.name.length <= 100);
      for (const feature of device.features) {
        for (const key of ['name', 'external_id', 'category', 'type', 'min', 'max']) {
          assert.ok(feature[key] !== undefined, `${feature.external_id}: ${key}`);
        }
        assert.equal(feature.read_only, true);
        assert.equal(feature.has_feedback, false);
        assert.ok(feature.min <= feature.max);
        assert.ok(UNITS_OF[feature.category]?.includes(feature.unit), feature.external_id);
        assert.ok(Object.values(T).some((types) => Object.values(types).includes(feature.type)));
      }
    }
  }
  const solar = buildMeterDevices(fakeGladys, meter).find((device) =>
    device.external_id.endsWith('-in4'),
  );
  assert.deepEqual(
    solar.features.map((feature) => [feature.category, feature.type, feature.unit, feature.min]),
    [
      ['energy-sensor', 'power', 'watt', -100000],
      ['energy-sensor', 'index', 'kilowatt-hour', 0],
      ['energy-production-sensor', 'index', 'kilowatt-hour', 0],
    ],
  );
});

test('states: rounded and bounded, the indexes in kWh, nothing unknown', () => {
  const meter = {
    mac: status.mac,
    channels,
    bidirectional: { in4: true },
    totals: { in1: { importWh: 1234.5678, exportWh: 0 }, in4: { importWh: 0, exportWh: 999.9 } },
    status: { rssi: -61.4, lowBattery: true, firmware: '02_08_04' },
  };
  const states = Object.fromEntries(
    buildMeterStates(fakeGladys, meter).map((state) => [
      state.device_feature_external_id.split(':').slice(-2).join(':'),
      state.state ?? state.text,
    ]),
  );
  assert.equal(states['5ccf7f123456:rssi'], -61);
  assert.equal(states['5ccf7f123456:rtc_battery_low'], 1);
  assert.equal(states['5ccf7f123456:firmware'], '02_08_04');
  assert.equal(states['5ccf7f123456-in1:energy'], 1.235);
  assert.equal(states['5ccf7f123456-in4:energy_export'], 1);
  assert.equal(states['5ccf7f123456-in4:power'], -1200);
  assert.equal(states['5ccf7f123456-in2:energy'], undefined, 'not counted yet');
  assert.equal(states['5ccf7f123456-out-Mains_pf:power'], undefined);
  const none = buildMeterStates(fakeGladys, { mac: status.mac, channels: [], status: {} });
  assert.deepEqual(none, []);
});

test('external ids read back; names', () => {
  assert.deepEqual(targetOf('ext:x:meter:5ccf7f123456'), {
    type: 'meter',
    mac: '5ccf7f123456',
    key: null,
  });
  assert.deepEqual(targetOf('ext:x:channel:5ccf7f123456-in3:power'), {
    type: 'channel',
    mac: '5ccf7f123456',
    key: 'in3',
  });
  assert.deepEqual(targetOf('ext:x:channel:5ccf7f123456-out-Solar_net'), {
    type: 'channel',
    mac: '5ccf7f123456',
    key: 'out-Solar_net',
  });
  assert.equal(targetOf('ext:x:tank:1'), null);
  assert.equal(targetOf(undefined), null);
  assert.equal(meterName({ name: 'IotaWatt' }), 'IoTaWatt');
  assert.equal(meterName({ name: 'Garage' }), 'IoTaWatt Garage');
  assert.equal(meterName({ name: 'IotaWatt_2' }), 'IotaWatt 2');
  assert.equal(
    channelName({ name: 'Garage' }, { name: 'Heat_Pump' }),
    'Heat Pump (IoTaWatt Garage)',
  );
});
