# AI Performance

[Documentation](https://tobias-oberpaul.github.io/aip/docs/)

Lokales Dashboard für KI-gestützte Arbeit. Tickets können Durchläufe mehrerer Tools enthalten. Arbeitszeit und Nacharbeit werden pro Ticket zusammengefasst. Verbrauch bleibt in der jeweiligen Einheit sichtbar.

## Installation im Projekt

Führe die Befehle mit Node.js 22.13 oder neuer im Stammverzeichnis des Ziel-Clones aus.

Wenn `npm start` mit einer älteren Node-Version aufgerufen wird, sucht AIP eine kompatible Version im PATH und unter Windows zusätzlich in der lokalen Codex-Runtime. Ist keine verfügbar, installiere eine aktuelle Node-LTS-Version und öffne ein neues Terminal.

```powershell
npm install -D @tobiasoberpaul/aip
npm exec -- aip serve
```

Für einen Vorabtest kannst du bei der Installation statt des Paketnamens den Pfad zur lokalen `.tgz`-Datei angeben. Die Installation allein erfasst keine Daten. Aktiviere die gewünschten Hooks explizit im eigenen Clone:

```powershell
npm exec -- aip init --codex
npm exec -- aip init --kiro
# Oder beide Integrationen zugleich
npm exec -- aip init --codex --kiro
```

Der Einrichtungsbefehl übernimmt bestehende, unabhängige Hook-Einträge und ergänzt die Git-Ignore-Regeln für Datenbank, Altdaten und lokale Aktivierung. In Codex musst du die neuen Hooks unter **Settings → Hooks** bestätigen. Jeder Clone aktiviert die Erfassung separat, auch wenn die Hook-Konfiguration eingecheckt ist. Mit `npm exec -- aip disable` pausierst du die npm-Hooks in deinem Clone. Gespeicherte Daten bleiben verfügbar.

Wenn das Projekt bereits die manuell kopierten Hooks verwendet, entferne deren Einträge vor dem Wechsel zu den npm-Hooks. Die Datenbank bleibt am selben Ort. Die npm-Hooks verwenden jeweils die im Projekt installierte Paketversion. Ein Update aktualisiert damit UI und Hook-Code gemeinsam.

Das Paket stellt außerdem `aip record` und `aip import-history` bereit. Ersetze bei npm-Installation die unten gezeigten Aufrufe von `npm run record -- …` und `npm run import-history -- …` durch `npm exec -- aip record …` beziehungsweise `npm exec -- aip import-history …`.

### Wechsel vom bisherigen Paketnamen

Installiere zuerst `@tobiasoberpaul/aip` und führe `npm exec -- aip init` mit denselben Provider-Optionen wie bisher aus. Das aktualisiert die vorhandenen npm-Hook-Launcher. Danach kannst du `npm uninstall @tobiasoberpaul/ai-performance` ausführen. Die Datenbank bleibt in deinem Clone.

## Start aus dem Tool-Clone

Benötigt Node.js ab Version 22.13 und npm. Führe die Befehle in diesem Repository aus.

```powershell
npm ci
npm start
```

Öffne die ausgegebene Adresse mit `127.0.0.1`. Ohne Pfad wertet das Dashboard das aktuelle Verzeichnis aus. Übergib ein anderes Projekt mit `npm start -- "<Projektpfad>"`. Der sichtbare Dashboard-Tab prüft alle 15 Sekunden und beim Wiederanzeigen auf neue Daten.

## Projektdaten und Migration

Die lokale Datenbank `.codex/performance.sqlite` enthält Tickets, Durchläufe, Verbrauch und Kontingentbeobachtungen. Beim ersten Öffnen übernimmt das Tool vorhandene Daten aus `context-packages.json`, `context-usage.jsonl` und `context-history/`. Mit `npm run record -- migrate` lässt sich die Migration vorab auslösen. Die alten Dateien bleiben als Ausgangssicherung erhalten. Verwende für die weitere Erfassung die aktualisierten Hooks und den Datenbankbefehl.

Sichere `.codex/performance.sqlite`, wenn keine Erfassung läuft. Die Datenbank und ihre SQLite-Nebendateien bleiben lokal und gehören in die Git-Ignore-Liste.

## Hooks

- **Codex:** Kopiere die Skripte aus `tool/telemetry/.codex/hooks/` und ergänze die Hook-Einträge in der bestehenden `.codex/hooks.json`. Prüfe und bestätige sie in Codex unter **Settings → Hooks** oder mit `/hooks`. Die Hooks benötigen Git und Node.js 22.13 oder neuer im PATH.
- **Kiro:** Kopiere `tool/telemetry/.kiro/hooks/` nach `.kiro/hooks/` und die beiden Dateien `performance-store.cjs` und `performance-backup.cjs` aus `tool/telemetry/.codex/hooks/` nach `.codex/hooks/`. Der AgentStop-Hook erfasst lokale Durchläufe als Kiro. Ist `AI_PERFORMANCE_TICKET_ID` in der Kiro-Umgebung gesetzt, verwendet er diese Ticket-ID. Andernfalls findest du den Durchlauf mit `npx aip record list unassigned` und kannst ihn mit `npx aip record link <provider>/<id> <ticket-id>` zuordnen. Credits und Dauer können aus einer geeigneten Quelle ergänzt werden.

## Tickets und Messwerte schreiben

Die Schreibbefehle `ticket`, `run` und `quota` akzeptieren eine JSON-Datei oder `-` für stdin. Übergib bei Bedarf nach der Datei den Pfad zum Zielprojekt.

```powershell
npm run record -- ticket ticket.json
npm run record -- list ticket
npm run record -- run run.json
npm run record -- quota quota.json
npm run record -- link "kiro/<run-id>" "<ticket-id>"
```

Ein Ticket hat mindestens `id`, `name` und `epic`. Dieselbe ID aktualisiert den Eintrag. Für Codex verknüpfen `sessionId` und `turnId` in `subtasks` die erfassten Modellaufrufe. Andere Integrationen können `ticketId` am Durchlauf angeben oder den Durchlauf später verknüpfen.

Ergänze bei neuen Tickets `description` als Text mit Ziel, Kontext und erwartetem Ergebnis. Ein Klick auf eine Ticketzeile öffnet die Beschreibung, Messwerte und Durchläufe in einer Detailansicht.

`aip init` ergänzt in `AGENTS.md` eine Regel zur Epic-Zuordnung. Projekte können dort ihre Epic-Namen und Zuständigkeiten festlegen. Vor einem neuen Ticket prüft der Agent diese Liste und die bereits verwendeten Namen mit `npx aip record list ticket`. Bestehende Tickets behalten ihre Zuordnung.

Tickets gehören in die lokale AIP-Datenbank des Repositorys, in dem die Änderung landet. Betrifft eine Aufgabe mehrere Repositorys, erfasst jedes seinen eigenen Teil. Nach dem npm-Update übernimmt `npx aip init --context` die Regel in eine bestehende AIP-Einrichtung, ohne die Provider-Hooks neu zu konfigurieren.

Ein Kiro-Durchlauf mit einem gemessenen Verbrauch:

```json
{
  "id": "review-123",
  "provider": "kiro",
  "ticketId": "P-001",
  "name": "Review implementation",
  "kind": "feedback",
  "workSeconds": 90,
  "metrics": [{ "unit": "credits", "value": 2.4 }]
}
```

Eine Kontingentbeobachtung enthält `id`, `provider`, `account`, `periodStart`, `periodEnd`, `observedAt`, `unit` und `used`. `limit` und `overage` sind optional. Die UI zeigt den neuesten Stand je Anbieter, Konto, Einheit und Zeitraum. Kontostände werden separat vom Ticketverbrauch angezeigt.

## Auswertung

The ticket list fits as many complete rows as the available height allows and defaults to most recent activity. Its epic and story-point filters narrow only the ticket list. Sort by recorded tokens, work time or their per-story-point equivalents. Tickets without the selected measurement sort last. Tickets and runs show the recorded provider, model and reasoning effort when available. Use the history import to enrich older records whose source transcript is still present. Use `npx aip record list quota` to inspect account and pool measurements.

The chat-context overview plots tokens or work time per story point against estimated context at the first recorded request. It includes all positive story-point sizes by default, with independent filters for ticket size and starting model. Rework rounds are also available. The heatmap groups tickets into 5-percentage-point context columns and ten effort rows. The top row includes higher values, and stronger colors indicate more tickets. Select a populated cell to inspect its tickets. The heatmap keeps its project-wide scale when filtering by story points or model. Measured tickets without a starting-context estimate appear in a separate Unknown column and stay out of context-band calculations. Each summary band shows the median and, where a positive baseline exists, the change from the below-25% band.

Das Dashboard zeigt Arbeitszeit und Tokens pro Story Point zusätzlich zu den absoluten Ticketwerten. Für jede Kennzahl gilt ein gemeinsamer Projektwert über alle Ticketgrößen: Summe der Messwerte geteilt durch die Summe der zugehörigen Story Points. In die Bewertung fließen mindestens drei erledigte Tickets mit positiven Story Points und vollständigen, positiven Messwerten ein. Für den Token-Score zählen reine Codex-Tickets. Nacharbeit fließt über die Ticket-Summen ein. Der Score ist `100 × Projektwert pro SP / Ticketwert pro SP`, gerundet auf eine ganze Zahl. Ab 110 ist die Bewertung grün, von 90 bis 109 neutral und unter 90 rot. Projektwerte und Ticket-Scores bleiben beim Epic-Filter gleich und gelten für das ganze Ticket.

Änderungen an React-Komponenten, CSS und der Datenaufbereitung laden den geöffneten Browser-Tab automatisch neu. Änderungen am Server-Einstiegspunkt `tool/integration-and-release/serve.mjs` erfordern einen Serverneustart.

## Vorhandene Messwerte sichern

Führe `npm run import-history` im Tool-Projekt aus. Für ein anderes Projekt nutze `npm run import-history -- "<Projektpfad>"`. Der Import durchsucht aktive und archivierte Codex-Sitzungen der eingetragenen Tickets und schreibt die Messdaten in das jeweilige Projekt. Wiederholte Importe zählen dieselben Messwerte einmal. `npm start -- --codex-history` führt den Import vor dem Start aus.

## Lokale Sicherungen

Vor dem ersten Schreibvorgang eines Kalendertags legt AIP einen geprüften SQLite-Stand in `.codex/backups/` an. Die letzten 30 Tagesstände pro Clone bleiben erhalten. Nach erfolgreichen Änderungen aktualisiert AIP `latest.sqlite` im Hintergrund, gebündelt in einem Abstand von ungefähr zehn Sekunden. Das Archiv und die Fehlerstatusdateien sind von Git ausgeschlossen.

Für eine Wiederherstellung führe diese Befehle im Projektverzeichnis aus. Bei einer npm-Installation verwende `npx aip backup` gefolgt von denselben Unterbefehlen.

```text
npm run backup -- list
npm run backup -- preview latest.sqlite
npm run backup -- restore <name> <version>
```

`list` zeigt die vorhandenen Stände und eventuelle Sicherungsfehler. `preview` prüft den gewählten Stand und gibt die Anzahl der Tickets, Aufrufe, Durchläufe und Sitzungsmessungen aus. Verwende bei `restore` den Namen und die Version aus der Vorschau. Der Befehl ersetzt den Inhalt der vorhandenen SQLite-Datenbank und gibt den Namen der vorherigen Sicherung als `undo` zurück. Vorschau und Wiederherstellung dieses Eintrags machen den Vorgang rückgängig. Das Archiv liegt im selben Clone wie die Datenbank.

## Resource Bound Documentation

`npx aip init --context` richtet den Projektindex und die Arbeitsregel in `AGENTS.md` ein. Die Einrichtung mit `--codex` oder `--kiro` enthält dieselbe Struktur. Bestehende Notizen bleiben erhalten. Agents mit einem anderen Einstiegsformat können aus ihrer Projektanleitung auf `AGENTS.md` verweisen.

Der Index `CONTEXT.md` im Repository-Stamm verbindet Epic, Quellordner und Doku. Ein Eintrag wie `[Integration and Release](tool/integration-and-release/README.md)` steht für den gleichnamigen Ticket-Epic. Das README liegt im Quellordner. Feature- und Dateinotizen liegen neben dem jeweiligen Code. Bestehende Projekte mit `docs/context/index.md` können dieses Layout weiterverwenden.

Für einen neuen Bereich legt `npx aip context epic "Epic name"` den Quellordner, die Doku und den Indexeintrag an. `npx aip context check [base]` prüft neue Dateien und ihre Zuordnung lokal. Als Vergleich dient standardmäßig `HEAD`.

**Documentation** öffnet den Projektindex im Vollbild. Das Inhaltsverzeichnis zeigt die Abschnitte der aktuellen Seite und die verlinkten Feature- und Dateinotizen. Auf Unterseiten führt **Back** zur vorherigen Seite. Über die Pfadzeile gelangst du direkt zu einem früheren Eintrag oder zum Projektindex.

Für eine Fortsetzung kann ein Agent einen kurzen, Git-ignorierten Übergabestand unter `.aip/handoffs/<ticket-id>.md` ablegen. Im neuen Chat legt der Agent ein neues Ticket an und verweist in dessen Beschreibung auf das vorherige Ticket.

Die Warnung betrachtet den zuletzt gemessenen Chat. Ab 25 % Kontext vergleicht AIP dessen letzte fünf abgeschlossene Tickets mit mindestens 25 % Startkontext mit den Tickets desselben Chats unter 25 %. Beide Gruppen brauchen mindestens fünf Messwerte für die jeweilige Kennzahl. Steigen Tokens oder Arbeitszeit pro Story Point um mindestens 30 %, meldet das Dashboard höheren Aufwand. Ab 95 % meldet es zusätzlich das nahende Kontextlimit. Der Hinweis zum Wechsel erscheint derzeit für Codex, da dessen Messadapter den Kontextfüllstand liefert.

Fehlende Messwerte aus bereits gelöschten Sitzungen lassen sich mit einem Backup des ursprünglichen Verlaufs oder Logs nachtragen.

Beispiel für ein Ticket mit einem zugeordneten Codex-Durchlauf:

```json
{
  "id": "P-001",
  "name": "Aktiven TOC-Eintrag sichtbar halten",
  "description": "Beim Scrollen soll der aktive Abschnitt im Inhaltsverzeichnis sichtbar bleiben.",
  "epic": "Documentation Navigation",
  "points": 2,
  "strategy": "fresh",
  "startedAt": "2026-11-05T10:00:00Z",
  "completedAt": "2026-11-05T10:05:00Z",
  "acceptedAt": "2026-11-05T10:20:00Z",
  "subtasks": [
    { "name": "TOC-Verhalten umsetzen", "kind": "implementation", "sessionId": "erste-session", "turnId": "umsetzung", "workSeconds": 100 },
    { "name": "Scrollgrenze korrigieren", "kind": "feedback", "sessionId": "fortsetzung", "turnId": "korrektur", "workSeconds": 45 }
  ]
}
```

Codex leitet `name` beim Erfassen aus dem Aufgabenziel ab. Bei älteren Einträgen ohne Namen zeigt das Dashboard die Paket-ID. Verwende `fresh` oder `continued` für den Start des Pakets. `acceptedAt` bleibt bis zur Abnahme `null`. Zähle Fehlversuche, Übergabe und Neustart zum Paket. Vergleiche bei gleichem Modell und ähnlichen Aufgaben die Tokens bis zur Abnahme innerhalb derselben Punktestufe. Zeit und Korrekturrunden bleiben separat. Die Hook-Zähler lassen sich nicht zuverlässig in Prozentpunkte des 5‑Stunden-Kontingents umrechnen.
