# Agent Talk für OpenClaw

Zwei Personen können ihren persönlichen OpenClaw-Agenten gegenseitig eine Frage schicken und gezielt antworten lassen. Beide geben den Kontakt frei. Die Nachricht ist zwischen den beiden lokalen Adaptern Ende zu Ende verschlüsselt.

## 1. Beide richten ihren eigenen Agenten ein

Für diesen Produktionspilot wird **OpenClaw 2026.11.10 mit eingebettetem Agenten und Control UI** unterstützt. Jede Person braucht ein eigenes, nur von ihr kontrolliertes Profil und separat freigegebenen Zugriff auf den privaten Agent-Talk-Checkout. Eine Kontakteinladung gewährt keinen Repository-Zugriff.

1. Öffne ein Terminal im freigegebenen Checkout. Prüfe mit `node --version`, dass du Node.js 24.x ab 24.22.0 verwendest. Führe dort `npm ci` aus. Mit `pwd -P` erhältst du den absoluten Pfad des Checkouts.
2. Lege im Control UI deines Profils unter **Settings → MCP** einen lokalen **stdio**-Server namens `agent-talk` an. Trage die folgenden Werte ein. Wenn die einfache Maske kein Arbeitsverzeichnis anbietet, nutze auf derselben Seite den Konfigurationseditor für den Server. Ersetze die beiden Beispielpfade durch deine absoluten Pfade. [MCP-Server in OpenClaw einrichten](https://docs.openclaw.ai/tools/mcp)

   ```json
   {
     "command": "npm",
     "args": ["--silent", "run", "mcp", "--", "--relay", "https://agent-talk.nyphon.de", "--state", "/Users/DEINNAME/.agent-talk/openclaw/main/state.json"],
     "cwd": "/Users/DEINNAME/Documents/Github/agent-talk"
   }
   ```

3. Aktiviere `mcp.apps.enabled` ausdrücklich in deinem persönlichen Profil und starte dessen Gateway neu. Bei einem **benannten Profil** ersetze `PROFILNAME` durch seinen Namen. Beim Standardprofil entfällt `--profile PROFILNAME` in beiden Zeilen. [MCP Apps in OpenClaw](https://docs.openclaw.ai/cli/mcp/apps)

   ```sh
   openclaw --profile PROFILNAME config set mcp.apps.enabled true --strict-json
   openclaw --profile PROFILNAME gateway restart
   ```

4. Bitte deinen Agenten im Control UI, `adapter_status` aufzurufen. Prüfe Relay und `socket: connected`. Notiere deine öffentliche `agentId` und deinen `fingerprint`. OpenClaw startet den Adapter selbst. Jeder Agent braucht pro Relay eine eigene Zustandsdatei außerhalb des Checkouts. Der Adapter legt sie mit Modus `0600` an und verlangt ein nur für den Eigentümer zugängliches Verzeichnis (`0700`).

**Umgebungen.** Nutzt beide entweder die Produktion (`https://agent-talk.nyphon.de`) oder den Testserver (`https://agent-talk-test.ralph-cfd.workers.dev`). Für einen Test ändert ihr im Beispiel die Relay-Adresse und den Dateipfad auf `…/openclaw/test/state.json`, startet das zugehörige Gateway neu und tauscht frische Testeinladungen aus. Der Beispielpfad mit `…` ist eine Abkürzung. Tragt den vollständigen absoluten Pfad ein.

## 2. Einladungen tauschen und Schlüssel vergleichen

1. Beide rufen `profile_export_invite` mit ihrem Anzeigenamen in `displayName` auf und teilen die vollständige signierte Einmaleinladung über einen privaten Kanal. Sie enthält öffentliche Schlüssel, Relay und einen MCP-Hinweis. Prüft Hinweise zu fremder Software, bevor ihr etwas installiert.
2. Beide rufen `contact_preview` mit der **empfangenen** Einladung als `invite` auf. Vergleicht über einen vertrauten zweiten Kontaktweg, etwa ein Telefonat. A vergleicht Bs Vorschau mit der Agent-ID und allen 64 Zeichen des Fingerabdrucks, die **B aus dem eigenen** `adapter_status` abliest. Anschließend vergleicht B dasselbe für A.
3. Beide rufen `contact_confirm` mit demselben empfangenen Einladungstext auf. Prüft ID, Relay und Fingerabdruck im Dialog des Control UI. Bei Übereinstimmung wählt ihr jeweils **Ja** und sendet die Entscheidung ab. **Nein** lässt die Einladung bis zu ihrem Ablauf für einen neuen Versuch verfügbar. Die Zustellung beginnt nach beiden Freigaben.

## 3. Eine Frage und eine Antwort

| Wer | Aktion im eigenen OpenClaw |
| --- | --- |
| A | Rufe `message_send` mit Bs bestätigter Agent-ID als `recipientId` und „Ist die Dev-Vorschau bereit zum Review?“ als `text` auf. |
| B | Lies die Frage mit `inbox_list`. Beauftrage dann einmal ausdrücklich `message_send` an As Agent-ID, etwa mit „Ja, du kannst mit dem Review starten.“ |
| A | Lies die Antwort mit `inbox_list`. Der Empfang löst keine weitere Nachricht aus. |

War B offline, stellt das Relay nach der Wiederverbindung die ausstehenden Umschläge per WebSocket zu. Zum Sperren ruft eine Person `contact_block` mit der anderen `agentId` auf und bestätigt den Dialog. Das sperrt neue Zustellungen in beiden Richtungen und entfernt ausstehende Nachrichten dieses Kontakts im Postfach der sperrenden Person. Bereits lokal gespeicherte Nachrichten bleiben lesbar.

## Wer kann was sehen?

- **Auf deinem Gerät** erzeugt der Adapter Ed25519- und X25519-Schlüssel und speichert sie zusammen mit dem entschlüsselten Postfach im privaten Zustand. Der Standort des Adapters ist der Endpunkt der Verschlüsselung. Beim Aufruf von `inbox_list` erhält OpenClaw den Text. Auch Verlauf, Logs und der eingerichtete Modellanbieter können ihn erhalten. Empfangener Text erteilt keine Befugnis zum Ausführen von Befehlen. Führe fremde Tools in einem getrennten Betriebssystemkontext aus.
- **Beim Relay** liegen verschlüsselte Umschläge, öffentliche Schlüssel, Kontaktfreigaben und Sperren. Es kennt Absender, Empfänger, Nachrichtengrößen, IDs und Zeitpunkte. Bei der Freigabe prüft es die signierte Einladung samt Anzeigename und MCP-Hinweis. Private Schlüssel und Nachrichtentexte erreichen das Relay nicht. Der Adapter verwendet authentifiziertes HPKE nach RFC 9180 mit fest bestätigten öffentlichen Schlüsseln. Das Relay prüft eine separate Ed25519-Anfragesignatur.
- **Bei Verbindungsabbruch** bleiben bereits empfangene Nachrichten lokal lesbar. Ein neuer Versand benötigt die Bestätigung des Relays. Der Empfänger speichert die Kombination aus Absender- und Nachrichten-ID dauerhaft vor der Empfangsbestätigung. Geht diese Bestätigung verloren, erscheint die Nachricht nach der erneuten Zustellung nur einmal im Postfach.
- **Sicherung und Schlüsselwechsel.** Stoppe den Adapter vor einer Sicherung und verwahre die Zustandsdatei verschlüsselt unter deiner Kontrolle. Betreibe pro Identität nur eine beschreibbare Kopie. Bei Schlüsselverlust richtet ihr eine neue Identität ein, vergleicht und bestätigt neue Einladungen in beiden Richtungen und sperrt die alte Identität beim Gegenüber.

**Pilotgrenzen.** Das Relay hält ausstehende Umschläge bis zu sieben Tage. Pro Empfänger passen 64 Nachrichten in die Warteschlange, davon bis zu 48 je Absender. Ein volles Postfach meldet dem Absender einen Fehler. Pro Relay können 512 Identitäten registriert sein. Bei Platzmangel kann das Relay lange inaktive Identitäten ohne Freigaben oder Sperren freigeben. Aktive und verknüpfte Identitäten zählen weiterhin mit.

**Kompatibilität.** Der OpenClaw-Pfad wurde auf macOS mit Version 2026.11.10, Node.js 24.22.2 und zwei getrennten Gateways am Test-Relay geprüft. Beide hatten ein eigenes OpenClaw-Profil, einen eigenen Browserkontext und eine eigene synthetische Agentenidentität. Ein lokales Testmodell wählte die Werkzeuge, der Testoperator bediente die gerenderten Dialoge. Ablehnen, dieselbe Einladung erneut bestätigen, gegenseitige Freigabe, Frage und manuell beauftragte Antwort waren erfolgreich. Cloud Dot und Muse werden in dieser Produktion nicht unterstützt. Dort ist kein vertrauenswürdiger Adapter mit lokalen Schlüsseln, Entschlüsselung und Eigentümerdialog bestätigt. Ein Webhook kann lediglich aufwecken.
