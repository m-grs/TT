# Trainingstracker 🏋️

Eine kleine Web-App (PWA) zum Dokumentieren deines Fitnessstudio-Trainings.
Läuft auf dem iPhone, funktioniert offline und speichert alle Daten **nur lokal auf deinem Gerät**.

## Was die App kann
- **Trainingsplan importieren** (CSV oder Excel) per Drag & Drop oder Datei-Auswahl
- **„Training starten"** auf dem Startbildschirm – die App schlägt automatisch den **nächsten Split** in Rotation vor (z. B. Push → Pull → Beine)
- **Sätze erfassen**: Gewicht & Wiederholungen pro Satz
- **„Letztes Mal: X kg × Y"** wird pro Übung angezeigt – auch planübergreifend (gleiche Übung wird am Namen wiedererkannt)
- **Pausen-Timer**, der nach jedem Satz automatisch startet – mit der Pausenzeit aus deinem Plan (pro Übung)
- Nach Erreichen der Soll-Sätze: Abfrage **„Weiterer Satz" / „Nächste Übung"**
- **Freier Wechsel** zwischen Übungen (keine feste Reihenfolge)
- **Training beenden** (speichern) oder **abbrechen** (heutige Sätze verwerfen)
- **Automatisches Merken** der zuletzt benutzten Werte → beim nächsten Mal vorausgefüllt
- **Rekorde**: erkennt neue Bestleistungen (geschätztes 1RM) und zeigt beim Übertreffen ein 🏆-Banner im Pausen-Timer; Bestleistungs-Liste in der Auswertung
- **Progressions-Vorschlag** (+2,5 kg, wenn letztes Mal das Ziel erreicht war), **mitlaufender Trainings-Timer**, **Zusammenfassung** nach dem Training
- **Wochenübersicht** (letzte 14 Tage, rollend): Volumen-Trend, Ø-Dauer, Wochenziel, Muskelgruppen-Verteilung, Körpergewicht-Verlauf
- **Pausen-Timer** läuft echtzeitbasiert (übersteht Sperren) mit optionaler **Benachrichtigung** am Pausenende; **Bildschirm-wach-halten** während des Trainings
- **Körpergewichtsübungen** (Plan-Gewicht = 0, z. B. Klimmzüge): Eingabe als „Zusatzgewicht"; mit dem in den Einstellungen hinterlegten **Körpergewicht** werden 1RM & Volumen korrekt berechnet
- **Auswertung**: Wochenübersicht (letzte 14 Tage + Trend), Fortschritts-Diagramm pro Übung + **CSV-Export** für Excel/Numbers
- **Verlauf**: Trainingstagebuch – abgeschlossene Einheiten chronologisch, aufklappbar mit allen Sätzen
- Mehrere Trainingstage (z. B. Push / Pull / Beine) über die Spalte „Tag"

## Aufbau des Trainingsplans (CSV/Excel)
Erste Zeile = Spaltennamen. Reihenfolge der Spalten ist egal, Groß-/Kleinschreibung egal.

| Spalte | Pflicht | Beispiel | Bedeutung |
|---|---|---|---|
| Übung | ✅ | Bankdrücken | Name der Übung |
| Sätze | – | 3 | geplante Anzahl Sätze |
| Wiederholungen | – | 8-12 | Ziel-Wiederholungen |
| Gewicht | – | 60 | Ziel-Gewicht in kg |
| Pause | – | 90 | Pausenzeit in Sekunden |
| Tag | – | Push | Trainingstag / Split (optional) |

Eine fertige Beispieldatei liegt bei: `beispiel-trainingsplan.csv`.

> **Tipp:** In Excel/Numbers kannst du den Plan bequem erstellen und dann als **CSV** speichern
> („Datei → Exportieren/Speichern unter → CSV"). CSV funktioniert immer offline.
> Excel-Dateien (.xlsx) gehen auch, brauchen beim Import aber einmal Internet.

## Lokal testen (am Mac)
```bash
cd trainingstracker
python3 -m http.server 8123
```
Dann im Browser öffnen: http://localhost:8123

## Auf das iPhone bringen (GitHub Pages)
Gehostet über **GitHub Pages**: https://m-grs.github.io/TT/
Updates: geänderte Dateien im Repo `TT` hochladen/überschreiben → committen. Die App
holt sich das Update beim nächsten Start (Asset-Versionierung `?v=N` + Service-Worker-Cache).

Auf dem iPhone in **Safari** öffnen → Teilen-Symbol → **„Zum Home-Bildschirm"**.
Eigene Daten (Plan, Verlauf, Einstellungen) liegen im Browser-Speicher und bleiben bei
Updates erhalten. Vor größeren Aktionen: **Einstellungen → Backup speichern**.

## Dateien
- `index.html` – Aufbau der Oberfläche
- `styles.css` – Aussehen
- `app.js` – die gesamte Logik (Import, Erfassung, Timer, Auswertung, Speicherung)
- `manifest.webmanifest` – PWA-Einstellungen (Name, Icon, Vollbild)
- `sw.js` – Service Worker für Offline-Betrieb
- `icon.svg` – App-Icon
- `beispiel-trainingsplan.csv` – Beispielplan zum Ausprobieren

## Lizenz
[MIT](LICENSE) – frei nutzbar, ändern & weitergeben erlaubt.
