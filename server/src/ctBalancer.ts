// SPDX-License-Identifier: MIT
// Copyright (c) 2026 OFFIS e.V. (http://www.offis.de). Teilweise KI-generiert (siehe NOTICE.md). Ohne Gewaehrleistung.

// Multi-Speicher-Balancer für die CT002/CT003-Emulation.
//
// Hintergrund: Beim CT-Protokoll pollt JEDER gekoppelte Speicher das CT einzeln
// und meldet dabei seine aktuelle Ausgangsleistung. Das CT antwortet mit einem
// Grid-Reading, das der Speicher zu seiner Leistung addiert
// (new_output = reported + reading). Gäbe das CT jedem Speicher das VOLLE
// Netz-Reading, würde jeder allein die gesamte Abweichung ausregeln – die
// Speicher schaukeln sich gegenseitig auf. Der echte Zähler (bzw. AstraMeter)
// teilt das Reading daher gewichtet auf die aktiven Speicher auf, sodass in
// Summe genau die Netzabweichung ausgeregelt wird, jeder Speicher aber nur
// seinen Anteil übernimmt.
//
// Diese Umsetzung ist eine bewusst fokussierte Portierung der AstraMeter-
// Kernlogik (tomquist/AstraMeter, ct002/balancer.py): Consumer-Tracking mit
// adaptivem Ablauf und gewichtete fair-share-Aufteilung. Die vielen
// Feintuning-Schichten des Originals (Effizienz-Rotation, Sättigungs-Detektor,
// Probing, Oszillationsdämpfung) sind NICHT enthalten – sie optimieren
// Grenzfälle, sind aber für die grundlegende, korrekte Lastteilung nicht nötig.

// Ein pollender Speicher (Consumer), identifiziert über IP + gemeldete Phase.
interface CtConsumer {
  key: string;
  ip: string;           // Absender-IP (zur Anzeige)
  phase: string;        // "A"/"B"/"C"/"D" oder "0" (Inspektion)
  reportedPower: number; // zuletzt gemeldete eigene Ausgangsleistung (W)
  lastSeen: number;     // ms-Zeitstempel des letzten Polls
  pollInterval: number | null; // geglättetes Poll-Intervall (ms)
  weight: number;       // Verteilungsgewicht (Standard 1)
  lastTargetShare: number; // zuletzt berechneter absoluter Zielanteil (W)
  lastReading: number;  // zuletzt gesendetes Grid-Reading/Delta (W)
  // Sättigungs-Erkennung: Zählt, wie oft in Folge der Speicher trotz eines
  // Ziels über seiner aktuellen Leistung NICHT weiter mitzieht (technische
  // Leistungsgrenze erreicht). Getrennt für Lade- (negativ) und Entladerichtung
  // (positiv). Wird zurückgesetzt, sobald der Speicher wieder folgt.
  satChargeCount: number;    // Ladung (reportedPower kommt nicht unter Ziel)
  satDischargeCount: number; // Entladung (reportedPower kommt nicht über Ziel)
  // Geschätzte Leistungsgrenze je Richtung (W, Betrag), aus der beobachteten
  // Sättigung gelernt. undefined = noch keine Grenze erkannt.
  capChargeW?: number;
  capDischargeW?: number;
  // War das zuletzt gesendete Delta durch die Slew-Rate (maxStepW) begrenzt? Dann
  // fährt der Speicher noch kontrolliert Richtung Ziel und liegt NICHT wegen einer
  // technischen Grenze zurück – die Sättigungserkennung darf die Rampe dann nicht
  // als Sättigung werten.
  lastStepLimited?: boolean;
  // reportedPower aus dem vorigen Poll, um Bewegung (Rampe) von Stillstand
  // (echte Grenze) zu unterscheiden.
  prevReportedPower?: number;
  // Netz-Sollwert (gridReading), der bei der VORHERIGEN Abfrage dieses Speichers
  // galt. Dient der "Frische"-Erkennung: Ist der Wert unverändert, stammt die
  // Netzmessung (Shelly) noch aus demselben Messzyklus – der Speicher hat auf
  // eine evtl. schon gesendete Korrektur real noch nicht sichtbar gewirkt. Dann
  // KEIN neues volles Delta senden (sonst Doppelzählung -> Überschwingen).
  lastGridReadingSeen?: number;
  // Zähl-Absicherung: erst nach dieser Zahl unveränderter (blinder) Polls wird
  // wieder ein Delta zugelassen, falls der Netzwert doch länger konstant bleibt
  // (z.B. echtes stationäres Netz) – verhindert dauerhaftes Einfrieren.
  staleReadingCount?: number;
}

// Momentaufnahme des Balancer-Zustands für die Anzeige.
export interface CtBalancerSnapshot {
  active: boolean;            // mindestens ein aktiver Speicher?
  fadeout: boolean;          // läuft gerade ein Ausfaden auf 0?
  gridReading: number;        // aktuelle Gesamt-Netzabweichung (W)
  gesamtIst: number;          // Summe der gemeldeten Speicherleistungen (W)
  gesamtZiel: number;         // absolutes Gesamtziel (W)
  // Alternierende Entladung: IP des aktuell aktiven Speichers (oder null, wenn
  // der Modus aus ist oder kein aktiver bestimmt wurde).
  aktiverIp: string | null;
  consumers: Array<{
    ip: string;
    phase: string;
    reportedPower: number;    // was der Speicher gerade tut (W)
    targetShare: number;      // sein absoluter Zielanteil (W)
    reading: number;          // gesendetes Delta (W)
    weight: number;
    ageMs: number;            // wie lange her seit letztem Poll
    capChargeW: number | null;    // gelernte Ladegrenze (W, Betrag) oder null
    capDischargeW: number | null; // gelernte Entladegrenze (W, Betrag) oder null
    aktiv: boolean;           // ist dies der aktive Speicher (alternierend)?
  }>;
}

// Adaptive Ablaufzeit: ein Speicher gilt als "weg", wenn er ~2 seiner eigenen
// Poll-Zyklen auslässt (wie der echte CT). Grenzen zur Absicherung.
const TTL_MIN_MS = 8_000;
const TTL_POLL_MULTIPLIER = 2.2;
const TTL_FALLBACK_MS = 15_000;
const POLL_EMA_ALPHA = 0.3;
// Sättigungs-Erkennung: Ein Speicher gilt als an seiner Leistungsgrenze, wenn
// er über so viele aufeinanderfolgende Polls dem geforderten (höheren) Ziel
// nicht näher kommt. Kleiner Wert = schnelles Umverteilen, aber empfindlicher
// gegen Rauschen; 3 ist ein robuster Kompromiss.
const SAT_CONFIRM_COUNT = 3;
// Wie weit reportedPower hinter dem Ziel liegen muss (W), damit es als "folgt
// nicht" zählt (Toleranz gegen Messrauschen und Regel-Restfehler).
const SAT_GAP_W = 80;
// Sicherheitsaufschlag auf die gelernte Grenze (W): die reale Grenze liegt etwas
// über dem zuletzt gesehenen Wert; so wird sie nicht zu niedrig eingefroren.
const SAT_CAP_MARGIN_W = 50;

// SoC-Stufen für die alternierende Entladung (in %). Der aktive Speicher entlädt,
// bis er die nächste Stufe UNTER seinem SoC bei Aktivierung erreicht.
const SOC_STUFEN = [100, 75, 50, 25, 12];

// Liefert die nächste Stufengrenze unterhalb eines SoC-Werts (die Schwelle, bei
// deren Unterschreiten der aktive Speicher gewechselt wird). Für SoC über 100
// gilt 75 als nächste; unter/gleich 12 gibt es keine weitere -> null.
function naechsteStufeUnter(soc: number): number | null {
  for (const s of SOC_STUFEN) {
    if (s < soc) return s;
  }
  return null;
}

export class CtBalancer {
  private consumers = new Map<string, CtConsumer>();
  private lastGridReading = 0; // zuletzt verarbeitete Netzabweichung (für snapshot)
  private fadeoutActive = false; // läuft gerade ein Ausfaden auf 0?
  // Alternierende Entladung: Schlüssel (IP|Phase) des aktuell "aktiven" Speichers
  // und die Stufengrenze, bei deren Unterschreiten gewechselt wird. null = noch
  // keiner bestimmt.
  private aktiverKey: string | null = null;
  private aktiverStufe: number | null = null;
  // Zuletzt gesehener maxStepW-Wert (für die dynamische Rest-Verteilung im
  // alternierenden Modus, wo damping nicht direkt vorliegt).
  private lastMaxStepW = 0;

  // Consumer-Schlüssel aus Absender-IP und gemeldeter Phase. Die Phase gehört
  // dazu, weil ein Speicher im Inspektionsmodus ("0") und im Betrieb ("A".."D")
  // getrennt geführt wird, bis seine Phase feststeht.
  private keyFor(ip: string, phase: string): string {
    return `${ip}|${phase || "0"}`;
  }

  private ttlMs(c: CtConsumer): number {
    if (c.pollInterval == null) return TTL_FALLBACK_MS;
    return Math.max(TTL_MIN_MS, TTL_POLL_MULTIPLIER * c.pollInterval);
  }

  private isExpired(c: CtConsumer, now: number): boolean {
    return now - c.lastSeen > this.ttlMs(c);
  }

  // Registriert/aktualisiert einen pollenden Speicher und gibt sein Grid-Reading
  // (den Anteil an der Gesamt-Netzabweichung) zurück, den er als Phasenwert
  // erhalten soll. `gridReading` ist die gesamte auszuregelnde Netzleistung.
  // `weight` erlaubt eine ungleiche Aufteilung (Standard 1 = gleichmäßig).
  // Registriert/aktualisiert einen pollenden Speicher und gibt das GRID-READING
  // (Delta) zurück, das dieser Speicher auf seiner Phase erhalten soll. Der
  // Speicher rechnet intern `neue_leistung = reportedPower + reading`, landet also
  // auf einem absoluten Ziel.
  //
  // Kernidee (wie AstraMeter): Nicht die rohe Netzabweichung an jeden Speicher
  // geben – das ließe mehrere Speicher gleichzeitig überschwingen und
  // gegeneinander arbeiten. Stattdessen ein ABSOLUTES Gesamtziel bilden und
  // gewichtet aufteilen:
  //   gesamtLeistungIst  = Summe der aktuell gemeldeten Speicherleistungen
  //   gesamtZiel         = gesamtLeistungIst + gridReading
  //       (um die Netzabweichung gridReading auszugleichen, muss die kombinierte
  //        Speicherleistung um genau gridReading steigen)
  //   zielAnteil_i       = gesamtZiel * gewicht_i / gesamtGewicht
  //   reading_i          = zielAnteil_i − reportedPower_i   (Delta an Speicher i)
  //
  // `reportedPower`/`gridReading` teilen dieselbe Vorzeichen-/Einheiten-Basis
  // (W): positiver Netzwert = Bezug (Speicher soll mehr liefern), negativer =
  // Überschuss (Speicher soll laden / weniger liefern).
  report(
    ip: string,
    phase: string,
    reportedPower: number,
    gridReading: number,
    weight = 1,
    damping?: { deadbandW?: number; maxStepW?: number; fadeout?: boolean; fadeStepW?: number; noAcCharge?: boolean; maxTotalW?: number; balanceStepW?: number; balanceToleranceW?: number; alternierendeEntladung?: boolean; socByIp?: Record<string, number> },
  ): number {
    const now = Date.now();
    // Begrenzt den finalen CT-Wert je nach Modus "kein AC-Laden": negative Werte
    // (die den Speicher zum Laden bewegen würden) werden auf 0 gekappt, positive
    // normal durchgereicht. Wird auf jeden Rückgabepfad angewendet.
    const clampNoAcCharge = (v: number): number => (damping?.noAcCharge && v < 0 ? 0 : v);
    // Fadeout-Modus: Die Speicher werden aktiv und kontrolliert auf 0 W
    // Batterieleistung gefahren (unabhängig von der Netzbilanz) und dort
    // gehalten. Das Ziel ist fix 0; das gesendete Delta ist ein begrenzter
    // Schritt Richtung 0 (Rampe), damit sie in wenigen Zyklen sanft auf 0 gehen
    // statt hart zu springen. Wird genutzt, um die AC-Speicher herunterzufahren,
    // bevor die DC-Speicher übernehmen.
    if (damping?.fadeout) {
      const step = damping.fadeStepW && damping.fadeStepW > 0 ? damping.fadeStepW : 150;
      // Zielzustand 0: Delta = 0 - reportedPower, auf Schrittweite begrenzt.
      let reading = -reportedPower;
      if (reading > step) reading = step;
      else if (reading < -step) reading = -step;
      // Consumer-Tracking für die Anzeige aktualisieren.
      const key = this.keyFor(ip, phase);
      let c = this.consumers.get(key);
      if (!c) c = { key, ip, phase, reportedPower, lastSeen: now, pollInterval: null, weight, lastTargetShare: 0, lastReading: 0, satChargeCount: 0, satDischargeCount: 0 };
      else { c.reportedPower = reportedPower; c.lastSeen = now; c.phase = phase; c.ip = ip; }
      c.lastTargetShare = 0;
      c.lastReading = Math.round(reading);
      this.consumers.set(key, c);
      this.cleanup(now);
      this.lastGridReading = gridReading;
      this.fadeoutActive = true;
      return Math.round(reading);
    }
    this.fadeoutActive = false;
    // Totband: Liegt die Netzabweichung betragsmäßig unter der Schwelle, gar
    // nicht nachregeln – verhindert das „Jagen" um den Nullpunkt. Wird auf die
    // rohe Netzabweichung angewandt, bevor daraus ein Ziel wird.
    const deadband = damping?.deadbandW ?? 0;
    if (deadband > 0 && Math.abs(gridReading) < deadband) {
      gridReading = 0;
    }
    this.lastGridReading = gridReading;
    const key = this.keyFor(ip, phase);
    let c = this.consumers.get(key);
    if (!c) {
      c = { key, ip, phase, reportedPower, lastSeen: now, pollInterval: null, weight, lastTargetShare: 0, lastReading: 0, satChargeCount: 0, satDischargeCount: 0 };
    } else {
      const raw = now - c.lastSeen;
      c.pollInterval = c.pollInterval == null
        ? raw
        : Math.round(POLL_EMA_ALPHA * raw + (1 - POLL_EMA_ALPHA) * c.pollInterval);
      c.reportedPower = reportedPower;
      c.lastSeen = now;
      c.phase = phase;
      c.weight = weight;
      c.ip = ip;
    }
    this.consumers.set(key, c);
    this.cleanup(now);

    // Im Inspektionsmodus (Phase noch nicht bestimmt) kein Ziel vorgeben.
    if (phase !== "A" && phase !== "B" && phase !== "C" && phase !== "D") return 0;

    // Aktive Speicher (nicht abgelaufen, echte Phase) für die Aufteilung.
    const active = [...this.consumers.values()].filter(
      (x) => !this.isExpired(x, now) && ["A", "B", "C", "D"].includes(x.phase)
    );
    const totalWeight = active.reduce((s, x) => s + (x.weight > 0 ? x.weight : 0), 0);

    // Aktuelle kombinierte Speicherleistung (Summe der gemeldeten Werte aller
    // aktiven Speicher). Das ist der Bezugspunkt für das absolute Gesamtziel.
    const gesamtIst = active.reduce((s, x) => s + x.reportedPower, 0);

    // Absolutes Gesamtziel: aktuelle Speicherleistung plus auszugleichende
    // Netzabweichung.
    let gesamtZiel = gesamtIst + gridReading;

    // Gesamtlimit ("Max. Leistung" der Senke): begrenzt die kombinierte
    // Batterieleistung ALLER Speicher symmetrisch (±maxTotalW). Anders als das
    // Klemmen der reinen Netzabweichung (gridReading) begrenzt dies das absolute
    // Ziel – erst dadurch wirkt die Einstellung als echte obere Leistungsgrenze
    // für den Multi-Speicher-Verbund (Laden wie Entladen). 0/undefined = aus.
    const maxTotal = damping?.maxTotalW && damping.maxTotalW > 0 ? damping.maxTotalW : 0;
    if (maxTotal > 0) {
      if (gesamtZiel > maxTotal) gesamtZiel = maxTotal;
      else if (gesamtZiel < -maxTotal) gesamtZiel = -maxTotal;
    }

    // --- Sättigungs-Erkennung je Speicher aktualisieren ---
    // Ein Speicher ist gesättigt, wenn er dem geforderten Ziel in einer Richtung
    // nicht folgt (reportedPower bleibt betragsmäßig hinter dem Ziel zurück),
    // also seine technische Leistungsgrenze erreicht hat. Wichtig für Stabilität:
    // Eine einmal gelernte Grenze bleibt bestehen, solange der Speicher an ihr
    // "klebt". Sie wird nur verworfen, wenn der Speicher WIEDER MEHR liefert als
    // die Grenze (Grenze real gestiegen, z. B. SoC gesunken) oder die Richtung
    // sich umkehrt. Sonst würde sie zyklisch neu gelernt/verworfen -> Oszillation.
    // Unerfülltes Gesamtziel? Wenn betragsmäßig mehr gefordert ist, als die
    // Speicher aktuell liefern, gibt es „Nachfrage" nach mehr Leistung. Das ist
    // die Bedingung, unter der eine womöglich zu niedrig gelernte Grenze
    // probeweise wieder angehoben werden muss (sonst Henne-Ei: der Speicher darf
    // nicht über seine Grenze und kann daher nie beweisen, dass er mehr könnte).
    const zielUnerfuellt = Math.abs(gesamtZiel) > Math.abs(gesamtIst) + SAT_GAP_W;

    for (const x of active) {
      const tgt = x.lastTargetShare;
      const rp = x.reportedPower;
      // Bewegt sich der Speicher noch spürbar Richtung seines letzten Ziels, ist
      // ein Rückstand die gewollte Slew-Rate-Rampe (maxStep) – KEINE Sättigung.
      // Nur wenn er trotz Rückstand STAGNIERT, ist die technische Grenze erreicht.
      const prev = x.prevReportedPower;
      const fortschritt = prev == null ? 0 : Math.abs(rp - prev);
      const nochInBewegung = x.lastStepLimited === true && fortschritt > SAT_GAP_W / 2;
      x.prevReportedPower = rp;
      if (nochInBewegung) {
        x.satChargeCount = 0;
        x.satDischargeCount = 0;
        continue;
      }
      // Grenzen-Lockerung (deckt zwei Fälle ab):
      //  (a) Gesamtziel unerfüllt UND Speicher klebt an seiner Grenze (Henne-Ei:
      //      er darf nicht drüber, kann also nie mehr beweisen).
      //  (b) Gesamtziel zwar erfüllt (ein anderer Speicher deckt den Rest), aber
      //      dieser Speicher liegt unter seinem FAIREN, gewichtsproportionalen
      //      Anteil – dann ist die Verteilung unnötig schief. Auch hier die Grenze
      //      probeweise anheben, damit sich beide Speicher angleichen können.
      // In beiden Fällen wird die Grenze in kleinen Schritten gelockert; kann der
      // Speicher real nicht mehr, wird sie sofort wieder auf den echten Wert
      // gelernt (stabil, keine Oszillation).
      const fairerAnteil = totalWeight > 0
        ? Math.abs(gesamtZiel) * (x.weight > 0 ? x.weight : 0) / totalWeight
        : 0;
      const unterFairemAnteil = Math.abs(rp) + SAT_GAP_W < fairerAnteil;
      const probe = SAT_CAP_MARGIN_W + (damping?.maxStepW ?? 0);
      if (zielUnerfuellt || unterFairemAnteil) {
        // Wichtig: Ist das GESAMTZIEL unerfüllt (kein anderer Speicher kann den
        // Rest liefern – z.B. weil er leer ist), muss ein an seiner Grenze
        // klebender Speicher die Grenze anheben dürfen, AUCH wenn er damit über
        // seinen gewichtsproportional "fairen" Anteil hinausgeht. Der faire
        // Anteil berücksichtigt die Gewichte aller Speicher (inkl. der leeren);
        // ein leerer Speicher senkt den fairen Anteil der anderen künstlich, was
        // sonst verhindern würde, dass ein Speicher seine Grenze nach oben lernt.
        // Nur im reinen Angleichungsfall (Ziel erfüllt, nur Verteilung schief)
        // gilt die faire-Anteil-Schranke, damit sich niemand grundlos hochschraubt.
        const dischargeDarfHoch = zielUnerfuellt || (x.capDischargeW != null && x.capDischargeW < fairerAnteil);
        const chargeDarfHoch = zielUnerfuellt || (x.capChargeW != null && x.capChargeW < fairerAnteil);
        // Im alternierenden Modus die Entlade-Grenze NICHT über die real
        // gelieferte Leistung hinaus hochtasten: Klebt der aktive Speicher an z.B.
        // 2500 W, ist das seine echte Grenze – ein weiteres Anheben (auf Verdacht)
        // würde ihm ein Ziel geben, das er nicht liefert, und der Fehlbetrag ginge
        // als Netzbezug durch, statt dem zweiten Speicher zugewiesen zu werden.
        // Nur anheben, wenn er die Grenze tatsächlich ERREICHT/überschreitet (rp
        // liegt an der Grenze) UND im Vergleich zum Vorzyklus noch steigt.
        const altModus = damping?.alternierendeEntladung === true;
        const stiegNoch = prev != null && rp - prev > SAT_GAP_W / 2;
        const dischargeHochOk = altModus ? (rp >= x.capDischargeW! - SAT_GAP_W && stiegNoch) : (rp >= (x.capDischargeW ?? 0) - SAT_GAP_W);
        if (x.capDischargeW != null && dischargeDarfHoch && dischargeHochOk) {
          x.capDischargeW += probe;
          x.satDischargeCount = 0;
        }
        if (x.capChargeW != null && chargeDarfHoch && Math.abs(rp) >= x.capChargeW - SAT_GAP_W) {
          x.capChargeW += probe;
          x.satChargeCount = 0;
        }
      }
      // Laderichtung (negativ = laden).
      if (tgt < -SAT_GAP_W && rp > tgt + SAT_GAP_W) {
        // Ziel fordert mehr Laden, Speicher zieht nicht mit -> Richtung Sättigung.
        x.satChargeCount++;
        if (x.satChargeCount >= SAT_CONFIRM_COUNT) {
          // Grenze auf den (betragsmäßig größten beobachteten) Wert setzen. Nicht
          // nach unten korrigieren, solange er an der Grenze klebt.
          const beobachtet = Math.abs(rp) + SAT_CAP_MARGIN_W;
          x.capChargeW = x.capChargeW == null ? beobachtet : Math.max(x.capChargeW, beobachtet);
        }
      }
      // Grenze verwerfen NUR, wenn der Speicher deutlich MEHR lädt als die
      // gelernte Grenze (Grenze real gestiegen, z. B. SoC gesunken). Ein Speicher
      // bei/nahe 0 gilt NICHT als "Richtungswechsel": lädt er trotz Ladeziel
      // nicht (voll), ist das gerade der Sättigungsfall (cap ~ 0), der bestehen
      // bleiben muss, damit der andere Speicher den Überschuss übernimmt.
      if (x.capChargeW != null && Math.abs(rp) > x.capChargeW + SAT_GAP_W && rp < 0) {
        x.capChargeW = undefined;
        x.satChargeCount = 0;
      }
      // Grenze nach UNTEN nachführen: Ist der Speicher an seiner Ladegrenze
      // gekappt, liefert aber real dauerhaft deutlich WENIGER (z. B. Aufnahme
      // fällt gegen Ladeende), sinkt seine echte Grenze. NUR anpassen, wenn das
      // Gesamtziel bereits erfüllt ist – sonst würde die Nachführung nach unten
      // gegen das probeweise Anheben (oben) arbeiten und beide Effekte heben sich
      // auf, der Speicher bliebe festgenagelt.
      const bewegtSichRunter = prev != null && prev - rp > SAT_GAP_W / 2;
      if (!zielUnerfuellt && !unterFairemAnteil && !bewegtSichRunter && x.capChargeW != null && x.lastReading != null) {
        const tgtNegativGenug = x.lastTargetShare < -SAT_GAP_W;
        const liefertDeutlichWeniger = Math.abs(rp) + SAT_GAP_W < x.capChargeW;
        if (tgtNegativGenug && liefertDeutlichWeniger) {
          x.capChargeW = Math.max(0, Math.abs(rp) + SAT_CAP_MARGIN_W);
        }
      }
      // Entladerichtung (positiv = entladen).
      // Im alternierenden Modus wird die Grenze schneller gelernt (weniger
      // Bestätigungszyklen), damit bei zu hoher Last der zweite Speicher rasch
      // einspringt und kein längerer Netzbezug entsteht. Im Parallelmodus bleibt
      // die vorsichtigere Glättung (SAT_CONFIRM_COUNT), da dort kein einzelner
      // Speicher die Last allein stemmen soll.
      const confirmSchwelle = damping?.alternierendeEntladung ? 2 : SAT_CONFIRM_COUNT;
      if (tgt > SAT_GAP_W && rp < tgt - SAT_GAP_W) {
        x.satDischargeCount++;
        if (x.satDischargeCount >= confirmSchwelle) {
          const beobachtet = Math.abs(rp) + SAT_CAP_MARGIN_W;
          x.capDischargeW = x.capDischargeW == null ? beobachtet : Math.max(x.capDischargeW, beobachtet);
        }
      }
      if (x.capDischargeW != null && Math.abs(rp) > x.capDischargeW + SAT_GAP_W && rp > 0) {
        x.capDischargeW = undefined;
        x.satDischargeCount = 0;
      }
      // Nachführung nach unten NUR, wenn der Speicher stabil unter seiner Grenze
      // liegt – nicht, während er sich per Slew-Rate noch Richtung eines höheren
      // Ziels hochbewegt. Sonst würde die Grenze das eigene Hochrampen abwürgen
      // und der Speicher bliebe unter seinem fairen Anteil kleben (Ungleich-
      // verteilung, obwohl beide Speicher genug SoC haben).
      const bewegtSichHoch = prev != null && rp - prev > SAT_GAP_W / 2;
      if (!zielUnerfuellt && !unterFairemAnteil && !bewegtSichHoch && x.capDischargeW != null) {
        const tgtPositivGenug = x.lastTargetShare > SAT_GAP_W;
        const liefertDeutlichWeniger = Math.abs(rp) + SAT_GAP_W < x.capDischargeW;
        if (tgtPositivGenug && liefertDeutlichWeniger) {
          x.capDischargeW = Math.max(0, Math.abs(rp) + SAT_CAP_MARGIN_W);
        }
      }
    }

    // --- Aufteilung des Gesamtziels auf die Speicher ---
    // Standard: Water-Filling (gewichtsproportional mit Kappung an Grenzen).
    // Alternierende Entladung (nur bei Entladerichtung gesamtZiel>0): der aktive
    // Speicher (höchster SoC) bekommt den vollen Anteil; die übrigen nur, wenn er
    // seine Entladegrenze erreicht (Water-Filling für den Rest).
    let zielAnteil: number;
    if (damping?.alternierendeEntladung && gesamtZiel > 0 && active.length > 1) {
      this.lastMaxStepW = damping?.maxStepW ?? 0;
      this.updateAktiverSpeicher(active, damping.socByIp ?? {});
      zielAnteil = this.computeShareAlternierend(active, c, gesamtZiel);
    } else {
      // Kein alternierender Modus aktiv -> aktiven Speicher zurücksetzen, damit
      // beim nächsten Aktivieren frisch (höchster SoC) bestimmt wird.
      if (!damping?.alternierendeEntladung) { this.aktiverKey = null; this.aktiverStufe = null; }
      zielAnteil = this.computeShare(active, c, gesamtZiel, totalWeight);
    }

    // Grid-Reading = Delta zwischen Zielanteil und aktueller Leistung.
    let reading = zielAnteil - reportedPower;

    // --- Entkoppelte Dämpfung der Umverteilung zwischen mehreren Speichern ---
    // Problem: Ist das GESAMTZIEL bereits grob erreicht (Netz nahe ausgeregelt),
    // besteht ein verbleibendes Delta nur noch daraus, die Speicher ins richtige
    // VERHAELTNIS zu bringen. Wird dieses Delta mit der vollen (schnellen)
    // Netz-Slew-Rate (maxStep) gesendet, schaukeln sich zwei Speicher gegenseitig
    // auf (der eine bekommt +, der andere − in voller Hoehe, bei jedem Poll).
    // Loesung: Solange die Netzabweichung klein ist, wird die Umverteilung
    //   (a) innerhalb eines Toleranzbands gar nicht angetastet und
    //   (b) darueber hinaus nur in kleinen Schritten (balanceStepW) nachgefuehrt.
    // Echte, groessere Netzaenderungen (gesamtZiel bewegt sich deutlich) laufen
    // weiterhin ueber die schnelle maxStep-Rampe.
    const balanceStep = damping?.balanceStepW ?? 0;      // 0 = Feature aus
    const balanceTol = damping?.balanceToleranceW ?? 0;  // Totband der Umverteilung
    if (balanceStep > 0 && active.length > 1) {
      // Netzabweichung (wie weit ist die Summe der Speicher vom Gesamtziel weg).
      const netzFehler = Math.abs(gesamtZiel - gesamtIst);
      // "Eingeschwungen" = die Summe stimmt bis auf ein kleines Band. Dann ist ein
      // verbleibendes reading reine Umverteilung. Das Band koppelt sich an das
      // groessere aus Balance-Toleranz und Deadband, mind. aber SAT_GAP_W.
      const eingeschwungen = netzFehler <= Math.max(balanceTol, damping?.deadbandW ?? 0, SAT_GAP_W);
      if (eingeschwungen) {
        if (Math.abs(reading) <= balanceTol) {
          // Innerhalb des Toleranzbands: Verhaeltnis gilt als "gut genug" -> Ruhe.
          reading = 0;
        } else {
          // Ausserhalb: nur langsam angleichen (kleiner Umverteilungsschritt).
          if (reading > balanceStep) reading = balanceStep;
          else if (reading < -balanceStep) reading = -balanceStep;
        }
      }
    }

    // --- Frische-Prüfung des Netz-Sollwerts (Anti-Überschwingen um 0) ---
    // Der Speicher pollt das CT typischerweise schneller (~1/s), als die
    // Netzmessung (Shelly) frische Werte liefert (~2 s). Ist der gridReading seit
    // der letzten Abfrage DIESES Speichers unverändert, stammt er noch aus
    // demselben Messzyklus: die Wirkung einer bereits gesendeten Korrektur ist im
    // Netzwert noch nicht sichtbar. Ein weiteres volles Delta würde dann auf einen
    // veralteten Netzwert aufsetzen (Doppelzählung) und den Speicher über sein Ziel
    // hinaustreiben -> Überschwingen, gefolgt von Gegenkorrektur beim nächsten
    // frischen Wert = Pendeln um den Nullpunkt.
    // Daher: bei unveränderter (blinder) Messung das Delta unterdrücken – der
    // Speicher hält seine aktuelle Leistung, bis eine frische Messung vorliegt.
    // Sicherung: bleibt der Wert über mehrere Polls konstant (echtes stationäres
    // Netz), wird nach STALE_ALLOW_AFTER wieder ein Delta zugelassen, damit ein
    // real konstanter Bedarf weiterhin ausgeregelt werden kann.
    const STALE_ALLOW_AFTER = 2;
    const readingUnveraendert = c.lastGridReadingSeen != null
      && Math.abs(gridReading - c.lastGridReadingSeen) < 1;
    if (readingUnveraendert) {
      c.staleReadingCount = (c.staleReadingCount ?? 0) + 1;
      if (c.staleReadingCount <= STALE_ALLOW_AFTER) {
        // Blinde Messung: kein neues Delta – Speicher soll seine bereits
        // eingeleitete Änderung erst real wirksam werden lassen.
        reading = 0;
      }
      // Nach STALE_ALLOW_AFTER blinden Polls: Delta wieder zulassen (Wert bleibt
      // real konstant -> es ist eine echte, zu deckende Last, kein Messverzug).
    } else {
      // Frische Messung -> Zähler zurücksetzen, volle Reaktion erlaubt.
      c.staleReadingCount = 0;
    }
    c.lastGridReadingSeen = gridReading;

    // Pacing/Slew-Rate: den pro Poll gesendeten Delta betragsmäßig begrenzen,
    // damit die beschleunigende Firmware-Rampe bei Messverzögerung nicht
    // überschießt. Der Speicher nähert sich dem Ziel dann in mehreren kleinen
    // Schritten statt in einem großen Sprung – dämpft Oszillation.
    const maxStep = damping?.maxStepW ?? 0;
    let stepLimited = false;
    if (maxStep > 0) {
      if (reading > maxStep) { reading = maxStep; stepLimited = true; }
      else if (reading < -maxStep) { reading = -maxStep; stepLimited = true; }
    }
    c.lastStepLimited = stepLimited;

    // Für die Live-Anzeige merken.
    c.lastTargetShare = Math.round(zielAnteil);
    const finalReading = clampNoAcCharge(Math.round(reading));
    c.lastReading = finalReading;
    return finalReading;
  }

  // Bestimmt/aktualisiert bei alternierender Entladung den aktiven Speicher.
  // Regel: aktiver Speicher = der mit dem höchsten SoC. Der einmal gewählte
  // Speicher bleibt aktiv, bis sein SoC die bei Aktivierung festgelegte nächste
  // Stufe (100/75/50/25/12) unterschreitet – dann wird neu bestimmt. Das
  // verhindert ständiges Umschalten, wenn zwei Speicher ähnlichen SoC haben.
  // socByIp: SoC (%) je Speicher-IP. active: aktuell aktive Consumer.
  private updateAktiverSpeicher(active: CtConsumer[], socByIp: Record<string, number>): void {
    if (active.length === 0) { this.aktiverKey = null; this.aktiverStufe = null; return; }
    const socOf = (x: CtConsumer): number | null => {
      const v = socByIp[x.ip];
      return typeof v === "number" && Number.isFinite(v) ? v : null;
    };

    // Ist der aktuelle aktive Speicher noch gültig (vorhanden, SoC bekannt, über
    // seiner Wechsel-Stufe)? Dann beibehalten.
    if (this.aktiverKey != null) {
      const cur = active.find((x) => x.key === this.aktiverKey);
      const curSoc = cur ? socOf(cur) : null;
      if (cur && curSoc != null && this.aktiverStufe != null && curSoc > this.aktiverStufe) {
        return; // aktiver Speicher bleibt aktiv
      }
    }

    // Neu bestimmen: höchster bekannter SoC. Speicher ohne SoC werden ans Ende
    // gestellt (können nicht bevorzugt aktiv werden, dienen nur als Reserve).
    let best: CtConsumer | null = null;
    let bestSoc = -1;
    for (const x of active) {
      const s = socOf(x);
      if (s == null) continue;
      if (s > bestSoc) { bestSoc = s; best = x; }
    }
    if (!best) {
      // Kein SoC bekannt -> alternierender Modus kann nicht greifen; kein aktiver.
      this.aktiverKey = null; this.aktiverStufe = null; return;
    }
    this.aktiverKey = best.key;
    this.aktiverStufe = naechsteStufeUnter(bestSoc);
  }

  // Schlüssel des aktuell aktiven Speichers (für Anzeige), oder null.
  aktiverSpeicherKey(): string | null { return this.aktiverKey; }

  // Anteilsberechnung im alternierenden Entlademodus (nur Entladung, gesamtZiel>0).
  // Der aktive Speicher übernimmt das gesamte Ziel bis zu seiner (ggf. gelernten)
  // Entladegrenze. Nur der darüber hinausgehende Rest wird auf die übrigen
  // Speicher gewichtsproportional verteilt (Water-Filling für den Rest).
  private computeShareAlternierend(
    active: CtConsumer[], target: CtConsumer, gesamtZiel: number,
  ): number {
    const aktiv = active.find((x) => x.key === this.aktiverKey);
    // Kein gültiger aktiver Speicher bestimmt -> normales Verhalten (parallel).
    if (!aktiv) return this.computeShare(active, target, gesamtZiel, active.reduce((s, x) => s + (x.weight > 0 ? x.weight : 0), 0));

    // Anteil des aktiven Speichers: begrenzt durch seine gelernte Entladegrenze
    // (capDischargeW), sofern bekannt. Ohne Grenze übernimmt er das volle Ziel.
    //
    // WICHTIG – Probe-Anhebung gegen "eingefrorene" Grenzen: Würde der aktive
    // Speicher HART auf capDischargeW gedeckelt, könnte eine einmal zu niedrig
    // gelernte Grenze nie mehr nach oben korrigiert werden – der Speicher bekäme
    // nie ein Ziel über der Grenze, könnte also nie beweisen, dass er mehr kann,
    // und bliebe für immer auf dem falschen Wert festgenagelt (der andere Speicher
    // trägt dann fälschlich die Hauptlast). Deshalb darf der aktive Speicher sein
    // Ziel bis zu einem PROBE-Wert leicht ÜBER die Grenze legen (Grenze + ein
    // maxStep). Liefert er daraufhin real mehr, hebt die Sättigungslogik die Grenze
    // automatisch an; liefert er nicht mehr, fällt der Überschuss beim nächsten
    // Poll ohnehin an die anderen. So bleibt die Grenze lernfähig statt statisch.
    const capAktiv = aktiv.capDischargeW;
    let aktivZiel: number;      // Ziel, das der aktive Speicher gesetzt bekommt
    if (capAktiv == null) {
      aktivZiel = gesamtZiel;                    // keine Grenze -> volles Ziel
    } else {
      const probe = Math.max(SAT_GAP_W, this.lastMaxStepW || SAT_GAP_W);
      aktivZiel = Math.min(gesamtZiel, capAktiv + probe); // etwas über Grenze antesten
    }

    if (target.key === aktiv.key) {
      return aktivZiel;
    }

    // Rest für die übrigen Speicher.
    //
    // Solange der aktive Speicher noch KEINE Entladegrenze hat (capAktiv == null),
    // ist er per Definition nicht am Anschlag – ein Zurückbleiben ist dann nur das
    // normale Hochrampen per Slew-Rate. In diesem Fall bekommen die anderen NICHTS
    // (rest = 0); der aktive holt sein volles Ziel selbst auf. Sonst würde der
    // zweite Speicher schon bei jeder kleinen Rampen-Lücke (z. B. 20–30 W, die dem
    // aktiven zum Ziel fehlen) unnötig mit Kleinstleistung "mitdümpeln".
    //
    // Erst wenn der aktive eine echte Grenze hat, springt der Rest an die anderen –
    // und zwar auf Basis dessen, was der aktive REAL liefert (mit der Grenze als
    // unterer Schranke, damit ein kurzer Messdip den anderen nicht sofort die volle
    // Last aufbürdet).
    if (capAktiv == null) {
      return 0;
    }
    const aktivReal = Math.max(0, aktiv.reportedPower);
    const aktivBasis = Math.max(aktivReal, Math.min(capAktiv, aktivZiel));
    const rest = Math.max(0, gesamtZiel - aktivBasis);
    if (rest <= 0) return 0;
    const others = active.filter((x) => x.key !== aktiv.key);
    const restWeight = others.reduce((s, x) => s + (x.weight > 0 ? x.weight : 0), 0);
    const wI = target.weight > 0 ? target.weight : 0;
    return restWeight > 0 ? rest * wI / restWeight : rest / others.length;
  }

  // wobei Speicher an ihrer gelernten Leistungsgrenze (capChargeW/capDischargeW)
  // gekappt und die dadurch frei werdende Leistung iterativ gewichtsproportional
  // auf die noch nicht gekappten Speicher umverteilt wird. Gibt den Zielanteil
  // (W) für den angefragten Speicher `target` zurück.
  //
  // Ohne Kappung entspricht das Ergebnis exakt der bisherigen rein
  // gewichtsproportionalen Aufteilung; die Grenzen greifen nur, wenn zuvor eine
  // Sättigung erkannt wurde.
  private computeShare(
    active: CtConsumer[], target: CtConsumer, gesamtZiel: number, totalWeight: number,
  ): number {
    if (active.length === 0) return gesamtZiel;
    if (active.length === 1) return gesamtZiel;

    // Richtung des Gesamtziels bestimmt, welche Grenze relevant ist.
    const laden = gesamtZiel < 0; // negativ = laden
    const capOf = (x: CtConsumer): number | undefined =>
      laden ? x.capChargeW : x.capDischargeW; // Betrag der Grenze in dieser Richtung

    // Iteratives Water-Filling: gekappte Speicher bekommen ihre Grenze (mit
    // passendem Vorzeichen), der Rest wird auf die übrigen gewichtsproportional
    // verteilt. Wiederholen, bis keine weitere Kappung mehr auftritt.
    const shares = new Map<string, number>();
    let remaining = gesamtZiel;               // noch zu verteilende Leistung (W)
    let poolWeight = active.reduce((s, x) => s + (x.weight > 0 ? x.weight : 0), 0);
    const uncapped = new Set(active.map((x) => x.key));

    // Sicherung gegen Endlosschleifen: höchstens so viele Runden wie Speicher.
    for (let iter = 0; iter < active.length; iter++) {
      let cappedThisRound = false;
      if (poolWeight <= 0) break;
      for (const x of active) {
        if (!uncapped.has(x.key)) continue;
        const wI = x.weight > 0 ? x.weight : 0;
        const anteil = remaining * wI / poolWeight;
        const cap = capOf(x);
        // Kappung greift nur, wenn der proportionale Anteil die Grenze in der
        // Lade-/Entladerichtung betragsmäßig überschreiten würde.
        if (cap != null && Math.abs(anteil) > cap) {
          const capped = laden ? -cap : cap;
          // Zielvorgabe für den gekappten Speicher selbst = seine Grenze (er darf
          // bis dorthin gehen). Für die Umverteilung an die ANDEREN zählt aber nur,
          // was er real liefert: Liegt seine tatsächliche Leistung deutlich unter
          // der (ggf. probeweise gelockerten) Grenze, würde sonst die Differenz im
          // System „geparkt" und fehlte den übrigen Speichern. Wir ziehen daher für
          // remaining das Maximum aus realer Leistung und ... nun, mindestens die
          // reale Leistung ab, sodass die anderen den echten Rest übernehmen.
          const realBeitrag = laden
            ? Math.min(0, Math.max(capped, x.reportedPower))
            : Math.max(0, Math.min(capped, x.reportedPower));
          shares.set(x.key, capped);
          uncapped.delete(x.key);
          // Für die Restverteilung die reale Leistung verwenden, wenn der Speicher
          // hinter seiner Grenze zurückbleibt (echte Grenze); sonst die Grenze.
          const bleibtZurueck = Math.abs(x.reportedPower) + SAT_GAP_W < cap;
          remaining -= bleibtZurueck ? realBeitrag : capped;
          poolWeight -= wI;
          cappedThisRound = true;
        }
      }
      if (!cappedThisRound) {
        // Keine weitere Kappung: verbleibende Speicher proportional bedienen.
        for (const x of active) {
          if (!uncapped.has(x.key)) continue;
          const wI = x.weight > 0 ? x.weight : 0;
          shares.set(x.key, poolWeight > 0 ? remaining * wI / poolWeight : 0);
        }
        break;
      }
    }

    if (shares.has(target.key)) return shares.get(target.key)!;
    // Fallback (sollte nicht eintreten): rein proportional.
    const wI = target.weight > 0 ? target.weight : 0;
    return totalWeight > 0 ? gesamtZiel * wI / totalWeight : gesamtZiel / active.length;
  }

  // Momentaufnahme des aktuellen Zustands für die Live-Anzeige.
  snapshot(): CtBalancerSnapshot {    const now = Date.now();
    const active = [...this.consumers.values()].filter(
      (x) => !this.isExpired(x, now) && ["A", "B", "C", "D"].includes(x.phase)
    );
    const gesamtIst = active.reduce((s, x) => s + x.reportedPower, 0);
    const gesamtZiel = gesamtIst + this.lastGridReading;
    // IP des aktiven Speichers aus dem gemerkten Key ableiten (falls vorhanden
    // und noch aktiv).
    const aktiverConsumer = this.aktiverKey != null
      ? active.find((x) => x.key === this.aktiverKey)
      : undefined;
    const aktiverIp = aktiverConsumer ? aktiverConsumer.ip : null;
    return {
      active: active.length > 0,
      fadeout: this.fadeoutActive,
      gridReading: Math.round(this.lastGridReading),
      gesamtIst: Math.round(gesamtIst),
      gesamtZiel: Math.round(gesamtZiel),
      aktiverIp,
      consumers: active
        .sort((a, b) => a.ip.localeCompare(b.ip))
        .map((x) => ({
          ip: x.ip,
          phase: x.phase,
          reportedPower: Math.round(x.reportedPower),
          targetShare: x.lastTargetShare,
          reading: x.lastReading,
          weight: x.weight,
          ageMs: now - x.lastSeen,
          capChargeW: x.capChargeW ?? null,
          capDischargeW: x.capDischargeW ?? null,
          aktiv: this.aktiverKey === x.key,
        })),
    };
  }

  private cleanup(now: number): void {
    for (const [key, c] of this.consumers) {
      if (this.isExpired(c, now)) this.consumers.delete(key);
    }
  }

  // Anzahl aktuell aktiver Speicher (für Status/Logging).
  activeCount(): number {
    const now = Date.now();
    return [...this.consumers.values()].filter(
      (x) => !this.isExpired(x, now) && ["A", "B", "C", "D"].includes(x.phase)
    ).length;
  }

  reset(): void {
    this.consumers.clear();
  }
}
