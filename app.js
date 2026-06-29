"use strict";

/* =====================================================================
   Trainingstracker – App-Logik
   Alle Daten liegen ausschließlich lokal im Browser (localStorage).
   ===================================================================== */

const STORE_KEY = "tt_state_v2";

/* ---------- Standard-Zustand ---------- */
function defaultState() {
  return {
    plan: null,            // { importedAt, exercises: [...] }
    sessions: [],          // [{ id, dateISO, dayName, startTs, endTs, sets: [...] }]
    lastValues: {},        // { [exerciseKey]: { weight, reps } }  -> nach Übungsname
    library: {},           // { [key]: exerciseDef } – alle je geladenen Übungen
    bodyWeights: [],       // [{ dateISO, kg }] – Wiege-Verlauf
    settings: { defaultRest: 90, sound: true, vibrate: true, bodyweight: null, weeklyGoal: null, keepAwake: true, notify: false, autoBackup: false, lastBackupDate: null, autoBackupFolderName: null },
    activeSessionId: null, // id der laufenden Einheit oder null
    activeDay: null,       // gewählter/aktiver Split (Name) oder null
  };
}

let state = loadState();

function loadState() {
  try {
    const raw = localStorage.getItem(STORE_KEY);
    if (!raw) return defaultState();
    return Object.assign(defaultState(), JSON.parse(raw));
  } catch (e) {
    console.warn("State konnte nicht geladen werden:", e);
    return defaultState();
  }
}

function saveState() {
  try { localStorage.setItem(STORE_KEY, JSON.stringify(state)); }
  catch (e) { console.error("Speichern fehlgeschlagen:", e); }
}

/* ---------- kleine Helfer ---------- */
const $ = (sel, root = document) => root.querySelector(sel);
const $$ = (sel, root = document) => Array.from(root.querySelectorAll(sel));

function todayISO() {
  const d = new Date();
  const off = d.getTimezoneOffset();
  return new Date(d.getTime() - off * 60000).toISOString().slice(0, 10);
}

function formatDateDE(iso) {
  if (!iso) return "";
  const [y, m, day] = iso.split("-");
  return `${day}.${m}.${y}`;
}
function formatDateShort(iso) {
  if (!iso) return "";
  return iso.slice(8, 10) + "." + iso.slice(5, 7) + ".";
}
function daysAgo(iso) {
  const [y, m, d] = iso.split("-").map(Number);
  const [ny, nm, nd] = todayISO().split("-").map(Number);
  return Math.round((Date.UTC(ny, nm - 1, nd) - Date.UTC(y, m - 1, d)) / 86400000);
}
// "vor X Tagen", außer es ist länger als 10 Tage her -> dann das Datum
function relativeOrDate(iso) {
  const d = daysAgo(iso);
  if (d <= 0) return "heute";
  if (d === 1) return "gestern";
  if (d <= 10) return `vor ${d} Tagen`;
  return formatDateDE(iso);
}

function slug(s) {
  return String(s).trim().toLowerCase()
    .replace(/[äöüß]/g, c => ({ "ä": "ae", "ö": "oe", "ü": "ue", "ß": "ss" }[c]))
    .replace(/[^a-z0-9]+/g, "-").replace(/(^-|-$)/g, "");
}
// Verlauf wird über den ÜBUNGSNAMEN zugeordnet -> planübergreifend wiedererkannt.
function exerciseKey(name) { return slug(name); }

function formatNum(n) {
  if (n == null) return "–";
  return (Math.round(n * 100) / 100).toString().replace(".", ",");
}
// effektive Last: bei Körpergewichtsübungen Körpergewicht (zum Zeitpunkt gespeichert) + Zusatzgewicht
function effWeight(s) { return (s.bw != null ? s.bw : 0) + (s.weight || 0); }
// Volumen eines Satzes; einseitige Übungen zählen doppelt (beide Seiten gemacht)
function setVolume(s) { return effWeight(s) * s.reps * (s.uni ? 2 : 1); }
function setShort(s) {
  if (s.bw != null) {
    if (s.weight > 0) return `KG+${formatNum(s.weight)}×${s.reps}`;
    if (s.weight < 0) return `KG−${formatNum(-s.weight)}×${s.reps}`;
    return `KG×${s.reps}`;
  }
  return `${formatNum(s.weight)}×${s.reps}`;
}
function setLong(s) {
  const side = s.uni ? " · je Seite" : "";
  if (s.bw != null) {
    if (s.weight > 0) return `Körpergewicht +${formatNum(s.weight)} kg × ${s.reps} Wdh${side}`;
    if (s.weight < 0) return `Körpergewicht −${formatNum(-s.weight)} kg (Unterstützung) × ${s.reps} Wdh${side}`;
    return `Körpergewicht × ${s.reps} Wdh${side}`;
  }
  return `${formatNum(s.weight)} kg × ${s.reps} Wdh${side}`;
}

/* ---------- Rekorde: geschätztes 1RM (Epley); ohne Last (z. B. unbekanntes Körpergewicht) -> Wiederholungen ---------- */
function e1rm(weight, reps) { return weight * (1 + reps / 30); }
function setScore(s) { const w = effWeight(s); return w > 0 ? e1rm(w, s.reps) : s.reps; }
function recordValueText(s) {
  const w = effWeight(s);
  return w > 0 ? `1RM ${Math.round(e1rm(w, s.reps))} kg` : `${s.reps} Wdh`;
}
// bester Satz (höchster Score) einer Übung über alle Einheiten
function exerciseRecord(key) {
  let best = null;
  state.sessions.forEach(sess => sess.sets.forEach(s => {
    if (s.key !== key) return;
    const sc = setScore(s);
    if (!best || sc > best.score) best = { score: sc, set: s, dateISO: sess.dateISO };
  }));
  return best;
}

/* ---------- Körpergewicht-Verlauf ---------- */
function currentBodyweight() {
  if (Array.isArray(state.bodyWeights) && state.bodyWeights.length) return state.bodyWeights[state.bodyWeights.length - 1].kg;
  return state.settings.bodyweight > 0 ? state.settings.bodyweight : null;
}
function upsertBodyweight(kg) {
  if (!Array.isArray(state.bodyWeights)) state.bodyWeights = [];
  const iso = todayISO();
  const e = state.bodyWeights.find(w => w.dateISO === iso);
  if (e) e.kg = kg; else state.bodyWeights.push({ dateISO: iso, kg });
  state.bodyWeights.sort((a, b) => a.dateISO.localeCompare(b.dateISO));
  state.settings.bodyweight = kg; // Schnellzugriff / abwärtskompatibel
}

/* ---------- Progressions-Vorschlag ---------- */
function repUpperTarget(repsStr) {
  const nums = String(repsStr || "").match(/\d+/g);
  return nums ? Math.max(...nums.map(Number)) : null;
}
// Liefert einen Gewichts-/Wdh-Vorschlag für die nächste Einheit.
// Deckt mehrere Fälle ab: erster Eintrag, Ziel erreicht (+Gewicht), fast dran & drunter (Wdh steigern).
// Rückgabe: { weight, reps, text } oder null.
function progressionSuggestion(ex) {
  const isBw = !!ex.bodyweight;
  const upper = repUpperTarget(ex.targetReps);
  const lower = firstRepTarget(ex.targetReps);
  const last = lastSessionFor(ex.key);

  // Kein Verlauf -> Zielvorgabe als Startpunkt
  if (!last) {
    if (ex.targetWeight != null || ex.targetReps) {
      return {
        weight: isBw ? 0 : (ex.targetWeight != null ? ex.targetWeight : ""),
        reps: lower ?? "",
        text: "📋 Erster Eintrag – starte mit deiner Zielvorgabe.",
      };
    }
    return null;
  }

  const topWeight = Math.max(...last.sets.map(s => s.weight));
  const maxReps = Math.max(...last.sets.map(s => s.reps));
  const targetSets = ex.targetSets || last.sets.length;
  const enoughSets = last.sets.length >= targetSets;
  const inc = 2.5;

  if (upper) {
    const allHitUpper = enoughSets && last.sets.every(s => s.reps >= upper);
    const allClose = enoughSets && last.sets.every(s => s.reps >= 0.9 * upper);
    if (allHitUpper) {
      return { weight: topWeight + inc, reps: lower ?? upper,
        text: `📈 Oberes Wdh-Ziel erreicht → ${isBw ? "Zusatz " : ""}+${formatNum(inc)} kg, unten im Wdh-Bereich starten.` };
    }
    if (allClose) {
      return { weight: topWeight, reps: Math.min(upper, maxReps + 1),
        text: `🎯 Fast am Ziel – gleiches Gewicht, diesmal Richtung ${upper} Wdh.` };
    }
    return { weight: topWeight, reps: Math.min(upper, maxReps + 1),
      text: `💪 Gewicht halten und auf ${upper} Wdh hinarbeiten.` };
  }

  // Kein Wdh-Ziel definiert -> eine Wdh mehr als letztes Maximum anpeilen
  return { weight: topWeight, reps: maxReps + 1,
    text: `📈 Versuch eine Wdh mehr als zuletzt (${maxReps}).` };
}

// Vorschlag für den nächsten Satz – aktualisiert sich nach jedem heute erfassten Satz.
// 0 Sätze heute -> progressionSuggestion (basiert auf der letzten Einheit).
// Ab Satz 1 -> „Double Progression": Gewicht halten; erst wenn alle Sätze das obere
// Wdh-Ziel treffen, kommt nächstes Training +2,5 kg.
function nextSetSuggestion(ex) {
  const today = setsForExerciseToday(ex.key);
  if (!today.length) return progressionSuggestion(ex);

  const upper = repUpperTarget(ex.targetReps);
  const lower = firstRepTarget(ex.targetReps);
  const last = today[today.length - 1];
  const n = today.length + 1;
  const w = last.weight;

  if (upper) {
    if (last.reps >= upper) {
      return { weight: w, reps: upper,
        text: `📈 Satz ${n}: oberes Ziel (${upper}) geschafft – Gewicht halten; nächstes Training +2,5 kg.` };
    }
    if (lower != null && last.reps < lower) {
      return { weight: w, reps: lower,
        text: `💪 Satz ${n}: Gewicht halten, Wdh zurück Richtung ${lower}–${upper}.` };
    }
    return { weight: w, reps: Math.min(upper, last.reps + 1),
      text: `🎯 Satz ${n}: Gewicht halten, eine Wdh mehr (Ziel ${lower ?? "?"}–${upper}).` };
  }
  // ohne Wdh-Ziel: einfach die Werte des letzten Satzes übernehmen
  return { weight: w, reps: last.reps, text: `🎯 Satz ${n}: Werte vom letzten Satz übernommen.` };
}

/* ---------- Zeit-/Wochen-Helfer ---------- */
function weekdayMon0() { return (new Date().getDay() + 6) % 7; } // Mo=0 … So=6
function thisWeekSessions() {
  const dow = weekdayMon0();
  return state.sessions.filter(s => s.sets.length && daysAgo(s.dateISO) >= 0 && daysAgo(s.dateISO) <= dow);
}
function addDaysISO(iso, n) {
  const [y, m, d] = iso.split("-").map(Number);
  const dt = new Date(Date.UTC(y, m - 1, d));
  dt.setUTCDate(dt.getUTCDate() + n);
  return dt.toISOString().slice(0, 10);
}
// Montag (ISO) der Woche, in der dieses Datum liegt
function mondayOfISO(iso) {
  const [y, m, d] = iso.split("-").map(Number);
  const dt = new Date(Date.UTC(y, m - 1, d));
  const wd = (dt.getUTCDay() + 6) % 7; // Mo=0
  return addDaysISO(iso, -wd);
}
// Tage von a bis b (b - a)
function daysBetweenISO(a, b) {
  const [ay, am, ad] = a.split("-").map(Number), [by, bm, bd] = b.split("-").map(Number);
  return Math.round((Date.UTC(by, bm - 1, bd) - Date.UTC(ay, am - 1, ad)) / 86400000);
}
const MONTHS_SHORT = ["Jan", "Feb", "Mär", "Apr", "Mai", "Jun", "Jul", "Aug", "Sep", "Okt", "Nov", "Dez"];
// Streak: aufeinanderfolgende Wochen, in denen das Wochenziel erreicht wurde.
// Ohne Wochenziel: Wochen mit mind. 1 Einheit. Laufende Woche bricht die Serie nicht.
function trainingStreak() {
  const goal = state.settings.weeklyGoal > 0 ? state.settings.weeklyGoal : 1;
  const counts = {};
  state.sessions.forEach(s => { if (!s.sets.length) return; const w = mondayOfISO(s.dateISO); counts[w] = (counts[w] || 0) + 1; });
  let streak = 0, cur = mondayOfISO(todayISO()), first = true;
  for (let i = 0; i < 520; i++) {
    const c = counts[cur] || 0;
    if (c >= goal) streak++;
    else if (!first) break;       // abgeschlossene Woche verfehlt -> Serie endet
    first = false;
    cur = addDaysISO(cur, -7);
  }
  return streak;
}
// Tage seit dem letzten Backup (999 = noch nie); 0 wenn es nichts zu sichern gibt
function backupOverdueDays() {
  if (!state.sessions.some(s => s.sets.length)) return 0;
  const last = state.settings.lastBackupDate;
  if (!last) return 999;
  return daysAgo(last);
}
function fmtDuration(ms) {
  const sec = Math.max(0, Math.round(ms / 1000));
  const h = Math.floor(sec / 3600), m = Math.floor((sec % 3600) / 60), s = sec % 60;
  return (h ? h + ":" + String(m).padStart(2, "0") : m) + ":" + String(s).padStart(2, "0");
}
function sessionDurationMs(sess) {
  if (sess.startTs && sess.endTs) return sess.endTs - sess.startTs;
  if (sess.startTs && sess.id === state.activeSessionId) return Date.now() - sess.startTs;
  // Fallback: aus Satz-Zeitstempeln
  if (sess.sets.length) { const ts = sess.sets.map(x => x.ts); return Math.max(...ts) - Math.min(...ts); }
  return 0;
}

/* =====================================================================
   IMPORT – CSV & Excel
   ===================================================================== */
const COLUMN_ALIASES = {
  name:   ["übung", "uebung", "übungsname", "name", "exercise", "exercise name"],
  sets:   ["sätze", "saetze", "satz", "sets", "satzanzahl", "anzahl sätze"],
  reps:   ["wiederholungen", "wdh", "wdh.", "reps", "wiederholung", "ziel-wdh", "ziel wdh"],
  weight: ["gewicht", "kg", "gewicht (kg)", "weight", "last", "ziel-gewicht", "ziel gewicht"],
  rest:   ["pause", "pausenzeit", "pause (s)", "pause (sek)", "rest", "pause sek", "pausensekunden"],
  day:    ["tag", "trainingstag", "split", "plan", "day", "einheit"],
  bw:     ["körpergewicht", "koerpergewicht", "eigengewicht", "kg-übung", "kg-uebung", "kg übung", "bodyweight"],
  muscle: ["muskelgruppe", "muskel", "gruppe", "muscle", "muscle group", "körperpartie", "koerperpartie"],
  side:   ["seite", "einseitig", "unilateral", "pro seite", "einarmig", "einbeinig", "side"],
};
function matchColumn(header) {
  const h = String(header).trim().toLowerCase();
  for (const [key, aliases] of Object.entries(COLUMN_ALIASES)) if (aliases.includes(h)) return key;
  return null;
}

function parseCSV(text) {
  text = text.replace(/^﻿/, "");
  const firstLine = text.split(/\r?\n/)[0] || "";
  const delim = (firstLine.split(";").length > firstLine.split(",").length) ? ";" : ",";
  const rows = [];
  let row = [], field = "", inQuotes = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (inQuotes) {
      if (c === '"') { if (text[i + 1] === '"') { field += '"'; i++; } else inQuotes = false; }
      else field += c;
    } else {
      if (c === '"') inQuotes = true;
      else if (c === delim) { row.push(field); field = ""; }
      else if (c === "\n") { row.push(field); rows.push(row); row = []; field = ""; }
      else if (c === "\r") { /* ignorieren */ }
      else field += c;
    }
  }
  if (field.length || row.length) { row.push(field); rows.push(row); }
  return rows.filter(r => r.some(c => String(c).trim() !== ""));
}

function rowsToExercises(rows) {
  if (!rows.length) throw new Error("Datei ist leer.");
  const header = rows[0].map(h => String(h).trim());
  const colMap = {};
  header.forEach((h, i) => { const k = matchColumn(h); if (k) colMap[i] = k; });
  if (!Object.values(colMap).includes("name"))
    throw new Error('Spalte "Übung" wurde nicht gefunden. Bitte prüfe die erste Zeile deiner Datei.');

  const exercises = [];
  for (let r = 1; r < rows.length; r++) {
    const rec = { name: "", sets: null, reps: "", weight: null, rest: null, day: null, bw: null, muscle: null, side: null };
    rows[r].forEach((cell, i) => { const key = colMap[i]; if (key) rec[key] = String(cell).trim(); });
    if (!rec.name) continue;

    const sets = parseInt(rec.sets, 10);
    const weight = rec.weight === "" || rec.weight == null ? null : parseFloat(String(rec.weight).replace(",", "."));
    const rest = rec.rest === "" || rec.rest == null ? null : parseInt(rec.rest, 10);
    const day = rec.day && String(rec.day).trim() !== "" ? String(rec.day).trim() : null;
    const key = exerciseKey(rec.name);
    // Körpergewichtsübung: explizit (Spalte) oder automatisch bei Zielgewicht 0
    const bwFlag = /^(ja|yes|y|x|1|true|wahr|kg)$/i.test(String(rec.bw || "").trim());
    const bodyweight = bwFlag || weight === 0;
    const unilateral = /^(ja|yes|y|x|1|true|wahr)$/i.test(String(rec.side || "").trim());

    exercises.push({
      id: (day ? slug(day) + "::" : "") + key,
      key,
      day,
      name: rec.name,
      targetSets: Number.isFinite(sets) ? sets : null,
      targetReps: rec.reps || "",
      targetWeight: Number.isFinite(weight) ? weight : null,
      rest: Number.isFinite(rest) ? rest : null,
      bodyweight,
      unilateral,
      muscle: rec.muscle ? String(rec.muscle).trim() : null,
    });
  }
  if (!exercises.length) throw new Error("Keine Übungen in der Datei gefunden.");
  return exercises;
}

async function handleFile(file) {
  hideImportError();
  const nameLc = file.name.toLowerCase();
  try {
    let exercises;
    if (nameLc.endsWith(".xlsx") || nameLc.endsWith(".xls")) {
      exercises = await parseExcel(file);
    } else {
      exercises = rowsToExercises(parseCSV(await file.text()));
    }
    applyPlan(exercises);
  } catch (e) {
    console.error(e);
    showImportError(e.message || "Datei konnte nicht gelesen werden.");
  }
}

let _xlsxLib = null;
async function loadXLSX() {
  if (window.XLSX) return window.XLSX;
  await new Promise((resolve, reject) => {
    const s = document.createElement("script");
    s.src = "https://cdn.jsdelivr.net/npm/xlsx@0.18.5/dist/xlsx.full.min.js";
    s.onload = resolve;
    s.onerror = () => reject(new Error("Excel-Bibliothek konnte nicht geladen werden (Internet nötig). Tipp: Speichere deinen Plan als CSV – das geht immer offline."));
    document.head.appendChild(s);
  });
  return window.XLSX;
}
async function parseExcel(file) {
  const XLSX = await loadXLSX();
  const wb = XLSX.read(await file.arrayBuffer(), { type: "array" });
  const ws = wb.Sheets[wb.SheetNames[0]];
  return rowsToExercises(XLSX.utils.sheet_to_json(ws, { header: 1, defval: "" }));
}

function applyPlan(exercises) {
  state.plan = { importedAt: todayISO(), exercises };
  state.activeSessionId = null;       // beim Plan-Wechsel kein aktives Training
  state.activeDay = suggestNextDay(); // Vorschlag setzen
  // Alle (auch neue) Übungen in die Bibliothek aufnehmen – planübergreifend
  if (!state.library) state.library = {};
  exercises.forEach(e => {
    state.library[e.key] = {
      key: e.key, name: e.name, targetSets: e.targetSets, targetReps: e.targetReps,
      targetWeight: e.targetWeight, rest: e.rest, bodyweight: e.bodyweight, unilateral: e.unilateral, muscle: e.muscle,
    };
  });
  saveState();
  renderHome();
}

/* =====================================================================
   SPLITS / TAGE
   ===================================================================== */
function planDays() {
  if (!state.plan) return [];
  return [...new Set(state.plan.exercises.map(e => e.day).filter(Boolean))];
}
function exercisesForDay(day) {
  if (!state.plan) return [];
  return day ? state.plan.exercises.filter(e => e.day === day) : state.plan.exercises;
}
// nächster Split in Rotation – basierend auf der zuletzt trainierten Einheit
function suggestNextDay() {
  const days = planDays();
  if (!days.length) return null;
  const past = state.sessions.filter(s => s.id !== state.activeSessionId && days.includes(s.dayName));
  const last = past.length ? past[past.length - 1].dayName : null;
  if (!last) return days[0];
  const idx = days.indexOf(last);
  return days[(idx + 1) % days.length];
}

/* =====================================================================
   SESSIONS – Training starten / beenden / abbrechen
   ===================================================================== */
function activeSession() {
  return state.activeSessionId ? state.sessions.find(s => s.id === state.activeSessionId) || null : null;
}
function startTraining(day) {
  const s = { id: "s_" + todayISO() + "_" + Date.now(), dateISO: todayISO(), dayName: day || null, startTs: Date.now(), endTs: null, sets: [], extraExercises: [], notes: {} };
  state.sessions.push(s);
  state.activeSessionId = s.id;
  state.activeDay = day || null;
  saveState();
  requestWakeLock();
  startElapsed();
  renderHome();
}
function finishTraining() {
  const s = activeSession();
  if (!s) return;
  if (s.sets.length === 0) {
    state.sessions = state.sessions.filter(x => x.id !== s.id);
    state.activeSessionId = null;
    state.activeDay = suggestNextDay();
    saveState(); stopElapsed(); stopRest(); releaseWakeLock(); renderHome();
    return;
  }
  s.endTs = Date.now();
  const summary = buildSummary(s);
  state.activeSessionId = null;
  state.activeDay = suggestNextDay();
  saveState();
  stopElapsed(); stopRest(); releaseWakeLock();
  renderHome();
  showSummary(summary);
  autoBackup();
}
function cancelTraining() {
  const id = state.activeSessionId;
  state.sessions = state.sessions.filter(s => s.id !== id);
  state.activeSessionId = null;
  state.activeDay = suggestNextDay();
  saveState();
  stopElapsed(); stopRest(); releaseWakeLock();
  renderHome();
}
function setsForExerciseToday(key) {
  const s = activeSession();
  if (!s) return [];
  return s.sets.filter(x => x.key === key).sort((a, b) => a.setIndex - b.setIndex);
}
// letzte ABGESCHLOSSENE Einheit (nicht die laufende) mit dieser Übung
function lastSessionFor(key) {
  const cand = state.sessions
    .filter(s => s.id !== state.activeSessionId && s.sets.some(x => x.key === key));
  if (!cand.length) return null;
  cand.sort((a, b) => a.dateISO.localeCompare(b.dateISO));
  const s = cand[cand.length - 1];
  return { dateISO: s.dateISO, sets: s.sets.filter(x => x.key === key).sort((a, b) => a.setIndex - b.setIndex) };
}

/* =====================================================================
   RENDERING – Startbildschirm
   ===================================================================== */
function renderHome() {
  const hasPlan = !!(state.plan && state.plan.exercises.length);
  const training = !!activeSession();

  $("#import-area").classList.toggle("hidden", hasPlan);
  $("#start-view").classList.toggle("hidden", !hasPlan || training);
  $("#exercise-list-wrap").classList.toggle("hidden", !hasPlan || !training);

  if (!hasPlan) return;
  if (!training) renderStartView();
  else renderActiveTraining();
}

function renderStartView() {
  const days = planDays();
  const recommended = suggestNextDay();              // bleibt oben stehen, egal was unten gewählt ist
  if (!days.length) state.activeDay = null;
  else if (!days.includes(state.activeDay)) state.activeDay = recommended;
  const selected = state.activeDay;

  // Obere Karte: IMMER der empfohlene Split
  $("#next-day-name").textContent = recommended || "Training";
  const recExs = exercisesForDay(days.length ? recommended : null);
  $("#next-day-info").textContent = `${recExs.length} Übung${recExs.length === 1 ? "" : "en"}`
    + (days.length ? "" : " · ganzer Plan");

  const block = $("#start-day-block");
  if (days.length > 1) {
    block.classList.remove("hidden");
    const chips = $("#start-day-chips");
    chips.innerHTML = "";
    days.forEach(d => {
      const chip = document.createElement("button");
      chip.type = "button";
      chip.className = "day-chip" + (d === selected ? " active" : "") + (d === recommended ? " recommended" : "");
      chip.textContent = d;
      if (d === recommended) chip.title = "Empfohlen";
      chip.addEventListener("click", () => { state.activeDay = d; saveState(); renderStartView(); });
      chips.appendChild(chip);
    });
  } else {
    block.classList.add("hidden");
  }

  // Knopf zeigt den GEWÄHLTEN Split (kann von der Empfehlung abweichen)
  $("#start-training").textContent = (days.length && selected) ? `${selected} starten` : "Training starten";

  // Vorschau der Übungen im gewählten Split (ohne starten zu müssen)
  const previewEx = exercisesForDay(days.length ? selected : null);
  $("#start-preview-summary").textContent = `${previewEx.length} Übung${previewEx.length === 1 ? "" : "en"} ansehen`;
  $("#start-preview-list").innerHTML = previewEx.map(e => {
    const meta = [
      e.targetSets ? e.targetSets + "×" : "",
      e.targetReps ? e.targetReps + " Wdh" : "",
      e.bodyweight ? "KG" : (e.targetWeight != null ? formatNum(e.targetWeight) + " kg" : ""),
    ].filter(Boolean).join(" · ");
    return `<div class="start-preview-row"><span class="spv-name">${e.name}</span><span class="spv-meta">${meta}</span></div>`;
  }).join("");

  const since = state.plan && state.plan.importedAt;
  $("#plan-since").textContent = since ? `Plan aktiv seit ${relativeOrDate(since)}` : "";

  renderBackupReminder();
}

// Dezente Erinnerung, wenn das letzte Backup zu lange her ist (greift v. a. ohne Auto-Backup)
function renderBackupReminder() {
  const el = $("#backup-reminder");
  if (!el) return;
  const overdue = backupOverdueDays();
  if (overdue >= 7) {
    const txt = overdue >= 999 ? "Noch kein Backup erstellt" : `Letztes Backup vor ${overdue} Tagen`;
    el.innerHTML = `<span class="br-ico">💾</span><span class="br-text">${txt} – jetzt sichern</span><span class="br-go">›</span>`;
    el.classList.remove("hidden");
  } else {
    el.classList.add("hidden");
  }
}

function renderActiveTraining() {
  const s = activeSession();
  const planEx = exercisesForDay(s.dayName);
  const extras = s.extraExercises || [];
  const exs = planEx.concat(extras);
  $("#session-day").textContent = (s.dayName ? s.dayName + " · " : "") + formatDateDE(s.dateISO);
  const doneCount = exs.filter(isExerciseDone).length;
  $("#session-progress").textContent = `${doneCount}/${exs.length} Übungen erledigt`;
  startElapsed();

  const list = $("#exercise-list");
  list.innerHTML = "";
  exs.forEach(ex => list.appendChild(renderExerciseCard(ex, extras.includes(ex))));
}

function isExerciseDone(ex) {
  const sets = setsForExerciseToday(ex.key);
  if (!sets.length) return false;
  return ex.targetSets ? sets.length >= ex.targetSets : true;
}

function renderExerciseCard(ex, isExtra) {
  const sets = setsForExerciseToday(ex.key);
  const done = isExerciseDone(ex);
  const partial = sets.length > 0 && !done;

  const card = document.createElement("button");
  card.type = "button";
  card.className = "ex-card" + (done ? " done" : partial ? " partial" : "");

  const status = document.createElement("div");
  status.className = "ex-status";
  status.textContent = done ? "✓" : (sets.length || "");

  const main = document.createElement("div");
  main.className = "ex-main";
  const title = document.createElement("div");
  title.className = "ex-title";
  title.textContent = ex.name;
  if (isExtra) { const b = document.createElement("span"); b.className = "ex-badge"; b.textContent = "heute"; title.appendChild(b); }

  const sub = document.createElement("div");
  sub.className = "ex-sub";
  const parts = [];
  if (ex.targetSets) parts.push(`${ex.targetSets} Sätze`);
  if (ex.targetReps) parts.push(`${ex.targetReps} Wdh`);
  if (ex.targetWeight != null) parts.push(`${formatNum(ex.targetWeight)} kg`);
  sub.textContent = parts.join(" · ") || "Keine Zielvorgabe";

  main.appendChild(title);
  main.appendChild(sub);

  card.appendChild(status);
  card.appendChild(main);
  if (isExtra) {
    const rm = document.createElement("span");
    rm.className = "ex-remove";
    rm.setAttribute("role", "button");
    rm.setAttribute("aria-label", "Übung entfernen");
    rm.textContent = "✕";
    rm.addEventListener("click", e => { e.stopPropagation(); removeExtraExercise(ex.id); });
    card.appendChild(rm);
  } else {
    const chev = document.createElement("div");
    chev.className = "ex-chevron";
    chev.textContent = "›";
    card.appendChild(chev);
  }
  card.addEventListener("click", () => openExercise(ex.id));
  return card;
}

// für heute hinzugefügte Übung wieder entfernen
function removeExtraExercise(id) {
  const s = activeSession();
  if (!s || !s.extraExercises) return;
  const ex = s.extraExercises.find(e => e.id === id);
  if (!ex) return;
  const hasSets = s.sets.some(x => x.key === ex.key);
  if (hasSets && !confirm(`„${ex.name}" entfernen? Die heute dafür erfassten Sätze werden gelöscht.`)) return;
  s.extraExercises = s.extraExercises.filter(e => e.id !== id);
  if (hasSets) s.sets = s.sets.filter(x => x.key !== ex.key);
  if (s.notes) delete s.notes[ex.key];
  saveState();
  renderActiveTraining();
}

/* =====================================================================
   ÜBUNGS-BIBLIOTHEK – Übung nur für heute hinzufügen
   ===================================================================== */
function libraryList() {
  return Object.values(state.library || {}).sort((a, b) => a.name.localeCompare(b.name));
}
// Übungen nach Körperregion (Muskelgruppe) gruppieren; ohne Angabe -> „Sonstige"
function groupByMuscle(items) {
  const groups = {};
  items.forEach(e => { const m = (e.muscle && e.muscle.trim()) || "Sonstige"; (groups[m] = groups[m] || []).push(e); });
  return Object.keys(groups)
    .sort((a, b) => (a === "Sonstige") - (b === "Sonstige") || a.localeCompare(b))
    .map(m => ({ muscle: m, items: groups[m].sort((a, b) => a.name.localeCompare(b.name)) }));
}
// Meta-Text einer Bibliotheks-Übung (ohne Muskelgruppe, da als Überschrift gezeigt)
function libMeta(e) {
  return [e.targetReps ? e.targetReps + " Wdh" : "", e.bodyweight ? "KG" : (e.targetWeight != null ? formatNum(e.targetWeight) + " kg" : "")].filter(Boolean).join(" · ");
}
// Bibliothek nur ansehen (aus den Einstellungen) – nach Körperregion sortiert
function openLibraryView() {
  const items = libraryList();
  $("#library-view-count").textContent = items.length
    ? `${items.length} Übung${items.length === 1 ? "" : "en"} – nach Körperregion sortiert`
    : "Noch keine Übungen – lade zuerst einen Trainingsplan.";
  const wrap = $("#library-view-list");
  wrap.innerHTML = "";
  groupByMuscle(items).forEach(g => {
    const h = document.createElement("div");
    h.className = "lib-group-h";
    h.textContent = g.muscle;
    wrap.appendChild(h);
    g.items.forEach(e => {
      const div = document.createElement("div");
      div.className = "lib-item lib-item-static";
      div.innerHTML = `<span class="lib-name">${e.name}</span><span class="lib-sub">${libMeta(e)}</span>`;
      wrap.appendChild(div);
    });
  });
  $("#library-view-overlay").classList.remove("hidden");
}
function closeLibraryView() { $("#library-view-overlay").classList.add("hidden"); }
function openLibraryPicker() {
  const s = activeSession(); if (!s) return;
  const present = new Set(exercisesForDay(s.dayName).map(e => e.key).concat((s.extraExercises || []).map(e => e.key)));
  const items = libraryList().filter(e => !present.has(e.key));
  const wrap = $("#library-list");
  if (!items.length) {
    wrap.innerHTML = '<p class="muted lib-empty">Alle Übungen aus deiner Bibliothek sind heute schon dabei.</p>';
  } else {
    wrap.innerHTML = "";
    groupByMuscle(items).forEach(g => {
      const h = document.createElement("div");
      h.className = "lib-group-h";
      h.textContent = g.muscle;
      wrap.appendChild(h);
      g.items.forEach(e => {
        const b = document.createElement("button");
        b.type = "button"; b.className = "lib-item";
        b.innerHTML = `<span class="lib-name">${e.name}</span><span class="lib-sub">${libMeta(e)}</span>`;
        b.addEventListener("click", () => addExerciseToday(e.key));
        wrap.appendChild(b);
      });
    });
  }
  $("#library-overlay").classList.remove("hidden");
}
function closeLibraryPicker() { $("#library-overlay").classList.add("hidden"); }
function addExerciseToday(key) {
  const s = activeSession(), def = state.library[key];
  if (!s || !def) return;
  if (!s.extraExercises) s.extraExercises = [];
  s.extraExercises.push({
    id: "x::" + key, key: def.key, day: s.dayName, name: def.name,
    targetSets: def.targetSets, targetReps: def.targetReps, targetWeight: def.targetWeight,
    rest: def.rest, bodyweight: def.bodyweight, unilateral: def.unilateral, muscle: def.muscle,
  });
  saveState();
  closeLibraryPicker();
  renderActiveTraining();
}

/* ---------- Eigene Übung anlegen (ohne Plan-Import) ---------- */
let _newExAddToday = false;
function openNewExercise(addToday) {
  _newExAddToday = !!addToday;
  ["nx-name", "nx-muscle", "nx-reps", "nx-sets", "nx-weight", "nx-rest"].forEach(id => { $("#" + id).value = ""; });
  $("#nx-bw").checked = false; $("#nx-uni").checked = false;
  $("#nx-error").hidden = true;
  $("#newex-overlay").classList.remove("hidden");
  setTimeout(() => $("#nx-name").focus(), 50);
}
function closeNewExercise() { $("#newex-overlay").classList.add("hidden"); }
function saveCustomExercise() {
  const name = $("#nx-name").value.trim();
  if (!name) { const e = $("#nx-error"); e.textContent = "Bitte einen Namen eingeben."; e.hidden = false; return; }
  const key = exerciseKey(name);
  const sets = parseInt($("#nx-sets").value, 10);
  const weightRaw = $("#nx-weight").value;
  const weight = weightRaw === "" ? null : parseFloat(String(weightRaw).replace(",", "."));
  const rest = parseInt($("#nx-rest").value, 10);
  const bodyweight = $("#nx-bw").checked;
  const def = {
    key, name,
    targetSets: Number.isFinite(sets) ? sets : null,
    targetReps: $("#nx-reps").value.trim(),
    targetWeight: Number.isFinite(weight) ? weight : null,
    rest: Number.isFinite(rest) ? rest : null,
    bodyweight,
    unilateral: $("#nx-uni").checked,
    muscle: $("#nx-muscle").value.trim() || null,
  };
  if (!state.library) state.library = {};
  state.library[key] = def;
  saveState();
  closeNewExercise();
  if (_newExAddToday && activeSession()) {
    closeLibraryPicker();
    addExerciseToday(key);
  } else if (!$("#library-view-overlay").classList.contains("hidden")) {
    openLibraryView();   // Liste in der Einstellungen-Ansicht aktualisieren
  }
}

/* =====================================================================
   AUTO-BACKUP – Ordner-Handle via IndexedDB (Desktop) / Download (iOS)
   ===================================================================== */
async function openBackupDB() {
  return new Promise((res, rej) => {
    const req = indexedDB.open("tt_backup_v1", 1);
    req.onupgradeneeded = e => e.target.result.createObjectStore("handles");
    req.onsuccess = e => res(e.target.result);
    req.onerror = e => rej(e.target.error);
  });
}
async function saveDirHandle(handle) {
  const db = await openBackupDB();
  return new Promise((res, rej) => {
    const tx = db.transaction("handles", "readwrite");
    tx.objectStore("handles").put(handle, "dir");
    tx.oncomplete = () => { res(); db.close(); };
    tx.onerror = e => rej(e.target.error);
  });
}
async function loadDirHandle() {
  const db = await openBackupDB();
  return new Promise((res, rej) => {
    const tx = db.transaction("handles", "readonly");
    const req = tx.objectStore("handles").get("dir");
    req.onsuccess = e => { res(e.target.result || null); db.close(); };
    req.onerror = e => rej(e.target.error);
  });
}
async function clearDirHandle() {
  const db = await openBackupDB();
  return new Promise((res, rej) => {
    const tx = db.transaction("handles", "readwrite");
    tx.objectStore("handles").delete("dir");
    tx.oncomplete = () => { res(); db.close(); };
    tx.onerror = e => rej(e.target.error);
  });
}

async function pickBackupFolder() {
  if (!window.showDirectoryPicker) return false;
  try {
    const handle = await window.showDirectoryPicker({ mode: "readwrite" });
    await saveDirHandle(handle);
    state.settings.autoBackupFolderName = handle.name;
    saveState();
    return true;
  } catch (e) {
    if (e.name !== "AbortError") console.error("Ordner-Auswahl fehlgeschlagen:", e);
    return false;
  }
}

async function writeBackupToDir(handle) {
  const perm = await handle.queryPermission({ mode: "readwrite" });
  const granted = perm === "granted" || (await handle.requestPermission({ mode: "readwrite" })) === "granted";
  if (!granted) return false;
  const filename = `trainingstracker_${todayISO()}.json`;
  const fh = await handle.getFileHandle(filename, { create: true });
  const writable = await fh.createWritable();
  await writable.write(JSON.stringify(state, null, 2));
  await writable.close();
  return true;
}

async function autoBackup(force) {
  if (!force && !state.settings.autoBackup) return;
  const backupData = JSON.stringify(state, null, 2);

  if (window.showDirectoryPicker) {
    // Desktop/macOS: still in den gewählten Ordner schreiben
    let handle = await loadDirHandle().catch(() => null);
    if (!handle) {
      const ok = await pickBackupFolder();
      if (!ok) return;
      handle = await loadDirHandle().catch(() => null);
    }
    if (!handle) return;
    try {
      const ok = await writeBackupToDir(handle);
      if (ok) {
        state.settings.lastBackupDate = todayISO();
        saveState();
        showBackupToast('💾 Backup gespeichert in "' + handle.name + '"');
        updateAutoBackupUI();
        renderBackupReminder();
      }
    } catch (e) {
      console.error("Backup fehlgeschlagen:", e);
      await clearDirHandle().catch(() => {});
      state.settings.autoBackupFolderName = null;
      saveState();
    }
  } else {
    // iOS: Download auslösen → landet in Dateien > Downloads
    const blob = new Blob([backupData], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `trainingstracker_${todayISO()}.json`;
    document.body.appendChild(a); a.click(); a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 2000);
    state.settings.lastBackupDate = todayISO();
    saveState();
    showBackupToast("💾 Backup gespeichert (Dateien → Downloads)");
    updateAutoBackupUI();
    renderBackupReminder();
  }
}

function showBackupToast(msg) {
  let toast = document.getElementById("backup-toast");
  if (!toast) {
    toast = document.createElement("div");
    toast.id = "backup-toast";
    toast.className = "backup-toast";
    document.body.appendChild(toast);
  }
  toast.textContent = msg;
  toast.classList.add("show");
  clearTimeout(toast._t);
  toast._t = setTimeout(() => toast.classList.remove("show"), 3200);
}

function updateAutoBackupUI() {
  const hasAPI = !!window.showDirectoryPicker;
  const autoOn = !!state.settings.autoBackup;
  const folderRow = document.getElementById("autobackup-folder-row");
  const desc = document.getElementById("autobackup-desc");
  const folderName = document.getElementById("autobackup-folder-name");
  const info = document.getElementById("last-backup-info");

  if (folderRow) folderRow.classList.toggle("hidden", !autoOn || !hasAPI);

  if (desc) {
    if (!autoOn) {
      desc.textContent = "Nach jedem abgeschlossenen Training wird automatisch ein Backup gespeichert.";
    } else if (hasAPI) {
      const name = state.settings.autoBackupFolderName;
      desc.textContent = name
        ? `Backups werden in „${name}" gespeichert.`
        : "Beim ersten Backup wird einmalig ein Ordner abgefragt.";
    } else {
      desc.textContent = "Nach jedem Training wird eine Backup-Datei heruntergeladen – sie landet in Dateien → Downloads.";
    }
  }

  if (folderName) {
    folderName.textContent = state.settings.autoBackupFolderName
      ? "📁 " + state.settings.autoBackupFolderName
      : "Noch kein Ordner gewählt";
  }

  if (info) {
    info.textContent = state.settings.lastBackupDate
      ? "Letztes Backup: " + relativeOrDate(state.settings.lastBackupDate)
      : "";
  }
}

/* =====================================================================
   BACKUP – alle Daten sichern & wieder laden
   ===================================================================== */
async function importBackup(file) {
  try {
    const parsed = JSON.parse(await file.text());
    if (!parsed || typeof parsed !== "object" || !("sessions" in parsed)) {
      alert("Das sieht nicht nach einem gültigen Backup aus."); return;
    }
    if (!confirm("Backup laden? Deine aktuellen Daten werden dadurch ersetzt.")) return;
    state = Object.assign(defaultState(), parsed);
    state.activeSessionId = null;   // kein laufendes Training nach Import
    saveState();
    showScreen("screen-home");
    alert("Backup geladen.");
  } catch (e) {
    console.error(e);
    alert("Backup konnte nicht gelesen werden.");
  }
}

/* =====================================================================
   ÜBUNGSDETAIL
   ===================================================================== */
let currentExercise = null;

function findExercise(id) {
  const planEx = state.plan?.exercises.find(e => e.id === id);
  if (planEx) return planEx;
  const s = activeSession();
  return (s && s.extraExercises) ? (s.extraExercises.find(e => e.id === id) || null) : null;
}

function openExercise(id) {
  const ex = findExercise(id);
  if (!ex) return;
  currentExercise = ex;
  editingSetTs = null;

  $("#ex-name").textContent = ex.name;

  // Zielkarte
  const items = [];
  if (ex.targetSets) items.push(`<div class="target-item"><b>${ex.targetSets}</b><span>Sätze</span></div>`);
  if (ex.targetReps) items.push(`<div class="target-item"><b>${ex.targetReps}</b><span>Wdh</span></div>`);
  if (ex.bodyweight) items.push(`<div class="target-item"><b>KG</b><span>Körpergewicht</span></div>`);
  else if (ex.targetWeight != null) items.push(`<div class="target-item"><b>${formatNum(ex.targetWeight)}</b><span>kg Ziel</span></div>`);
  items.push(`<div class="target-item"><b>${ex.rest ?? state.settings.defaultRest}s</b><span>Pause</span></div>`);
  if (ex.unilateral) items.push(`<div class="target-item"><b>↔</b><span>je Seite</span></div>`);
  $("#ex-target").innerHTML = items.join("");

  // Eingabefeld je nach Übungsart beschriften + Hinweis
  $("#label-weight").textContent = ex.bodyweight ? "Zusatzgewicht (kg)" : "Gewicht (kg)";
  const wIn = $("#in-weight");
  if (ex.bodyweight) wIn.removeAttribute("min"); else wIn.setAttribute("min", "0");
  const bwHint = $("#bw-hint");
  if (ex.bodyweight && !(currentBodyweight() > 0)) {
    bwHint.classList.remove("hidden");
    bwHint.textContent = "💡 Trag dein Körpergewicht in den Einstellungen ein – dann zählt es bei 1RM & Volumen mit.";
  } else if (ex.bodyweight) {
    bwHint.classList.remove("hidden");
    bwHint.textContent = "💡 Mit Unterstützung (z. B. Maschine) negatives Zusatzgewicht eingeben, z. B. −20.";
  } else {
    bwHint.classList.add("hidden");
  }

  // "Letztes Mal"-Block (vorige Einheit)
  const last = lastSessionFor(ex.key);
  const lastEl = $("#ex-lastlog");
  if (last) {
    lastEl.classList.remove("hidden");
    lastEl.innerHTML = `<span class="lastlog-label">Letztes Mal · ${relativeOrDate(last.dateISO)}</span>`
      + `<span class="lastlog-sets">${last.sets.map(setShort).join("  ·  ")}</span>`;
  } else {
    lastEl.classList.add("hidden");
    lastEl.innerHTML = "";
  }

  // Vorschlag für den nächsten Satz (aktualisiert sich nach jedem gespeicherten Satz)
  refreshSuggestion(ex);
  updateNoteButton();

  renderTodaySets();
  showScreen("screen-exercise");
}

// Setzt Eingabefelder + Hinweis auf den Vorschlag für den NÄCHSTEN Satz
function refreshSuggestion(ex) {
  const sugg = nextSetSuggestion(ex);
  const lv = state.lastValues[ex.key];
  let w = lv ? lv.weight : (ex.bodyweight ? 0 : (ex.targetWeight != null ? ex.targetWeight : ""));
  let r = lv ? lv.reps : (firstRepTarget(ex.targetReps) ?? "");
  const progHint = $("#prog-hint");
  if (sugg) {
    if (sugg.weight !== "" && sugg.weight != null) w = sugg.weight;
    if (sugg.reps !== "" && sugg.reps != null) r = sugg.reps;
    progHint.classList.remove("hidden");
    progHint.textContent = sugg.text;
  } else {
    progHint.classList.add("hidden");
  }
  $("#in-weight").value = w === "" ? "" : w;
  $("#in-reps").value = r === "" ? "" : r;
}

// Notiz-Fenster öffnen – Notiz pro Übung & Einheit; lädt nur die heutige, nichts von anderen Tagen
function openNoteModal() {
  const sess = activeSession();
  if (!sess || !currentExercise) return;
  $("#note-title").textContent = "Notiz · " + currentExercise.name;
  $("#ex-note").value = (sess.notes && sess.notes[currentExercise.key]) || "";
  $("#note-overlay").classList.remove("hidden");
  setTimeout(() => $("#ex-note").focus(), 50);
}
function closeNoteModal() { $("#note-overlay").classList.add("hidden"); }

// Notiz der aktuellen Übung in der laufenden Einheit speichern (nur für die Auswertung/CSV)
function saveExerciseNote() {
  const sess = activeSession();
  if (!sess || !currentExercise) { closeNoteModal(); return; }
  if (!sess.notes) sess.notes = {};
  const txt = $("#ex-note").value.trim();
  if (txt) sess.notes[currentExercise.key] = txt;
  else delete sess.notes[currentExercise.key];
  saveState();
  updateNoteButton();
  closeNoteModal();
}
// Button-Beschriftung je nachdem, ob für DIESE Übung HEUTE schon eine Notiz existiert
function updateNoteButton() {
  const sess = activeSession();
  const has = !!(sess && currentExercise && sess.notes && sess.notes[currentExercise.key]);
  $("#open-note").textContent = has ? "📝 Notiz bearbeiten" : "📝 Notiz";
}

function firstRepTarget(repsStr) {
  const m = String(repsStr || "").match(/\d+/);
  return m ? parseInt(m[0], 10) : null;
}

let editingSetTs = null;
function renderTodaySets() {
  const wrap = $("#today-sets");
  const sets = setsForExerciseToday(currentExercise.key);
  wrap.innerHTML = "";
  sets.forEach((s, i) => {
    const row = document.createElement("div");
    row.className = "set-row";
    if (editingSetTs === s.ts) {
      row.classList.add("editing");
      const wLabel = s.bw != null ? "Zusatz" : "kg";
      row.innerHTML =
        `<span class="set-num">${i + 1}</span>` +
        `<div class="set-edit">` +
          `<input class="set-edit-w" type="number" inputmode="decimal" step="0.5" value="${s.weight}" aria-label="${wLabel}" />` +
          `<span class="set-edit-x">×</span>` +
          `<input class="set-edit-r" type="number" inputmode="numeric" step="1" min="0" value="${s.reps}" aria-label="Wiederholungen" />` +
        `</div>` +
        `<button type="button" class="set-save" aria-label="Speichern">✓</button>`;
      row.querySelector(".set-save").addEventListener("click", () => {
        const w = parseFloat(String(row.querySelector(".set-edit-w").value).replace(",", "."));
        const r = parseInt(row.querySelector(".set-edit-r").value, 10);
        commitSetEdit(s.ts, Number.isFinite(w) ? w : 0, r);
      });
    } else {
      row.innerHTML =
        `<span class="set-num">${i + 1}</span>` +
        `<button type="button" class="set-val set-val-btn">${setLong(s)}</button>` +
        `<button type="button" class="set-del" aria-label="Satz löschen">✕</button>`;
      row.querySelector(".set-val-btn").addEventListener("click", () => { editingSetTs = s.ts; renderTodaySets(); });
      row.querySelector(".set-del").addEventListener("click", () => deleteSet(s.ts));
    }
    wrap.appendChild(row);
  });
}

// bereits gespeicherten Satz nachträglich ändern
function commitSetEdit(ts, weight, reps) {
  const session = activeSession();
  if (!session) { editingSetTs = null; renderTodaySets(); return; }
  if (!Number.isFinite(reps) || reps <= 0) { flashEditRow(ts); return; }
  const s = session.sets.find(x => x.ts === ts);
  if (s) {
    s.weight = weight;
    s.reps = reps;
    state.lastValues[s.key] = { weight, reps };
  }
  editingSetTs = null;
  saveState();
  renderTodaySets();
  if (currentExercise) refreshSuggestion(currentExercise);
}
function flashEditRow(ts) {
  const inp = document.querySelector(".set-row.editing .set-edit-r");
  if (inp) { inp.style.borderColor = "var(--danger)"; inp.focus(); setTimeout(() => inp.style.borderColor = "", 800); }
}

function saveSet() {
  const ex = currentExercise;
  if (!ex) return;
  const weight = parseFloat(String($("#in-weight").value).replace(",", "."));
  const reps = parseInt($("#in-reps").value, 10);
  if (!Number.isFinite(reps) || reps <= 0) { flashField("#in-reps"); return; }
  const w = Number.isFinite(weight) ? weight : 0;

  let session = activeSession();
  if (!session) { startTraining(ex.day); session = activeSession(); }

  // bisheriger Rekord VOR diesem Satz (zum Vergleich)
  const prevRecord = exerciseRecord(ex.key);

  const setIndex = session.sets.filter(x => x.key === ex.key).length;
  const ts = Date.now() + Math.random();
  const newSet = { key: ex.key, exerciseName: ex.name, day: ex.day, muscle: ex.muscle || null, setIndex, weight: w, reps, ts };
  // Körpergewichtsübung: Körpergewicht zum Zeitpunkt mitspeichern (0, falls nicht gesetzt)
  if (ex.bodyweight) { const cbw = currentBodyweight(); newSet.bw = cbw && cbw > 0 ? cbw : 0; }
  if (ex.unilateral) newSet.uni = true;   // einseitig: ein Eintrag = beide Seiten
  session.sets.push(newSet);
  state.lastValues[ex.key] = { weight: w, reps };
  saveState();

  renderTodaySets();
  refreshSuggestion(ex);   // Vorschlag + Eingabefelder für den nächsten Satz aktualisieren

  // Neuer Rekord? (nur wenn es vorher schon einen gab -> nicht beim allerersten Satz)
  let prText = null;
  if (prevRecord && setScore(newSet) > prevRecord.score + 1e-9) {
    prText = `🏆 Neuer Rekord! ${recordValueText(newSet)}`;
  }

  const targetReached = ex.targetSets && (setIndex + 1) >= ex.targetSets;
  startRest(ex.rest ?? state.settings.defaultRest, targetReached, prText);
}

function deleteSet(ts) {
  const session = activeSession();
  if (!session) return;
  session.sets = session.sets.filter(s => s.ts !== ts);
  let idx = 0;
  session.sets.filter(s => s.key === currentExercise.key)
    .sort((a, b) => a.ts - b.ts).forEach(s => { s.setIndex = idx++; });
  saveState();
  renderTodaySets();
  refreshSuggestion(currentExercise);
}

function flashField(sel) {
  const el = $(sel);
  el.style.borderColor = "var(--danger)";
  el.focus();
  setTimeout(() => { el.style.borderColor = ""; }, 800);
}

/* =====================================================================
   PAUSEN-TIMER – kleiner schwebender Timer unten rechts (blockiert nicht)
   ===================================================================== */
let restTimer = null, restRemaining = 0, restTotal = 0, restEndTs = 0, restRunning = false, restEnded = false;
const MINI_CIRC = 2 * Math.PI * 19;

function startRest(seconds, _choiceMode, prText) {
  restEnded = false;
  const mini = $("#rest-mini");
  mini.classList.remove("overtime");
  $("#rest-mini-fg").style.strokeDasharray = MINI_CIRC;
  if (prText) {
    showBackupToast(prText);   // neuer Rekord als kurzer Hinweis (blockiert nicht)
    if (state.settings.vibrate && navigator.vibrate) navigator.vibrate([30, 50, 30, 50, 150]);
  }
  clearInterval(restTimer); restTimer = null; restRunning = false;
  if (!seconds || seconds <= 0) { mini.classList.add("hidden"); return; }
  // Echtzeit-basiert (Ziel-Zeitstempel) -> übersteht Sperren/App-Wechsel korrekt
  restTotal = seconds; restRemaining = seconds; restEndTs = Date.now() + seconds * 1000; restRunning = true;
  mini.classList.remove("hidden");
  updateRestUI();
  restTimer = setInterval(tickRest, 250);
}
function tickRest() {
  if (!restRunning) return;
  const diffMs = restEndTs - Date.now();
  if (diffMs <= 0 && !restEnded) onRestZero();   // einmalig bei 00:00
  restRemaining = Math.ceil(diffMs / 1000);      // läuft ins Negative weiter (Overtime)
  updateRestUI();
}

// genau bei 00:00: kurzes grünes Aufleuchten + Signal, Timer läuft danach negativ in Pink weiter
function onRestZero() {
  restEnded = true;
  notifyRestEnd();
  const f = $("#screen-flash");
  f.classList.remove("show");
  void f.offsetWidth;               // Animation neu starten
  f.classList.add("show");
  setTimeout(() => f.classList.remove("show"), 650);
}

function updateRestUI() {
  const t = restRemaining;
  const over = t < 0;
  let label;
  if (over) {
    const a = -t;
    label = "−" + Math.floor(a / 60) + ":" + String(a % 60).padStart(2, "0");
  } else {
    const mm = Math.floor(t / 60), ss = t % 60;
    label = mm > 0 ? `${mm}:${String(ss).padStart(2, "0")}` : String(ss);
  }
  const frac = over ? 1 : (restTotal > 0 ? t / restTotal : 0);
  $("#rest-mini-time").textContent = label;
  $("#rest-mini-fg").style.strokeDashoffset = MINI_CIRC * (1 - frac);
  $("#rest-mini").classList.toggle("overtime", over);
}

function stopRest() {
  restRunning = false; restEnded = false;
  clearInterval(restTimer); restTimer = null;
  $("#rest-mini").classList.add("hidden");
  $("#rest-mini").classList.remove("overtime");
}

function notifyRestEnd() {
  if (state.settings.vibrate && navigator.vibrate) navigator.vibrate([200, 80, 200]);
  if (state.settings.sound) beep();
  showRestNotification();
}
// Benachrichtigung am Pausenende (vor allem nützlich, wenn die App im Hintergrund ist)
function showRestNotification() {
  if (!state.settings.notify) return;
  if (!("Notification" in window) || Notification.permission !== "granted") return;
  if (document.visibilityState === "visible") return;  // im Vordergrund reichen Ton/Vibration
  const opts = { body: "Deine Pause ist vorbei – weiter geht's!", tag: "rest-done", icon: "icon.svg", badge: "icon.svg", renotify: true };
  try {
    if (navigator.serviceWorker && navigator.serviceWorker.ready) {
      navigator.serviceWorker.ready.then(reg => reg.showNotification("Pause vorbei", opts)).catch(() => { try { new Notification("Pause vorbei", opts); } catch (e) {} });
    } else { new Notification("Pause vorbei", opts); }
  } catch (e) { /* nicht verfügbar */ }
}

let _audioCtx = null;
function beep() {
  try {
    _audioCtx = _audioCtx || new (window.AudioContext || window.webkitAudioContext)();
    const ctx = _audioCtx;
    if (ctx.state === "suspended") ctx.resume();
    [0, 0.18].forEach((delay, i) => {
      const osc = ctx.createOscillator(), gain = ctx.createGain();
      osc.type = "sine";
      osc.frequency.value = i === 0 ? 880 : 1180;
      gain.gain.setValueAtTime(0.001, ctx.currentTime + delay);
      gain.gain.exponentialRampToValueAtTime(0.3, ctx.currentTime + delay + 0.02);
      gain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + delay + 0.16);
      osc.connect(gain); gain.connect(ctx.destination);
      osc.start(ctx.currentTime + delay); osc.stop(ctx.currentTime + delay + 0.18);
    });
  } catch (e) { /* still */ }
}

/* =====================================================================
   BILDSCHIRM WACH HALTEN (Wake Lock)
   ===================================================================== */
let _wakeLock = null;
async function requestWakeLock() {
  if (!state.settings.keepAwake || !("wakeLock" in navigator)) return;
  try {
    _wakeLock = await navigator.wakeLock.request("screen");
    _wakeLock.addEventListener("release", () => { _wakeLock = null; });
  } catch (e) { /* nicht verfügbar */ }
}
function releaseWakeLock() { try { if (_wakeLock) { _wakeLock.release(); _wakeLock = null; } } catch (e) {} }
document.addEventListener("visibilitychange", () => {
  if (document.visibilityState !== "visible") return;
  if (activeSession()) requestWakeLock();
  updateElapsed();          // Session-Timer sofort auf echte Zeit nachziehen
  if (restRunning) tickRest(); // Pausen-Timer sofort nachziehen (ggf. bereits abgelaufen)
});

/* =====================================================================
   MITLAUFENDER TRAININGS-TIMER
   ===================================================================== */
let _elapsedTimer = null;
function startElapsed() { stopElapsed(); _elapsedTimer = setInterval(updateElapsed, 1000); updateElapsed(); }
function stopElapsed() { clearInterval(_elapsedTimer); _elapsedTimer = null; }
function updateElapsed() {
  const el = $("#session-elapsed"); const s = activeSession();
  if (!el || !s) return;
  el.textContent = "⏱ " + fmtDuration(Date.now() - (s.startTs || Date.now()));
}

/* =====================================================================
   ZUSAMMENFASSUNG NACH DEM TRAINING
   ===================================================================== */
function buildSummary(s) {
  const groups = {};
  s.sets.forEach(x => { (groups[x.key] = groups[x.key] || []).push(x); });
  const vol = Math.round(s.sets.reduce((sum, x) => sum + setVolume(x), 0));
  const prs = [];
  Object.keys(groups).forEach(key => {
    const rec = exerciseRecord(key);
    if (rec && s.sets.indexOf(rec.set) !== -1) prs.push({ name: groups[key][0].exerciseName, text: recordValueText(rec.set) });
  });
  return { dayName: s.dayName, dateISO: s.dateISO, durationMs: sessionDurationMs(s), exCount: Object.keys(groups).length, setCount: s.sets.length, vol, prs };
}
function showSummary(sum) {
  const prHtml = sum.prs.length
    ? `<div class="sum-prs"><p class="sum-prs-h">🏆 Neue Rekorde</p>${sum.prs.map(p => `<div class="sum-pr">${p.name}: <b>${p.text}</b></div>`).join("")}</div>`
    : "";
  $("#summary-body").innerHTML = `
    <p class="sum-title">${sum.dayName ? sum.dayName + " · " : ""}${formatDateDE(sum.dateISO)}</p>
    <div class="sum-stats">
      <div class="sum-stat"><b>${fmtDuration(sum.durationMs)}</b><span>Dauer</span></div>
      <div class="sum-stat"><b>${sum.exCount}</b><span>Übungen</span></div>
      <div class="sum-stat"><b>${sum.setCount}</b><span>Sätze</span></div>
      <div class="sum-stat"><b>${formatNum(sum.vol)}</b><span>kg Volumen</span></div>
    </div>${prHtml}`;
  showScreen("screen-summary");
}

/* =====================================================================
   AUSWERTUNG
   ===================================================================== */
function allLoggedExercises() {
  const map = new Map();
  state.sessions.forEach(s => s.sets.forEach(set => { if (!map.has(set.key)) map.set(set.key, set.exerciseName); }));
  return [...map.entries()].map(([key, name]) => ({ key, name }));
}

function renderStats() {
  const sel = $("#stats-exercise");
  const exs = allLoggedExercises();
  const hasBW = Array.isArray(state.bodyWeights) && state.bodyWeights.length >= 1;
  const hasDuration = state.sessions.some(s => s.sets.length && sessionDurationMs(s) > 0);
  const prev = sel.value;
  sel.innerHTML = "";
  if (!exs.length && !hasBW && !hasDuration) {
    sel.innerHTML = "<option>Noch keine Daten</option>";
    $("#chart-wrap").innerHTML = '<p class="chart-empty">Noch keine Trainingsdaten vorhanden.<br>Erfasse erst ein paar Sätze.</p>';
    $("#stats-table").innerHTML = "";
    return;
  }
  exs.forEach(e => { const o = document.createElement("option"); o.value = e.key; o.textContent = e.name; sel.appendChild(o); });
  if (hasBW) { const o = document.createElement("option"); o.value = "__bw__"; o.textContent = "⚖️ Körpergewicht"; sel.appendChild(o); }
  if (hasDuration) { const o = document.createElement("option"); o.value = "__duration__"; o.textContent = "⏱ Trainingszeit"; sel.appendChild(o); }
  if ([...sel.options].some(o => o.value === prev)) sel.value = prev;
  drawChart();
}

/* ---------- Kalender-Heatmap der Trainingstage ---------- */
function dayVolumeMap() {
  const m = {};
  state.sessions.forEach(s => {
    if (!s.sets.length) return;
    const v = s.sets.reduce((a, x) => a + setVolume(x), 0);
    m[s.dateISO] = (m[s.dateISO] || 0) + v;
  });
  return m;
}
function renderHeatmap() {
  const wrap = $("#cal-heatmap");
  if (!wrap) return;
  const vol = dayVolumeMap();
  if (!Object.keys(vol).length) { wrap.innerHTML = ""; return; }
  const weeks = 18, cell = 15, gap = 3, rows = 7;
  const startMon = addDaysISO(mondayOfISO(todayISO()), -7 * (weeks - 1));
  const maxV = Math.max(...Object.values(vol));
  const today = todayISO();
  const W = weeks * (cell + gap), H = rows * (cell + gap);
  let rects = "", monthLabels = "", lastMonth = "";
  for (let c = 0; c < weeks; c++) {
    const colMon = addDaysISO(startMon, c * 7);
    const mo = colMon.slice(5, 7);
    if (mo !== lastMonth) { monthLabels += `<text x="${c * (cell + gap)}" y="-3" class="hm-mon">${MONTHS_SHORT[+mo - 1]}</text>`; lastMonth = mo; }
    for (let r = 0; r < rows; r++) {
      const d = addDaysISO(colMon, r);
      if (d > today) continue;
      const v = vol[d] || 0;
      const lvl = v === 0 ? 0 : v < maxV * 0.25 ? 1 : v < maxV * 0.5 ? 2 : v < maxV * 0.75 ? 3 : 4;
      const title = formatDateDE(d) + (v ? " · " + formatNum(Math.round(v)) + " kg" : " · frei");
      rects += `<rect x="${c * (cell + gap)}" y="${r * (cell + gap)}" width="${cell}" height="${cell}" rx="3" class="hm hm-${lvl}"><title>${title}</title></rect>`;
    }
  }
  const legend = [0, 1, 2, 3, 4].map(l => `<span class="hm-leg hm-leg-${l}"></span>`).join("");
  wrap.innerHTML = `<h3 class="section-h">📅 Trainingstage (18 Wochen)</h3>
    <div class="hm-card">
      <div class="hm-scroll"><svg viewBox="0 -14 ${W} ${H + 14}" width="${W}" height="${H + 14}" class="hm-svg">${monthLabels}${rects}</svg></div>
      <div class="hm-legend"><span>weniger</span>${legend}<span>mehr</span></div>
    </div>`;
}

/* ---------- Wochenvolumen pro Muskelgruppe (Trend, Übertraining/Lücken) ---------- */
function renderMuscleTrend() {
  const wrap = $("#muscle-trend");
  if (!wrap) return;
  const weeks = 4;
  const startMon = addDaysISO(mondayOfISO(todayISO()), -7 * (weeks - 1));
  const data = {};
  state.sessions.forEach(s => {
    const wkIdx = Math.round(daysBetweenISO(startMon, mondayOfISO(s.dateISO)) / 7);
    if (wkIdx < 0 || wkIdx >= weeks) return;
    s.sets.forEach(x => {
      const m = x.muscle || "Sonstige";
      (data[m] = data[m] || Array(weeks).fill(0))[wkIdx] += setVolume(x);
    });
  });
  const muscles = Object.keys(data);
  if (!muscles.length) { wrap.innerHTML = ""; return; }
  const globalMax = Math.max(...muscles.flatMap(m => data[m]));
  // nach Volumen der aktuellen Woche sortieren
  muscles.sort((a, b) => data[b][weeks - 1] - data[a][weeks - 1]);

  const rowsHtml = muscles.map(m => {
    const w = data[m];
    const cur = w[weeks - 1];
    const prevAvg = (w.slice(0, weeks - 1).reduce((a, b) => a + b, 0)) / (weeks - 1);
    let arrow;
    if (cur === 0) arrow = `<span class="tr-down">▼</span>`;          // Lücke
    else if (cur > prevAvg * 1.05) arrow = `<span class="tr-up">▲</span>`;
    else if (cur < prevAvg * 0.95) arrow = `<span class="tr-down">▼</span>`;
    else arrow = `<span class="tr-flat">▬</span>`;
    const bars = w.map((v, i) => {
      const h = globalMax > 0 ? Math.round(v / globalMax * 100) : 0;
      return `<span class="mt-bar ${i === weeks - 1 ? "mt-bar-cur" : ""}" style="height:${Math.max(3, h)}%" title="Woche -${weeks - 1 - i}: ${formatNum(Math.round(v))} kg"></span>`;
    }).join("");
    return `<div class="mt-row"><span class="mt-name">${m}</span><div class="mt-bars">${bars}</div><span class="mt-arrow">${arrow}</span></div>`;
  }).join("");

  wrap.innerHTML = `<h3 class="section-h">💪 Wochenvolumen pro Muskelgruppe</h3>
    <div class="mt-card"><p class="mt-legend">Letzte 4 Wochen · rechter Balken = diese Woche</p>${rowsHtml}</div>`;
}

/* ---------- Persönliche Rekord-Historie pro Übung ---------- */
// Liste aller Meilensteine, an denen ein neuer Bestwert (Score) erreicht wurde – chronologisch.
function prHistory(key) {
  const sessions = state.sessions
    .filter(s => s.sets.some(x => x.key === key))
    .slice().sort((a, b) => a.dateISO.localeCompare(b.dateISO));
  let best = -Infinity;
  const hist = [];
  sessions.forEach(s => {
    let bestSet = null, bestSc = -Infinity;
    s.sets.filter(x => x.key === key).forEach(x => { const sc = setScore(x); if (sc > bestSc) { bestSc = sc; bestSet = x; } });
    if (bestSet && bestSc > best + 1e-9) { best = bestSc; hist.push({ dateISO: s.dateISO, set: bestSet }); }
  });
  return hist;
}
function renderPRHistory(key) {
  const wrap = $("#pr-history");
  if (!wrap) return;
  if (key === "__bw__" || key === "__duration__") { wrap.innerHTML = ""; return; }
  const hist = prHistory(key);
  if (hist.length < 1) { wrap.innerHTML = ""; return; }
  const rows = hist.slice().reverse().map((h, i) => {
    const isCurrent = i === 0;
    return `<div class="prh-row${isCurrent ? " prh-current" : ""}">` +
      `<span class="prh-medal">${isCurrent ? "🏆" : "•"}</span>` +
      `<span class="prh-val">${recordValueText(h.set)}</span>` +
      `<span class="prh-detail muted">${setShort(h.set)}</span>` +
      `<span class="prh-date">${relativeOrDate(h.dateISO)}</span></div>`;
  }).join("");
  wrap.innerHTML = `<h3 class="section-h">🏅 Rekord-Verlauf</h3><div class="prh-list">${rows}</div>`;
}

function statsSeries(key, metric) {
  if (key === "__bw__") {
    return (state.bodyWeights || []).slice().sort((a, b) => a.dateISO.localeCompare(b.dateISO)).map(w => ({ date: w.dateISO, value: w.kg }));
  }
  if (key === "__duration__") {
    return state.sessions
      .filter(s => s.sets.length && sessionDurationMs(s) > 0)
      .slice().sort((a, b) => a.dateISO.localeCompare(b.dateISO))
      .map(s => ({ date: s.dateISO, value: Math.round(sessionDurationMs(s) / 60000 * 10) / 10 }));
  }
  const byDate = new Map();
  state.sessions.forEach(s => {
    const sets = s.sets.filter(x => x.key === key);
    if (!sets.length) return;
    let value;
    if (metric === "volume") value = sets.reduce((sum, x) => sum + setVolume(x), 0);
    else if (metric === "e1rm") value = Math.max(...sets.map(x => e1rm(effWeight(x), x.reps)));
    else value = Math.max(...sets.map(x => effWeight(x)));
    byDate.set(s.dateISO, Math.round(value * 10) / 10);
  });
  return [...byDate.entries()].sort((a, b) => a[0].localeCompare(b[0])).map(([date, value]) => ({ date, value }));
}

function drawChart() {
  const key = $("#stats-exercise").value;
  const isBW = key === "__bw__";
  const isDuration = key === "__duration__";
  // Kennzahl-Auswahl bei Sonderansichten ausblenden
  $("#metric-label").style.display = (isBW || isDuration) ? "none" : "";
  $("#stats-metric").style.display = (isBW || isDuration) ? "none" : "";
  const metric = (isBW || isDuration) ? "topweight" : $("#stats-metric").value;
  renderPRHistory(key);
  const series = statsSeries(key, metric);
  const wrap = $("#chart-wrap");
  if (!series.length) { wrap.innerHTML = '<p class="chart-empty">Keine Daten für diese Übung.</p>'; $("#stats-table").innerHTML = ""; return; }

  const W = 600, H = 240, pad = { l: 44, r: 16, t: 16, b: 30 };
  const innerW = W - pad.l - pad.r, innerH = H - pad.t - pad.b;
  const values = series.map(d => d.value);
  let min = Math.min(...values), max = Math.max(...values);
  if (min === max) { min = Math.max(0, min - 1); max = max + 1; }
  const range = max - min, n = series.length;
  const x = i => pad.l + (n === 1 ? innerW / 2 : (i / (n - 1)) * innerW);
  const y = v => pad.t + innerH - ((v - min) / range) * innerH;

  const yLabel = isDuration
    ? v => Math.round(v) + "′"
    : v => formatNum(Math.round(v * 10) / 10);
  let grid = "";
  for (let i = 0; i <= 4; i++) {
    const val = min + (range * i / 4), yy = y(val);
    grid += `<line x1="${pad.l}" y1="${yy.toFixed(1)}" x2="${W - pad.r}" y2="${yy.toFixed(1)}" class="grid"/>`;
    grid += `<text x="${pad.l - 8}" y="${(yy + 4).toFixed(1)}" class="ylab">${yLabel(val)}</text>`;
  }
  const linePts = series.map((d, i) => `${x(i).toFixed(1)},${y(d.value).toFixed(1)}`).join(" ");
  const areaPts = `${pad.l},${pad.t + innerH} ${linePts} ${(pad.l + innerW).toFixed(1)},${pad.t + innerH}`;
  const dots = series.map((d, i) => `<circle cx="${x(i).toFixed(1)}" cy="${y(d.value).toFixed(1)}" r="3.5" class="dot"/>`).join("");
  const stepLab = Math.ceil(n / 6);
  let xlab = "";
  series.forEach((d, i) => { if (i % stepLab === 0 || i === n - 1) xlab += `<text x="${x(i).toFixed(1)}" y="${H - 8}" class="xlab" text-anchor="middle">${formatDateShort(d.date)}</text>`; });

  wrap.innerHTML = `
    <svg viewBox="0 0 ${W} ${H}" class="chart-svg" preserveAspectRatio="xMidYMid meet">
      <style>
        .grid{stroke:#2e3340;stroke-width:1}
        .ylab{fill:#8b93a3;font-size:11px;text-anchor:end}
        .xlab{fill:#8b93a3;font-size:11px}
        .area{fill:var(--chart-area)}
        .line{fill:none;stroke:var(--primary);stroke-width:2.5;stroke-linejoin:round;stroke-linecap:round}
        .dot{fill:var(--primary);stroke:var(--bg);stroke-width:1.5}
      </style>
      ${grid}
      <polygon class="area" points="${areaPts}"/>
      <polyline class="line" points="${linePts}"/>
      ${dots}${xlab}
    </svg>`;
  renderStatsTable(series, metric, key);
}

function renderStatsTable(series, metric, key) {
  const unit = key === "__duration__" ? "min" : (metric === "volume" ? "kg (Vol.)" : "kg");
  const rows = series.slice().reverse().map(d => `<tr><td>${formatDateDE(d.date)}</td><td>${formatNum(d.value)} ${unit}</td></tr>`).join("");
  $("#stats-table").innerHTML = `<table><thead><tr><th>Datum</th><th>Wert</th></tr></thead><tbody>${rows}</tbody></table>`;
}

function exportCSV() {
  const rows = [["Datum", "Tag", "Übung", "Satz", "Gewicht_kg", "Körpergewicht", "Zusatz_kg", "Wiederholungen", "Einseitig", "Volumen_kg", "Notiz"]];
  state.sessions.slice().sort((a, b) => a.dateISO.localeCompare(b.dateISO)).forEach(s => {
    s.sets.slice().sort((a, b) => a.ts - b.ts).forEach(set => {
      const eff = effWeight(set);
      const note = (s.notes && s.notes[set.key]) ? s.notes[set.key] : "";
      rows.push([s.dateISO, set.day || s.dayName || "", set.exerciseName, set.setIndex + 1,
        String(eff).replace(".", ","), set.bw != null ? "ja" : "nein", String(set.weight).replace(".", ","),
        set.reps, set.uni ? "ja" : "nein", String(Math.round(setVolume(set) * 10) / 10).replace(".", ","), note]);
    });
  });
  if (rows.length === 1) { alert("Noch keine Daten zum Exportieren vorhanden."); return; }
  const csv = rows.map(r => r.map(cell => {
    const s = String(cell);
    return /[";\n]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s;
  }).join(";")).join("\r\n");
  const blob = new Blob(["﻿" + csv], { type: "text/csv;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url; a.download = `trainingsdaten_${todayISO()}.csv`;
  document.body.appendChild(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 2000);
}

/* =====================================================================
   WOCHENÜBERSICHT (letzte 14 Tage + Trend)
   ===================================================================== */
function sessionsInRange(minAgo, maxAgo) { // [minAgo, maxAgo) Tage her
  return state.sessions.filter(s => { const d = daysAgo(s.dateISO); return d >= minAgo && d < maxAgo; });
}
function aggregate(sessions) {
  let sets = 0, vol = 0;
  sessions.forEach(s => s.sets.forEach(x => { sets++; vol += setVolume(x); }));
  return { count: sessions.length, sets, vol: Math.round(vol) };
}
function bestScoreIn(key, sessions) {
  let b = null;
  sessions.forEach(s => s.sets.forEach(x => { if (x.key === key) { const sc = setScore(x); if (b == null || sc > b) b = sc; } }));
  return b;
}
function trendArrow(cur, prev) {
  if (prev == null) return `<span class="tr-new">✨ neu</span>`;
  if (cur > prev + 1e-9) return `<span class="tr-up">▲</span>`;
  if (cur < prev - 1e-9) return `<span class="tr-down">▼</span>`;
  return `<span class="tr-flat">▬</span>`;
}

function renderWeekOverview() {
  const wrap = $("#week-overview");
  const cur = aggregate(sessionsInRange(0, 14));
  const prev = aggregate(sessionsInRange(14, 28));
  if (cur.count === 0) {
    wrap.innerHTML = `<div class="week-card"><p class="week-title">Letzte 14 Tage</p><p class="muted">Noch keine Einheiten in den letzten 14 Tagen.</p></div>`;
    return;
  }
  const volPct = prev.vol > 0 ? Math.round((cur.vol - prev.vol) / prev.vol * 100) : null;
  const volTrend = volPct == null ? "" :
    `<span class="${volPct >= 0 ? "tr-up" : "tr-down"}">${volPct >= 0 ? "▲" : "▼"} ${Math.abs(volPct)} %</span>`;

  // Fortschritt pro Übung: bestes 1RM letzte 14 Tage vs. davor
  const curSessions = sessionsInRange(0, 14);
  const beforeSessions = sessionsInRange(14, 100000);
  const keys = [];
  curSessions.forEach(s => s.sets.forEach(x => { if (!keys.some(k => k.key === x.key)) keys.push({ key: x.key, name: x.exerciseName }); }));
  const exRows = keys.map(k => {
    const c = bestScoreIn(k.key, curSessions);
    const b = bestScoreIn(k.key, beforeSessions);
    return `<div class="week-ex"><span class="week-ex-name">${k.name}</span>${trendArrow(c, b)}</div>`;
  }).join("");

  // Wochenziel (laufende Kalenderwoche)
  let goalHtml = "";
  if (state.settings.weeklyGoal > 0) {
    const done = thisWeekSessions().length;
    const goal = state.settings.weeklyGoal;
    const pct = Math.min(100, Math.round(done / goal * 100));
    const reached = done >= goal;
    goalHtml = `
      <p class="week-sub">Wochenziel</p>
      <div class="goal-row"><span>${done} / ${goal} Einheiten diese Woche${reached ? " ✅" : ""}</span></div>
      <div class="goal-bar"><div class="goal-fill" style="width:${pct}%"></div></div>`;
  }

  // Muskelgruppen-Verteilung (Sätze pro Gruppe, letzte 14 Tage) – nur falls zugeordnet
  const muscleCount = {};
  curSessions.forEach(s => s.sets.forEach(x => { if (x.muscle) muscleCount[x.muscle] = (muscleCount[x.muscle] || 0) + 1; }));
  const muscles = Object.entries(muscleCount).sort((a, b) => b[1] - a[1]);
  let muscleHtml = "";
  if (muscles.length) {
    const maxC = muscles[0][1];
    muscleHtml = `<p class="week-sub">Sätze pro Muskelgruppe (14 Tage)</p><div class="muscle-list">` +
      muscles.map(([m, c]) => `<div class="muscle-row"><span class="muscle-name">${m}</span><div class="muscle-bar"><div class="muscle-fill" style="width:${Math.round(c / maxC * 100)}%"></div></div><span class="muscle-c">${c}</span></div>`).join("") +
      `</div>`;
  }

  // Ø Trainingsdauer (letzte 14 Tage)
  const durs = curSessions.map(sessionDurationMs).filter(d => d > 0);
  const avgDur = durs.length ? Math.round(durs.reduce((a, b) => a + b, 0) / durs.length) : 0;

  // Trainings-Streak
  const streak = trainingStreak();
  const wochenWort = streak === 1 ? "Woche" : "Wochen";
  const streakLabel = state.settings.weeklyGoal > 0 ? wochenWort + " am Ziel" : wochenWort + " in Folge";
  const streakHtml = streak >= 1
    ? `<div class="streak-badge"><span class="streak-fire">🔥</span><b>${streak}</b> <span>${streakLabel}</span></div>`
    : "";

  wrap.innerHTML = `
    ${streakHtml}
    <div class="week-card">
      <p class="week-title">Letzte 14 Tage</p>
      <div class="week-stats">
        <div class="week-stat"><b>${cur.count}</b><span>Einheiten</span></div>
        <div class="week-stat"><b>${cur.sets}</b><span>Sätze</span></div>
        <div class="week-stat"><b>${formatNum(cur.vol)}</b><span>kg Volumen</span></div>
        <div class="week-stat"><b>${avgDur ? fmtDuration(avgDur) : "–"}</b><span>Ø Dauer</span></div>
      </div>
      ${volTrend ? `<p class="week-trend">Volumen ggü. den 14 Tagen davor: ${volTrend}</p>` : ""}
      ${goalHtml}
      ${muscleHtml}
      ${exRows ? `<p class="week-sub">Fortschritt pro Übung (bestes 1RM)</p><div class="week-exlist">${exRows}</div>` : ""}
    </div>`;
}

/* =====================================================================
   VERLAUF (Trainingstagebuch)
   ===================================================================== */
function renderHistory() {
  const wrap = $("#history-list");
  const sessions = state.sessions.filter(s => s.sets.length).slice()
    .sort((a, b) => b.dateISO.localeCompare(a.dateISO) || (a.id < b.id ? 1 : -1));
  if (!sessions.length) {
    wrap.innerHTML = '<p class="chart-empty">Noch keine abgeschlossenen Einheiten.<br>Starte ein Training und erfasse ein paar Sätze.</p>';
    return;
  }
  wrap.innerHTML = "";
  sessions.forEach(s => {
    const vol = Math.round(s.sets.reduce((sum, x) => sum + setVolume(x), 0));
    const exCount = new Set(s.sets.map(x => x.key)).size;
    const active = s.id === state.activeSessionId;
    const dur = sessionDurationMs(s);

    const det = document.createElement("details");
    det.className = "hist-item";
    const sum = document.createElement("summary");
    sum.innerHTML =
      `<div class="hist-head">` +
        `<span class="hist-date">${relativeOrDate(s.dateISO)}${s.dayName ? " · " + s.dayName : ""}${active ? ' <span class="hist-active">läuft</span>' : ""}</span>` +
        `<span class="hist-meta">${exCount} Übung${exCount === 1 ? "" : "en"} · ${s.sets.length} Sätze · ${formatNum(vol)} kg${dur > 0 ? " · ⏱ " + fmtDuration(dur) : ""}</span>` +
      `</div><span class="hist-chev">›</span>`;
    det.appendChild(sum);

    const body = document.createElement("div");
    body.className = "hist-body";
    const groups = [];
    s.sets.slice().sort((a, b) => a.ts - b.ts).forEach(x => {
      let g = groups.find(g => g.key === x.key);
      if (!g) { g = { key: x.key, name: x.exerciseName, sets: [] }; groups.push(g); }
      g.sets.push(x);
    });
    groups.forEach(g => {
      const row = document.createElement("div");
      row.className = "hist-ex";
      row.innerHTML = `<span class="hist-ex-name">${g.name}</span><span class="hist-ex-sets">${g.sets.map(setShort).join(", ")}</span>`;
      body.appendChild(row);
    });
    det.appendChild(body);
    wrap.appendChild(det);
  });
}

/* =====================================================================
   NAVIGATION & EVENTS
   ===================================================================== */
function showScreen(id) {
  $$(".screen").forEach(s => s.classList.toggle("active", s.id === id));
  const navTarget = (id === "screen-exercise") ? "screen-home" : id;
  $$(".nav-btn").forEach(b => b.classList.toggle("active", b.dataset.screen === navTarget));
  const titles = { "screen-home": "Training", "screen-exercise": "", "screen-stats": "Auswertung", "screen-history": "Verlauf", "screen-settings": "Einstellungen", "screen-summary": "Geschafft" };
  $("#header-title").textContent = titles[id] ?? "Training";
  if (id !== "screen-home") stopElapsed();
  if (id === "screen-home") renderHome();
  if (id === "screen-stats") { renderWeekOverview(); renderHeatmap(); renderMuscleTrend(); renderStats(); }
  if (id === "screen-history") renderHistory();
  if (id === "screen-settings") syncSettingsUI();
  const main = $("#main"); if (main) main.scrollTop = 0;
}

function syncSettingsUI() {
  $("#set-bodyweight").value = currentBodyweight() ?? "";
  $("#set-weeklygoal").value = state.settings.weeklyGoal ?? "";
  $("#set-keepawake").checked = state.settings.keepAwake !== false;
  $("#set-notify").checked = !!state.settings.notify;
  $("#set-defaultrest").value = state.settings.defaultRest;
  $("#set-sound").checked = state.settings.sound;
  $("#set-vibrate").checked = state.settings.vibrate;
  const ab = $("#set-autobackup");
  if (ab) ab.checked = !!state.settings.autoBackup;
  updateAutoBackupUI();
}
function showImportError(msg) { const el = $("#import-error"); el.textContent = msg; el.hidden = false; }
function hideImportError() { $("#import-error").hidden = true; }

function bindEvents() {
  $$(".nav-btn").forEach(btn => btn.addEventListener("click", () => showScreen(btn.dataset.screen)));

  // Import
  const dz = $("#dropzone"), fi = $("#file-input");
  dz.addEventListener("click", () => fi.click());
  dz.addEventListener("keydown", e => { if (e.key === "Enter" || e.key === " ") fi.click(); });
  fi.addEventListener("change", e => { if (e.target.files[0]) handleFile(e.target.files[0]); fi.value = ""; });
  ["dragenter", "dragover"].forEach(ev => dz.addEventListener(ev, e => { e.preventDefault(); dz.classList.add("dragover"); }));
  ["dragleave", "drop"].forEach(ev => dz.addEventListener(ev, e => { e.preventDefault(); dz.classList.remove("dragover"); }));
  dz.addEventListener("drop", e => { const f = e.dataTransfer.files[0]; if (f) handleFile(f); });
  window.addEventListener("dragover", e => e.preventDefault());
  window.addEventListener("drop", e => {
    e.preventDefault();
    if (!state.plan && $("#screen-home").classList.contains("active") && e.dataTransfer.files[0]) handleFile(e.dataTransfer.files[0]);
  });
  $("#load-example").addEventListener("click", loadExamplePlan);
  $("#reimport-plan").addEventListener("click", () => fi.click());

  // Start-Ansicht
  $("#start-training").addEventListener("click", () => startTraining(state.activeDay));

  // Übung für heute hinzufügen (Bibliothek)
  $("#add-exercise").addEventListener("click", openLibraryPicker);
  $("#library-close").addEventListener("click", closeLibraryPicker);

  // Bibliothek ansehen (Einstellungen)
  $("#show-library").addEventListener("click", openLibraryView);
  $("#library-view-close").addEventListener("click", closeLibraryView);

  // Eigene Übung anlegen
  $("#lib-new").addEventListener("click", () => openNewExercise(true));      // aus Picker -> auch heute hinzufügen
  $("#libview-new").addEventListener("click", () => openNewExercise(false)); // aus Einstellungen -> nur Bibliothek
  $("#newex-save").addEventListener("click", saveCustomExercise);
  $("#newex-cancel").addEventListener("click", closeNewExercise);

  // Backup speichern / laden
  $("#backup-save").addEventListener("click", () => autoBackup(true));
  $("#backup-load").addEventListener("click", () => $("#backup-input").click());
  $("#backup-reminder").addEventListener("click", () => autoBackup(true));
  $("#backup-input").addEventListener("change", e => { if (e.target.files[0]) importBackup(e.target.files[0]); e.target.value = ""; });

  // Trainings-Steuerung
  $("#finish-session").addEventListener("click", openFinishConfirm);
  $("#finish-confirm-yes").addEventListener("click", () => { closeFinishConfirm(); finishTraining(); });
  $("#finish-confirm-no").addEventListener("click", closeFinishConfirm);
  $("#cancel-session").addEventListener("click", openCancelConfirm);
  $("#cancel-confirm-no").addEventListener("click", closeCancelConfirm);
  $("#cancel-confirm-yes").addEventListener("click", () => { closeCancelConfirm(); cancelTraining(); });

  // Zusammenfassung
  $("#summary-done").addEventListener("click", () => showScreen("screen-home"));

  // Übungsdetail
  $("#exercise-back").addEventListener("click", () => showScreen("screen-home"));
  $("#save-set").addEventListener("click", saveSet);
  $("#open-note").addEventListener("click", openNoteModal);
  $("#note-save").addEventListener("click", saveExerciseNote);
  $("#note-cancel").addEventListener("click", closeNoteModal);
  $$(".step").forEach(b => b.addEventListener("click", () => {
    const input = $("#" + b.dataset.target), delta = parseFloat(b.dataset.delta);
    let next = (parseFloat(String(input.value).replace(",", ".")) || 0) + delta;
    const allowNeg = b.dataset.target === "in-weight" && currentExercise && currentExercise.bodyweight;
    if (!allowNeg && next < 0) next = 0;
    input.value = Number.isInteger(next) ? next : Math.round(next * 100) / 100;
  }));

  // Pausen-Timer (kleiner Eck-Timer; Tippen beendet die Pause)
  $("#rest-mini").addEventListener("click", stopRest);

  // Auswertung
  $("#stats-exercise").addEventListener("change", drawChart);
  $("#stats-metric").addEventListener("change", drawChart);
  $("#export-csv").addEventListener("click", exportCSV);

  // Einstellungen
  $("#set-bodyweight").addEventListener("change", e => {
    const v = parseFloat(String(e.target.value).replace(",", "."));
    if (Number.isFinite(v) && v > 0) upsertBodyweight(v);
    else { state.settings.bodyweight = null; }
    saveState();
  });
  $("#set-weeklygoal").addEventListener("change", e => {
    const v = parseInt(e.target.value, 10);
    state.settings.weeklyGoal = Number.isFinite(v) && v > 0 ? v : null;
    saveState();
  });
  $("#set-keepawake").addEventListener("change", e => {
    state.settings.keepAwake = e.target.checked; saveState();
    if (e.target.checked && activeSession()) requestWakeLock(); else releaseWakeLock();
  });
  $("#set-notify").addEventListener("change", e => {
    state.settings.notify = e.target.checked; saveState();
    if (e.target.checked && "Notification" in window && Notification.permission === "default") {
      Notification.requestPermission().then(p => {
        if (p !== "granted") { state.settings.notify = false; e.target.checked = false; saveState(); alert("Benachrichtigungen wurden nicht erlaubt. Du kannst sie in den iPhone-Einstellungen für die App freigeben."); }
      });
    }
  });
  $("#set-defaultrest").addEventListener("change", e => { state.settings.defaultRest = Math.max(0, parseInt(e.target.value, 10) || 0); saveState(); });
  $("#set-sound").addEventListener("change", e => { state.settings.sound = e.target.checked; saveState(); if (e.target.checked) beep(); });
  $("#set-vibrate").addEventListener("change", e => { state.settings.vibrate = e.target.checked; saveState(); });
  $("#set-autobackup").addEventListener("change", e => {
    state.settings.autoBackup = e.target.checked; saveState(); updateAutoBackupUI();
  });
  $("#set-backup-folder").addEventListener("click", async () => {
    const ok = await pickBackupFolder();
    if (ok) updateAutoBackupUI();
  });
  $("#clear-history").addEventListener("click", () => {
    if (confirm("Wirklich den gesamten Trainings-Verlauf löschen? Der Plan bleibt erhalten.")) {
      state.sessions = []; state.lastValues = {}; state.activeSessionId = null; state.activeDay = suggestNextDay(); saveState(); renderHome(); alert("Verlauf gelöscht.");
    }
  });
  $("#clear-all").addEventListener("click", () => {
    if (confirm("Wirklich ALLES zurücksetzen (Plan + Verlauf)? Das kann nicht rückgängig gemacht werden.")) {
      state = defaultState(); saveState(); showScreen("screen-home"); alert("Zurückgesetzt.");
    }
  });
}

/* ---------- Beenden-Bestätigung mit Kurzübersicht ---------- */
function openFinishConfirm() {
  const s = activeSession();
  if (!s) return;

  const planEx = exercisesForDay(s.dayName);
  const allEx = planEx.concat(s.extraExercises || []);
  const doneCount = allEx.filter(isExerciseDone).length;
  const totalCount = allEx.length;
  const setCount = s.sets.length;
  const elapsed = s.startTs ? Date.now() - s.startTs : 0;
  const mins = Math.round(elapsed / 60000);
  const vol = Math.round(s.sets.reduce((sum, x) => sum + setVolume(x), 0));

  const parts = [];
  parts.push(`${doneCount}/${totalCount} Übung${totalCount === 1 ? "" : "en"}`);
  parts.push(`${setCount} Satz${setCount === 1 ? "" : "ätze"}`);
  if (mins > 0) parts.push(`${mins} min`);
  if (vol > 0) parts.push(`${formatNum(vol)} kg Volumen`);

  $("#finish-summary").innerHTML = parts.map(p => `<span class="finish-stat">${p}</span>`).join("");
  $("#finish-overlay").classList.remove("hidden");
}
function closeFinishConfirm() {
  $("#finish-overlay").classList.add("hidden");
}

/* ---------- Abbrechen-Bestätigung mit 3-Sekunden-Sperre ---------- */
let _cancelCountdown = null;
function openCancelConfirm() {
  const ov = $("#cancel-overlay"), yes = $("#cancel-confirm-yes");
  ov.classList.remove("hidden");
  let left = 3;
  yes.disabled = true;
  yes.textContent = `Training abbrechen (${left})`;
  clearInterval(_cancelCountdown);
  _cancelCountdown = setInterval(() => {
    left--;
    if (left <= 0) {
      clearInterval(_cancelCountdown); _cancelCountdown = null;
      yes.disabled = false; yes.textContent = "Training abbrechen";
    } else { yes.textContent = `Training abbrechen (${left})`; }
  }, 1000);
}
function closeCancelConfirm() {
  clearInterval(_cancelCountdown); _cancelCountdown = null;
  $("#cancel-overlay").classList.add("hidden");
}

/* ---------- Beispielplan ---------- */
function loadExamplePlan() {
  const csv =
`Tag;Übung;Muskelgruppe;Sätze;Wiederholungen;Gewicht;Pause;Seite
Push;Bankdrücken;Brust;3;8-12;60;120;
Push;Schrägbankdrücken Kurzhantel;Brust;3;10-12;22;90;
Push;Schulterdrücken;Schultern;3;8-10;30;90;
Push;Seitheben;Schultern;3;12-15;10;60;
Push;Kabel-Seitheben einseitig;Schultern;3;12-15;7;45;ja
Push;Trizeps Pushdown;Trizeps;3;12-15;25;60;
Pull;Klimmzüge;Rücken;3;6-10;0;120;
Pull;Langhantelrudern;Rücken;3;8-12;50;90;
Pull;Latzug;Rücken;3;10-12;55;90;
Pull;Bizeps Curls;Bizeps;3;10-12;14;60;
Beine;Kniebeuge;Beine;4;6-10;80;150;
Beine;Beinpresse;Beine;3;10-12;120;120;
Beine;Beinbeuger;Beine;3;12-15;40;75;
Beine;Wadenheben;Waden;4;15-20;60;45;`;
  try { applyPlan(rowsToExercises(parseCSV(csv))); } catch (e) { showImportError(e.message); }
}

/* ---------- Service Worker (Offline) ---------- */
if ("serviceWorker" in navigator) {
  window.addEventListener("load", () => {
    navigator.serviceWorker.register("sw.js").catch(err => console.warn("SW-Registrierung fehlgeschlagen:", err));
  });
}

/* ---------- Start ---------- */
bindEvents();
renderHome();
if (activeSession()) requestWakeLock();   // nach App-Neustart bei laufendem Training
