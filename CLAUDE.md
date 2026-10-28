# CLAUDE.md

Project rules for coding assistants (Claude Code reads this file) and for human
contributors.

## What this is

A Gladys Assistant **external integration** for **IoTaWatt** energy monitors
(open hardware: an ESP8266 with current clamps (CT) and a voltage transformer
(VT)): a Node.js service (Node 22+, ESM, no build step) in its own sandboxed
Docker container, talking to Gladys through
[`@gladysassistant/integration-sdk`](https://github.com/GladysAssistant/integration-sdk-js),
its only runtime dependency, and to each IoTaWatt over HTTP on the local
network, through its documented local API (`/status`, `/query?show=series`,
`/query?select=…`, <https://docs.iotawatt.com/en/master/query.html>). **Read
only.** `type: "device"`, Gladys 5.3.0+, `transports: ["local"]`,
`network_discovery: [{ type: "mdns", service: "_http._tcp" }]`. Not affiliated
with IoTaWatt, Inc.

**Never tested with a real IoTaWatt**: the shapes come from the documentation
and the firmware 02_08_04 sources (<https://github.com/boblemaire/IoTaWatt>:
`webServer.cpp` handleStatus, `CSVquery.cpp`, `auth.cpp`, `WiFi.cpp`), read for
the facts only. The firmware and the iotawattpy library are GPL-3.0: none of
their code is used.

## Commands

```bash
npm install
npm test                                  # node --test; a fake IoTaWatt network (status, series, queries, Digest, fake clock)
node --test test/app.test.js              # one file
UPDATE_BASELINE=1 npm test                # rewrite test/fixtures/discovery.baseline.json (on purpose only)
npm run lint                              # ESLint
npm run format:check                      # Prettier, as the CI runs it
npx github:GladysAssistant/integration-store . --skip-image-check   # store checks
scripts/build-cover.sh                    # cover.jpg from docs/assets/cover.svg
docs/illustrations/render.sh              # docs/assets/widgets.<lang>.png
node .github/scripts/release.mjs next     # the version the next release would get
```

## Architecture

```
index.js                 SDK wiring only (new GladysIntegration + createApp)
src/app.js               every handler; the timer (status, series, energy, discovery), devices and
                         states, scene events, the scene action, widgets (and their 5-minute history
                         cache), configuration buttons, status
src/iotawatt-api.js      HTTP client (node:http, no keep-alive, 10 s timeout): one queue per device,
                         HTTP Digest (MD5, qop=auth, nonce kept, nc increasing), the broken series list
src/parse.js             the answers made safe (absent is null, never 0); channels: inputs paired with
                         the series by position, outputs by name
src/energy.js            the energy windows (whole minutes, 12 h chunks, 7 days of catch-up) and the
                         import / export sums
src/device.js            the meter device and one device per channel, features and states
src/discovery.js         typed addresses, mDNS candidates (names containing "iota")
src/events.js            triggers (unreachable, back online, restarted), periods of the scene action
src/widgets.js           overview, one channel
src/time.js              the timezone of Gladys (Intl only)
src/store.js             /data/iotawatt.json (mode 0600; never the password)
src/config.js            addresses, user, password, interval, language
src/i18n.js              helpers; src/i18n-texts.js the runtime texts, en / fr / de / es
test/helpers/fake-iotawatt.js   the fake network (status, series, queries, Digest like auth.cpp)
test/fixtures/meter.json        a made-up IoTaWatt on the shapes of the firmware
.github/scripts/release.mjs     version, changelog, bump (tested in test/)
```

## Rules

- **External ids are forever**, and so is every key users store: the meter
  `ext:<selector>:meter:<mac>` (12 lowercase hexadecimal digits of the Wi-Fi
  MAC), an input `ext:<selector>:channel:<mac>-in<channel number>` (renaming
  it in the IoTaWatt keeps it), an output `ext:<selector>:channel:<mac>-out-<name>`
  (every character outside `[A-Za-z0-9_-]` replaced by `-`; renamed, it is a
  new device); features `…:<key>` (`rssi`, `rtc_battery_low`, `firmware`,
  `power`, `energy`, `energy_export`, `voltage`, `current`); feature
  `category` / `type` / `unit` / `min` / `max`, the keys of `config_schema` and
  `actions`, `last_language`, widgets and settings, triggers (fields,
  variables), the scene action (fields, options, outputs).
  `test/structure.test.js` compares them to
  `test/fixtures/discovery.baseline.json`: never update it to make a test pass
  without a documented migration.
- **Category pairs**: energy-sensor / power (watt, −100 000…100 000, signed),
  energy-sensor / index (kWh, what was drawn), energy-production-sensor / index
  (kWh, what was exported; only once the channel was seen negative),
  energy-sensor / voltage (volt), energy-sensor / current (ampere), signal /
  integer (dBm, no unit, −120…0), battery-low / binary (the clock battery),
  text / text (firmware). Units Watts, Volts and Amps only: VA, VAR, PF, Hz and
  the others are not offered.
- **The pace.** A timer reads `/status` every 10, 30 (default) or 60 s; the
  series list every 10 minutes or when the inputs change; once a minute the
  energy of the minutes logged since the last count. The discovery (typed
  addresses, mDNS through `gladys.scanNetwork`) runs at startup, on a scan, on
  **Search and test**, and every 30 minutes while an IoTaWatt is missing or
  unreachable. An address that is not an IoTaWatt is left alone 30 minutes.
  The widget history (3 queries) is cached 5 minutes; the scene action sends
  one query.
- **One request at a time per device** (an ESP8266): the client queues them,
  no keep-alive, a short pause between requests. Never query in parallel.
- **Energy indexes** come from the IoTaWatt's log (`<series>.wh.d3`, groups of
  1 minute, up to the `lastkey` of the Current log): positive minutes to
  `importWh`, negative ones to `exportWh`. They start at 0 when the series is
  first seen; a restart catches up, at most 7 days back. The cursor (first
  second not counted) is stored with the totals.
- **`should_poll` stays false**: the integration has its own timer.
- **Credentials**: the password is a `secret`, never logged, never in /data;
  only the Digest answer computed from it is sent. A new user or password
  drops the clients (new Digest sessions). Test credentials never look real
  (`not-a-real-password`).
- **Scene events** once per transition, never at the first reading of a
  meter, never from a scene action: worked out after each reading round.
  Unreachable after 3 failed readings and at least a minute.
- **Names**: the meter is offered as "IoTaWatt <name>", a channel as
  "<series name> (<meter name>)"; the widgets and scenes use the name the user
  gave in Gladys (`getDevices`, refreshed on create / update / delete).
- **The container rootfs is read-only.** Write only under `/data`.
- **Four languages.** Every user-facing text (manifest, `src/i18n-texts.js`,
  `docs/*.md`, README) exists in en, fr, de, es; `test/i18n.test.js` checks it.
  German says "du", Spanish "usted".
- **Widget images.** After any change to a widget content, run
  `docs/illustrations/render.sh` again and look at the four PNG files.
- **Versions belong to the Release workflow**: never edit `version` in
  `package.json`, the lockfile or the manifest, nor the `docker_image` tag.
  Below 1.0.0 until the maintainer runs Release with `release-as: 1.0.0`.
- **Changelog.** Ne jamais éditer CHANGELOG.md à la main, il est généré à la
  release. Écris le titre de PR comme la ligne que l'utilisateur lira.
- **Commits and PR titles** follow Conventional Commits, in English.
- **Forum drafts** (`.github/forum-*.md`) are never committed.
- **Style.** Prettier formats, ESLint catches mistakes. Comments explain why,
  in English. Tests never touch the network.

## Pitfalls

- `/status` gives the inputs by channel number without names, `show=series`
  the names without channel numbers: both list the active inputs in channel
  order, so they are paired by position, and only when the kinds agree
  (Watts / Volts). Otherwise an input is named "Input <n>" and has no series
  name: no query for it until the next series read.
- `show=series` of a firmware without any active input is not valid JSON
  (`{"series":{…},{…}]}` or `{"series":]}`): `repairJson` puts it right.
- The relative times of a query (`d`, `w`, `M`, `y`, `s`) are in the IoTaWatt's
  own local time, weeks start on Sunday: the periods of the scene action follow
  them. The energy counting uses Unix seconds, so it never depends on it.
- The firmware rounds `begin` up and `end` down to its 5-second interval; the
  windows are whole minutes, so nothing is lost.
- The firmware requires a `cnonce` in the Digest header and accepts each `nc`
  once, increasing; a 401 after a valid answer means a new session: answer the
  new nonce once, then report a refusal.
- "Local access" in the IoTaWatt skips the password for its own subnet; the
  container's requests leave through the host, so they usually qualify.
- mDNS: the IoTaWatt announces `<device name>._http._tcp` without TXT; only
  names containing "iota" are tried (a renamed device must be typed in).
- `node --test` also runs `test/helpers/`: nothing starts on import.
- The validator of the Gladys core creates `gladys-development.duckdb` in the
  current folder: run it from elsewhere.
