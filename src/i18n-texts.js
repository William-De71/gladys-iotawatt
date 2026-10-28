// -----------------------------------------------------------------------------
// Texts of the IoTaWatt integration, in English, French, German and Spanish
// (English fallback).
//
// The manifest carries its own labels; these are the texts the code writes at
// runtime: feature names, widget contents, scene texts, errors, results of
// the configuration buttons. Vocabulary of the Gladys interface (appareil /
// Gerät / dispositivo). German says "du", Spanish "usted", like Gladys.
// -----------------------------------------------------------------------------

const TEXTS = {
  // features (names shown by the dashboard when several share a type)
  feature_power: { en: 'Power', fr: 'Puissance', de: 'Leistung', es: 'Potencia' },
  feature_energy: {
    en: 'Energy consumed',
    fr: 'Énergie consommée',
    de: 'Verbrauchte Energie',
    es: 'Energía consumida',
  },
  feature_energy_export: {
    en: 'Energy exported',
    fr: 'Énergie injectée',
    de: 'Eingespeiste Energie',
    es: 'Energía exportada',
  },
  feature_voltage: { en: 'Voltage', fr: 'Tension', de: 'Spannung', es: 'Tensión' },
  feature_current: { en: 'Current', fr: 'Intensité', de: 'Stromstärke', es: 'Intensidad' },
  feature_rssi: { en: 'Wi-Fi signal', fr: 'Signal Wi-Fi', de: 'WLAN-Signal', es: 'Señal Wi-Fi' },
  feature_rtc_battery_low: {
    en: 'Clock battery low',
    fr: 'Pile de l’horloge faible',
    de: 'Uhrbatterie schwach',
    es: 'Pila del reloj baja',
  },
  feature_firmware: { en: 'Firmware', fr: 'Micrologiciel', de: 'Firmware', es: 'Firmware' },

  // connection status
  statusNoMeter: {
    en: 'No IoTaWatt found. Type its address (IP or name) in the configuration, then press “Search”.',
    fr: 'Aucun IoTaWatt trouvé. Saisissez son adresse (IP ou nom) dans la configuration, puis appuyez sur « Rechercher ».',
    de: 'Kein IoTaWatt gefunden. Gib seine Adresse (IP oder Name) in der Konfiguration ein und drücke dann „Suchen“.',
    es: 'No se encontró ningún IoTaWatt. Introduzca su dirección (IP o nombre) en la configuración y pulse «Buscar».',
  },
  statusOk: {
    en: '{meters} IoTaWatt, {channels} channel(s).',
    fr: '{meters} IoTaWatt, {channels} voie(s).',
    de: '{meters} IoTaWatt, {channels} Kanal/Kanäle.',
    es: '{meters} IoTaWatt, {channels} canal(es).',
  },
  statusSomeDown: {
    en: 'Not answering: {names}.',
    fr: 'Ne répond pas : {names}.',
    de: 'Antwortet nicht: {names}.',
    es: 'No responde: {names}.',
  },
  statusDown: {
    en: 'The IoTaWatt does not answer: {names}.',
    fr: 'L’IoTaWatt ne répond pas : {names}.',
    de: 'Der IoTaWatt antwortet nicht: {names}.',
    es: 'El IoTaWatt no responde: {names}.',
  },

  // errors
  errAuth: {
    en: 'The IoTaWatt {address} asks for a password, or refuses the one given: check the user and the password in the configuration.',
    fr: 'L’IoTaWatt {address} demande un mot de passe, ou refuse celui saisi : vérifiez l’utilisateur et le mot de passe dans la configuration.',
    de: 'Der IoTaWatt {address} verlangt ein Passwort oder lehnt das eingegebene ab: Prüfe Benutzer und Passwort in der Konfiguration.',
    es: 'El IoTaWatt {address} pide una contraseña o rechaza la introducida: compruebe el usuario y la contraseña en la configuración.',
  },
  errUnreachable: {
    en: 'No answer from {address}: check the address and that the IoTaWatt is on the network.',
    fr: 'Pas de réponse de {address} : vérifiez l’adresse et que l’IoTaWatt est bien sur le réseau.',
    de: 'Keine Antwort von {address}: Prüfe die Adresse und ob der IoTaWatt im Netzwerk ist.',
    es: 'Sin respuesta de {address}: compruebe la dirección y que el IoTaWatt esté en la red.',
  },
  errNotIotaWatt: {
    en: '{address} answers, but it is not an IoTaWatt.',
    fr: '{address} répond, mais ce n’est pas un IoTaWatt.',
    de: '{address} antwortet, ist aber kein IoTaWatt.',
    es: '{address} responde, pero no es un IoTaWatt.',
  },
  errFailed: {
    en: 'The IoTaWatt could not be read: {detail}',
    fr: 'Impossible de lire l’IoTaWatt : {detail}',
    de: 'Der IoTaWatt konnte nicht gelesen werden: {detail}',
    es: 'No se pudo leer el IoTaWatt: {detail}',
  },
  errNoChannel: {
    en: 'No channel of this IoTaWatt can be used here (a power channel is needed).',
    fr: 'Aucune voie de cet IoTaWatt n’est utilisable ici (il faut une voie de puissance).',
    de: 'Kein Kanal dieses IoTaWatt ist hier nutzbar (ein Leistungskanal wird benötigt).',
    es: 'Ningún canal de este IoTaWatt sirve aquí (se necesita un canal de potencia).',
  },

  // configuration buttons
  searchOk: {
    en: '{count} IoTaWatt found: {names}. Its channels are on the “Discover” screen.',
    fr: '{count} IoTaWatt trouvé(s) : {names}. Ses voies sont dans l’écran « Découverte ».',
    de: '{count} IoTaWatt gefunden: {names}. Die Kanäle stehen im Bildschirm „Entdecken“.',
    es: '{count} IoTaWatt encontrado(s): {names}. Sus canales están en la pantalla «Descubrir».',
  },
  searchNone: {
    en: 'No IoTaWatt found on the network. Type its address (IP or name) in the configuration and save.',
    fr: 'Aucun IoTaWatt trouvé sur le réseau. Saisissez son adresse (IP ou nom) dans la configuration et enregistrez.',
    de: 'Kein IoTaWatt im Netzwerk gefunden. Gib seine Adresse (IP oder Name) in der Konfiguration ein und speichere.',
    es: 'No se encontró ningún IoTaWatt en la red. Introduzca su dirección (IP o nombre) en la configuración y guarde.',
  },
  diagnosticDone: {
    en: 'Diagnostic written to the logs of the integration ({count} line(s)).',
    fr: 'Diagnostic écrit dans les journaux de l’intégration ({count} ligne(s)).',
    de: 'Diagnose in die Protokolle der Integration geschrieben ({count} Zeile(n)).',
    es: 'Diagnóstico escrito en los registros de la integración ({count} línea(s)).',
  },

  // time
  never: { en: 'never', fr: 'jamais', de: 'nie', es: 'nunca' },
  justNow: { en: 'just now', fr: 'à l’instant', de: 'gerade eben', es: 'ahora mismo' },
  minutesAgo: { en: '{n} min ago', fr: 'il y a {n} min', de: 'vor {n} Min.', es: 'hace {n} min' },
  hoursAgo: { en: '{n} h ago', fr: 'il y a {n} h', de: 'vor {n} Std.', es: 'hace {n} h' },
  daysAgo: { en: '{n} d ago', fr: 'il y a {n} j', de: 'vor {n} T.', es: 'hace {n} d' },
  uptimeDays: { en: '{d} d {h} h', fr: '{d} j {h} h', de: '{d} T. {h} Std.', es: '{d} d {h} h' },
  uptimeHours: {
    en: '{h} h {m} min',
    fr: '{h} h {m} min',
    de: '{h} Std. {m} Min.',
    es: '{h} h {m} min',
  },
  uptimeMinutes: { en: '{m} min', fr: '{m} min', de: '{m} Min.', es: '{m} min' },

  // widgets
  rowState: { en: 'State', fr: 'État', de: 'Zustand', es: 'Estado' },
  stateOnline: { en: 'Online', fr: 'En ligne', de: 'Online', es: 'En línea' },
  stateUnreachable: {
    en: 'Not answering',
    fr: 'Ne répond pas',
    de: 'Antwortet nicht',
    es: 'No responde',
  },
  rowLastReading: {
    en: 'Last reading',
    fr: 'Dernière lecture',
    de: 'Letzte Abfrage',
    es: 'Última lectura',
  },
  rowWifi: { en: 'Wi-Fi signal', fr: 'Signal Wi-Fi', de: 'WLAN-Signal', es: 'Señal Wi-Fi' },
  rowClockBattery: {
    en: 'Clock battery',
    fr: 'Pile de l’horloge',
    de: 'Uhrbatterie',
    es: 'Pila del reloj',
  },
  batteryOk: { en: 'OK', fr: 'OK', de: 'OK', es: 'OK' },
  batteryLow: { en: 'Replace it', fr: 'À remplacer', de: 'Ersetzen', es: 'Cambiarla' },
  rowUptime: { en: 'Running for', fr: 'Allumé depuis', de: 'Läuft seit', es: 'En marcha desde' },
  rowFirmware: { en: 'Firmware', fr: 'Micrologiciel', de: 'Firmware', es: 'Firmware' },
  widgetNoPower: {
    en: 'No power channel read yet.',
    fr: 'Aucune voie de puissance lue pour l’instant.',
    de: 'Noch kein Leistungskanal gelesen.',
    es: 'Aún no se ha leído ningún canal de potencia.',
  },
  widgetMore: {
    en: '+ {count} other power channel(s)',
    fr: '+ {count} autre(s) voie(s) de puissance',
    de: '+ {count} weitere(r) Leistungskanal/-kanäle',
    es: '+ {count} canal(es) de potencia más',
  },
  tileNow: { en: 'Now', fr: 'Maintenant', de: 'Jetzt', es: 'Ahora' },
  tileToday: { en: 'Today', fr: 'Aujourd’hui', de: 'Heute', es: 'Hoy' },
  tileYesterday: { en: 'Yesterday', fr: 'Hier', de: 'Gestern', es: 'Ayer' },
  chartPowerDay: {
    en: 'Power, last 24 hours',
    fr: 'Puissance sur 24 heures',
    de: 'Leistung der letzten 24 Stunden',
    es: 'Potencia de las últimas 24 horas',
  },
  chartValueDay: {
    en: 'Last 24 hours',
    fr: 'Sur 24 heures',
    de: 'Letzte 24 Stunden',
    es: 'Últimas 24 horas',
  },
  chartEnergyDays: {
    en: 'Energy per day, 14 days',
    fr: 'Énergie par jour sur 14 jours',
    de: 'Energie pro Tag, 14 Tage',
    es: 'Energía por día, 14 días',
  },
  chartEnergyMonths: {
    en: 'Energy per month, 12 months',
    fr: 'Énergie par mois sur 12 mois',
    de: 'Energie pro Monat, 12 Monate',
    es: 'Energía por mes, 12 meses',
  },
  widgetNoHistory: {
    en: 'The IoTaWatt log has no data for this period yet.',
    fr: 'Le journal de l’IoTaWatt n’a pas encore de données sur cette période.',
    de: 'Das Protokoll des IoTaWatt hat für diesen Zeitraum noch keine Daten.',
    es: 'El registro del IoTaWatt aún no tiene datos de este periodo.',
  },
  widgetDown: {
    en: 'The IoTaWatt does not answer: the values shown are the last ones read.',
    fr: 'L’IoTaWatt ne répond pas : les valeurs affichées sont les dernières lues.',
    de: 'Der IoTaWatt antwortet nicht: Angezeigt werden die zuletzt gelesenen Werte.',
    es: 'El IoTaWatt no responde: los valores mostrados son los últimos leídos.',
  },

  // scenes
  event_meter_unreachable: {
    en: '{name} does not answer any more.',
    fr: '{name} ne répond plus.',
    de: '{name} antwortet nicht mehr.',
    es: '{name} ya no responde.',
  },
  event_meter_back_online: {
    en: '{name} answers again.',
    fr: '{name} répond de nouveau.',
    de: '{name} antwortet wieder.',
    es: '{name} vuelve a responder.',
  },
  event_meter_restarted: {
    en: '{name} restarted.',
    fr: '{name} a redémarré.',
    de: '{name} wurde neu gestartet.',
    es: '{name} se ha reiniciado.',
  },
  summaryEnergy: {
    en: '{name}: {energy} kWh {period} (average {average} W).',
    fr: '{name} : {energy} kWh {period} (moyenne {average} W).',
    de: '{name}: {energy} kWh {period} (Durchschnitt {average} W).',
    es: '{name}: {energy} kWh {period} (media {average} W).',
  },
  period_today: { en: 'today', fr: 'aujourd’hui', de: 'heute', es: 'hoy' },
  period_yesterday: { en: 'yesterday', fr: 'hier', de: 'gestern', es: 'ayer' },
  period_this_week: { en: 'this week', fr: 'cette semaine', de: 'diese Woche', es: 'esta semana' },
  period_last_week: {
    en: 'last week',
    fr: 'la semaine dernière',
    de: 'letzte Woche',
    es: 'la semana pasada',
  },
  period_this_month: { en: 'this month', fr: 'ce mois-ci', de: 'diesen Monat', es: 'este mes' },
  period_last_month: {
    en: 'last month',
    fr: 'le mois dernier',
    de: 'letzten Monat',
    es: 'el mes pasado',
  },
  period_this_year: { en: 'this year', fr: 'cette année', de: 'dieses Jahr', es: 'este año' },
  period_last_24_hours: {
    en: 'over the last 24 hours',
    fr: 'sur les dernières 24 heures',
    de: 'in den letzten 24 Stunden',
    es: 'en las últimas 24 horas',
  },
  period_last_7_days: {
    en: 'over the last 7 days',
    fr: 'sur les 7 derniers jours',
    de: 'in den letzten 7 Tagen',
    es: 'en los últimos 7 días',
  },
  period_last_30_days: {
    en: 'over the last 30 days',
    fr: 'sur les 30 derniers jours',
    de: 'in den letzten 30 Tagen',
    es: 'en los últimos 30 días',
  },
};

export { TEXTS };
