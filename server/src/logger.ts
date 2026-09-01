// SPDX-License-Identifier: MIT
// Copyright (c) 2026 OFFIS e.V. (http://www.offis.de). Teilweise KI-generiert (siehe NOTICE.md). Ohne Gewaehrleistung.

// Zentrales Logging: schreibt Meldungen mit Zeitstempel in die Datenbank
// (Tabelle logs) statt auf die Server-Konsole. Auf der Debug-Seite des
// Frontends können sie gefiltert, sortiert und gelöscht werden.
//
// Level: debug < info < warn < error. Welche Level tatsächlich gespeichert
// werden, steuert das Mindest-Level (Setting "logMinLevel"), einstellbar
// über die Debug-Seite.

import * as db from "./db.js";

export const log = {
  debug: (source: string, msg: string) => db.addLog(db.LOG_LEVELS.debug, source, msg),
  info: (source: string, msg: string) => db.addLog(db.LOG_LEVELS.info, source, msg),
  warn: (source: string, msg: string) => db.addLog(db.LOG_LEVELS.warn, source, msg),
  error: (source: string, msg: string) => db.addLog(db.LOG_LEVELS.error, source, msg),
};
