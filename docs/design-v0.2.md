# Agent Talk · Detailentwurf v0.2

**Status:** Zur Freigabe. Kein Implementierungscode, kein Deployment.

## 1. Was v1 können soll

Zwei Agenten tauschen nach einer beidseitig bestätigten Einladung eine Textfrage und eine Antwort aus. Online kommt die Nachricht per WebSocket an. Offline speichert der Zusteller sie verschlüsselt bis zum Wiederverbinden. Kein Polling. Gruppen, eigene Kommandos, öffentliche Suche, Anhänge und autonome Aktionen sind nicht in v1.

## 2. So erlebt man es

1. Besitzer A exportiert eine zeitlich begrenzte Einmaleinladung mit Anzeigename, öffentlichen Schlüsseln bzw. Fingerabdruck und Verweis auf den kompatiblen MCP-Adapter. A teilt sie über einen bekannten Kontaktweg.
2. Besitzer B sieht die Vorschau und bestätigt. Besitzer A bestätigt die zurückgemeldete Identität von B. Vorher gehen keine Nachrichten durch. Ein fremdes Profil installiert oder startet nichts automatisch.
3. Der lokale MCP-Adapter stellt Tools zum Lesen, Fragen und Antworten bereit. Kontaktannahme, Schlüsselwechsel und Blockieren bleiben Besitzeraktionen. Nachrichteninhalt erteilt keine Berechtigungen und löst keine allgemeinen Tools aus.
4. Blockieren stoppt neue Zustellung. Bereits zugestellte Kopien werden nicht aus fremden Geräten gelöscht.

## 3. Architektur und Datenschutz

- Ein Cloudflare Worker mit SQLite Durable Objects hält Zustellzustand und hibernierende WebSockets. Der Worker speichert nur Ciphertext und notwendige Routing-/Zeitdaten. Kein öffentliches Verzeichnis. Der Relay-Betreiber kann weiterhin Zustellbeziehungen beobachten.
- Pro Agent erzeugt der Adapter eigene Schlüssel zur Signatur/Identität und Verschlüsselung. Die privaten Schlüssel bleiben nur beim Agenten oder seinem lokalen Adapter. Kein separater Schlüsseldienst, keine Wiederverwendung von Git-Zugangsdaten. Schlüssel aus der Einladung werden nach Bestätigung fest mit dem Kontakt verknüpft; Änderungen benötigen erneute Verifizierung.
- Für den Pilot ist eine gepflegte Bibliothek für [HPKE](https://www.rfc-editor.org/rfc/rfc9180.html) vorgesehen, mit Authentifizierung gegen den bestätigten Absenderschlüssel. Kein eigener Kryptografie-Algorithmus. Der MVP verspricht keine Forward Secrecy für gespeicherten Ciphertext bei Verlust eines langlebigen Empfängerschlüssels.
- Online wird gepusht. Beim Wiederverbinden fragt der Adapter ab dem letzten bestätigten Stand nach. Stabile Nachrichten-IDs und lokale Deduplizierung verhindern, dass eine erneut zugestellte Meldung doppelt angezeigt wird. Größen- und Mengenlimits sowie begrenzte Offline-Aufbewahrung werden im Free-Kontingent getestet.
- Dot/Muse bleiben spätere Adapter; ein Wake-Event allein entschlüsselt nichts. Keine Klartext-Bridge, keine Übergabe von privaten Schlüsseln an den Relay. OpenClaw wird zuerst über einen lokalen MCP-Adapter ausprobiert.

## 4. Baufolge und Abnahme

1. Lokale Profile und Einladungen: Besitzerbestätigung, Ablauf, Wiederverwendung und Blockieren testen.
2. Verschlüsselter Nachrichtenaustausch: Testagent B kann entschlüsseln; fremder Schlüssel, veränderte Nachricht und nicht bestätigter Absender scheitern. Relay-Zustand und Logs enthalten keine privaten Schlüssel oder Nachrichtentexte.
3. Zustellung: echte Socket-Tests für Live-Nachrichten, Offline-Reconnect, Wiederholung ohne Doppelanzeige und Frage/Antwort über MCP.
4. Cloudflare-Dev-Rollout: automatisierte Tests in GitHub Actions, danach manueller Deploy auf Workers Free. Erst auf einer Test-URL testen, dann `agent-talk.nyphon.de` nach Prüfung der Zone und vorhandener DNS-Einträge als Custom Domain binden. Kein Tarifupgrade, keine Secrets im Code. Falls nötig, hinterlegt Ralph ein minimal berechtigtes Cloudflare-Token direkt in GitHub Secrets.

**Diese Freigabe umfasst den Entwurf.** Erst nach dem Okay beginnt die Implementierung in der sichtbaren Codex-Session.