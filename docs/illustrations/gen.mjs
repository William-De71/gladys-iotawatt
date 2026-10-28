// Widget contents for the generated illustrations, built by the real code of
// the integration: the app itself (src/app.js) wired to the fake Gladys of the
// SDK and the fake IoTaWatt of the tests (test/helpers/fake-iotawatt.js), on
// Wednesday, 28 October 2026 at 12:15 in Paris. The made-up house: a heat
// pump that runs harder morning and evening, an oven at lunch and dinner,
// solar panels exporting at midday, and the mains CT that sees all of it.
// Smooth made-up curves (no randomness): never real data.
// Written as JSON for render.js: node gen.mjs <repo> <out.json>

import { readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';

const [repo, out] = process.argv.slice(2);
const load = (file) => import(pathToFileURL(join(repo, file)).href);
const { createApp } = await load('src/app.js');
const { LANGUAGES } = await load('src/i18n.js');
const { createFakeGladys } = await import(
  pathToFileURL(join(repo, 'node_modules/@gladysassistant/integration-sdk/lib/testing.js')).href
);
const { createFakeNetwork, sampleDevice, dataDir, recordingLogger } = await load(
  'test/helpers/fake-iotawatt.js',
);

const NOW = Date.parse('2026-10-28T11:15:00Z');
const ADDRESS = '192.168.1.20';
const MAC = '5ccf7f123456';
const manifest = JSON.parse(readFileSync(join(repo, 'gladys-assistant-integration.json'), 'utf8'));
// The three cards drawn: the overview, the grid with 24 hours of power
// (import and export), the heat pump with 14 days of energy.
const CARDS = {
  overview: { widget: 'overview', settings: {} },
  power: {
    widget: 'channel',
    settings: { channel: `ext:test-integration:channel:${MAC}-in1`, view: 'power_day' },
  },
  energy: {
    widget: 'channel',
    settings: { channel: `ext:test-integration:channel:${MAC}-in2`, view: 'energy_days' },
  },
};
// The names a user would give the devices in Gladys.
const NAMES = {
  en: {
    meter: 'Electrical panel',
    in1: 'Grid',
    in2: 'Heat pump',
    in4: 'Solar panels',
    in5: 'Oven',
    Total: 'House',
  },
  fr: {
    meter: 'Tableau électrique',
    in1: 'Réseau',
    in2: 'Pompe à chaleur',
    in4: 'Panneaux solaires',
    in5: 'Four',
    Total: 'Maison',
  },
  de: {
    meter: 'Sicherungskasten',
    in1: 'Netz',
    in2: 'Wärmepumpe',
    in4: 'Solaranlage',
    in5: 'Backofen',
    Total: 'Haus',
  },
  es: {
    meter: 'Cuadro eléctrico',
    in1: 'Red',
    in2: 'Bomba de calor',
    in4: 'Placas solares',
    in5: 'Horno',
    Total: 'Casa',
  },
};

// Local hours of Paris (UTC+1 after the end of summer time on 25 October).
const hourOf = (seconds) => (((seconds / 3600 + 1) % 24) + 24) % 24;
const dayOf = (seconds) => Math.floor((seconds + 3600) / 86400);
const bump = (hour, from, to) =>
  hour >= from && hour < to ? Math.sin((Math.PI * (hour - from)) / (to - from)) : 0;
const heatPump = (seconds) => {
  const hour = hourOf(seconds);
  const cold = 1 + 0.15 * Math.sin(dayOf(seconds) / 2);
  return Math.round(
    cold * (320 + 1100 * bump(hour, 5.5, 9.5) + 900 * bump(hour, 17, 23) + 60 * Math.sin(hour * 3)),
  );
};
const oven = (seconds) => {
  const hour = hourOf(seconds);
  return (hour >= 11.9 && hour < 12.6) || (hour >= 19.2 && hour < 19.9) ? 2100 : 0;
};
const solar = (seconds) => {
  const clouds = 0.55 + 0.4 * Math.abs(Math.sin(dayOf(seconds) * 1.7));
  return -Math.round(2600 * clouds * bump(hourOf(seconds), 8, 17.5));
};
const base = (seconds) => 230 + 40 * Math.sin(hourOf(seconds));
const mains = (seconds) => heatPump(seconds) + oven(seconds) + base(seconds) + solar(seconds);

/**
 * @description One language: the app run for a few minutes, then the widgets.
 * @param {string} language - Language.
 * @returns {Promise<object>} The widget contents.
 */
async function contents(language) {
  const clock = { now: NOW - 5 * 60000 };
  const network = createFakeNetwork({ clock });
  const at = () => Math.floor(clock.now / 1000);
  const device = sampleDevice({ startedAt: NOW - 6 * 86400000 - 7 * 3600000, rssi: -63 });
  const live = { 1: mains, 2: heatPump, 4: solar, 5: oven };
  device.inputs = device.inputs.map((input) =>
    live[input.channel]
      ? {
          ...input,
          history: live[input.channel],
          get value() {
            return live[input.channel](at());
          },
        }
      : input,
  );
  const total = (seconds) => mains(seconds) - solar(seconds);
  device.outputs = [
    {
      name: 'Total',
      units: 'Watts',
      history: total,
      get value() {
        return total(at());
      },
    },
  ];
  network.add(ADDRESS, device);
  const gladys = createFakeGladys({ config: { hosts: ADDRESS, language } });
  const app = createApp(gladys, {
    get: network.get,
    dataDir: dataDir(),
    now: () => clock.now,
    sleep: async () => {},
    timeZone: 'Europe/Paris',
    timers: false,
    logger: recordingLogger(),
  });
  await gladys.connect();
  await app.whenReady();
  for (let i = 0; i < 10; i += 1) {
    await app.tick();
    clock.now += 30000;
  }
  for (const discovered of gladys.fake.discoveredDevices) {
    const key = discovered.external_id.includes(':meter:')
      ? 'meter'
      : discovered.external_id.split('-').pop();
    await gladys.fake.deviceCreated({
      ...structuredClone(discovered),
      name: NAMES[language][key] ?? discovered.name,
    });
  }
  clock.now = NOW;
  await app.tick();
  const result = {};
  for (const [name, { widget, settings }] of Object.entries(CARDS)) {
    result[name] = (await gladys.fake.widgetGet(widget, { settings, language })).data.content;
  }
  await gladys.fake.shutdown();
  return result;
}

const all = {};
for (const language of LANGUAGES) {
  all[language] = await contents(language);
}

const card = (key) => {
  const widget = manifest.widgets.find((item) => item.key === key);
  return { icon: widget.icon, label: widget.label };
};
writeFileSync(
  out,
  JSON.stringify({
    contents: all,
    images: {},
    cards: Object.fromEntries(
      Object.entries(CARDS).map(([name, { widget }]) => [name, card(widget)]),
    ),
    now: NOW,
  }),
);
