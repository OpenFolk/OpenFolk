# Changelog

Alle wichtigen Änderungen an OpenFolk. Die englische Fassung ist `CHANGELOG.md`; Versionen und Daten sind
dieselben.

## [Unreleased]

### Neu
- Mission Control: Missionen, langfristige Ziele, die ein Team aus Bots selbstständig verfolgt, in einem eigenen Tab.
  Ein Builder macht aus einem Ziel in eigenen Worten einen bearbeitbaren Vorschlag (Kriterien, Team mit Porträts und
  Supervisor, Meilensteine, Risiken, Autonomie, Freigaberegeln, Budget, Leitplanken, Zeitplan); der Supervisor führt die
  Mission in Zyklen von je einem Durchlauf, gibt Aufgaben als Aufträge ans Team und protokolliert seine Entscheidungen;
  Ergebnisse, Freigaben, Meldungen des Teams und der Zeitplan starten den nächsten Zyklus. Vier Autonomiestufen,
  gespeicherte Freigabe-Anfragen mit Push, ein Budget je Mission (Kosten und Durchläufe), ein Notaus und Zyklen, die
  einen Neustart überstehen. Das Projekt einer Mission liest seine Grenzen aus `.openfolk/mission.json`, die Bots nicht
  ändern dürfen, und meldet Zahlen in `.openfolk/metrics.json` für die Missionsseite. Neue Frames `missions`,
  `mission_open`, `mission_propose`, `mission_save`, `mission_control`, `mission_approval_reply`, `mission_task_save`,
  `mission_delete` und die Antworten `missions`, `mission_detail`, `mission_proposal`, `mission_saved`; neue Werkzeuge
  `mission_*` für die Bots im Team einer Mission; Missionen reisen im Abgleich mit.
- Entwürfe je Chat: Getippter, nicht gesendeter Text bleibt beim Chatwechsel an seinem Chat, der andere Chat beginnt
  mit leerem Feld (oder seinem eigenen Entwurf); zurück im Chat steht der Text wieder da, auch nach einem Neuladen (nur
  auf diesem Gerät). Die Liste zeigt „Entwurf: …“ für einen nicht offenen Chat; Senden löscht ihn.
- Markdown-Anhänge (`.md`, etwa Pläne, die ein Bot schickt) öffnen sich zum Lesen in der App, formatiert wie eine
  Bot-Antwort, mit „Speichern“ für die Datei; bisher wurden sie nur heruntergeladen.
- Demo-Konten für die Prüfer der App-Stores: `DEMO_ACCOUNTS` und `DEMO_PASSWORD` am Relay legen Konten mit festem Namen
  und Passwort an, die nach einer Löschung durch einen Prüfer unter neuer ID wiederkommen, und ein Backend mit
  `DEMO_BOT` gibt jedem davon einen Bot aus dieser Vorlage. Neues optionales Feld `demo` an Konto und Person.
- `message_bot` mit `conversation: "new"` öffnet für den Auftrag eine neue Unterhaltung: beim genannten Bot oder, ohne
  Bot, beim fragenden Bot selbst. Bisher konnte sich ein Bot einen Nebenauftrag nur in eine schon vorhandene eigene
  Unterhaltung geben.
- Der Chat eines Bots zeigt seinen Hauptchat und seine Unterhaltungen als Tabs direkt unter dem Kopf: Ein Tipp wechselt
  den Bereich, „+“ startet eine neue Unterhaltung, langes Drücken (oder Rechtsklick) auf den Tab einer Unterhaltung benennt sie um, ein Punkt markiert einen Tab, der arbeitet oder Ungelesenes hat. Nur
  bei einem Bot mit Unterhaltungen.
- Einstellungen › Bots: „Freigaben für neue Bots“, gemeinsam für alle Rechner des Kontos. Jeder neue Bot startet mit
  dieser Stufe: aus „Neuer Bot“ (die Vorlagen bringen keine eigene mehr mit), von der Kommandozeile und aus `create_bot`
  ohne Stufe; ein von einem Bot angelegter Bot bekommt nie „nie fragen“ (dann „bei riskanten Aktionen“). Neues Feld
  `botApproval` der gemeinsamen Einstellungen.
- Melden und Blockieren, für die Regeln der App-Stores zu KI-Inhalten und Inhalten anderer Personen: „Melden“ im
  ⋯-Menü einer Bot-Antwort oder der Nachricht einer Person öffnet eine Seite mit Grund und Anmerkung; das Backend
  zitiert die gespeicherte Nachricht in den Personenchat mit jedem Admin des Relays, ohne weiteren Admin geht die
  Meldung per Mail an support@openfolk.app (jetzt auch unter Einstellungen › Über). „Blockieren“ im Menü eines
  Personenchats verwirft Nachrichten und Übergaben dieser Person auf jedem Rechner und sperrt das Schreiben an sie,
  bis „Blockierung aufheben“. Neue Frames `report`, `report_sent` und `person_block`, neues optionales
  `PersonChat.blocked`.
- Nachrichten an einen arbeitenden Claude-Bot gehen in seinen laufenden Auftrag statt in die Warteschlange, wie im
  Terminal (die CLI liest sie beim nächsten Schritt; der Chat sagt das); „Danach“ neben dem Eingabefeld stellt eine
  hinter den Auftrag (neues optionales `later` an `send`). Aufträge anderer Bots, Routinen, Gruppen und andere Engines
  warten wie bisher.
- Push-Dienst für die Store-Apps: Das Relay von openfolk.app (`PUSH_SERVICE=on`, `POST /push`) stellt App-Push für
  jedes Backend an jedem Relay zu, mit der Vorschau, die das Backend nach „App-Benachrichtigungen zeigen“ gekürzt hat,
  gedrosselt je Gerätetoken und Absender, ohne etwas zu speichern; ein Backend nutzt ihn zuletzt, nach eigenen
  APNs/FCM-Zugangsdaten und seinem Relay (`PUSH_SERVICE_URL`, Standard `https://push.openfolk.app`, `off` schaltet ab).
  Die zweite Ausnahme zu „das Relay sieht keine Inhalte“ (AGENTS.md).
- Jedes Konto außer dem des Relay-Besitzers löscht sich in der App selbst: „Mein Konto löschen“ im Formular des
  eigenen Kontos, mit zweifacher Rückfrage; das Relay entfernt es samt Geräten, seine Rechner löschen seine Daten.
- Sprachdialog in der App auf einem schnellen Modell: Er läuft in der Unterhaltung „Sprachdialog“ des Bots auf Sonnet,
  jeder Dialog mit frischem Kontext; die erste Nachricht bekommt die letzten Nachrichten des Hauptchats, schwere Arbeit
  gibt der Bot mit `message_bot` an seinen Hauptchat (eigenes Modell, ganzer Kontext), und am Ende geht, was gesagt
  wurde, mit der nächsten Nachricht an den Hauptchat. Je Bot „Sprachdialog auf einem schnellen Modell“ im Editor
  (Standard an, neues optionales `talkFast`); Bots auf einer anderen Engine sprechen wie bisher in ihrem Chat. Neue
  Frames `talk_start`, `talk_end`, `talk_started`, neues optionales `talk` an einer Unterhaltung.
- Sprachdialog in der App: Die Antwort wird Satz für Satz vorgelesen, während der Bot noch schreibt, statt erst am
  Ende; was beim Vorlesen eines Satzes dazukommt, folgt in einem Zug, ein Codeblock, sobald er geschlossen ist, und die
  fertige Antwort liest nur noch den Rest.
- Der Tresor: Zugangsdaten für die Arbeit der Bots (API-Token, Passwörter von Diensten) unter Einstellungen ›
  „Tresor“, nur für Admins. Jeder Eintrag hat einen Namen wie eine Umgebungsvariable, eine Notiz, einen Wert und die
  Bots, die ihn nutzen dürfen (alle oder angehakte); ein Bot bekommt seine Einträge als Umgebungsvariablen seines
  Engine-Prozesses und jedes Befehls, den er ausführt, und sein Systemprompt nennt sie. Ein Wert ist in der App
  write-only (ersetzen oder löschen, nie anzeigen) und wird als `[vault:NAME]` aus allem geschwärzt, was ein Bot sagt,
  aus seinen Werkzeugaufrufen und -ergebnissen, Freigabekarten und dem Verlauf. Auf der Platte ist der Tresor mit
  einem Schlüssel des Rechners verschlüsselt (`vault-key` im Datenordner); zu den anderen Rechnern reist er nur in der
  verschlüsselten Synchronisation, wie die API-Schlüssel. Namen, mit denen sich die Engines anmelden (`ANTHROPIC_*`,
  `OPENAI_API_KEY`, `GH_TOKEN`, …), werden abgelehnt. In der Freigabestufe „riskant“ fragt ein Befehl, der die ganze
  Umgebung ausgibt (`printenv`, `env`, `Get-ChildItem Env:`), vorher nach. Neue Frames `vault`, `vault_save`,
  `vault_delete`.
- Bots legen auf Wunsch neue Bots an, mit dem neuen Werkzeug `create_bot` (Name, Ordner, wahlweise Fachgebiet, Rolle,
  Arbeitsanweisungen, Freigabestufe außer „nie“, Ordner der Liste), gespeichert wie „Neuer Bot“ in der App; der neue Bot
  richtet sich in seinem eigenen Chat ein.
- Chats mit Personen kommen wie Bots und Gruppen in Ordner der Chatliste: „Ordner“ in ihrem Menü, Ziehen auf die
  Überschrift eines Ordners und `set_folder` mit dem Namen der Person (neues optionales `category` am Personen-Chat).
- Ein Bot der Einrichtung eines Kontos kann das Profilbild eines eigenen Bots des Admins zeigen („Profilbild“: „Wie
  mein Bot …“ im Einrichtungsdialog, neues optionales `avatarFrom` in der Einrichtung); das Bild reist mit der
  Einrichtung, und ein neues Bild jenes Bots schickt die Einrichtung von selbst neu, sodass der Bot der Person folgt.
  SVGs werden nicht übernommen.
- Desktop-App: Die Einstellungen zeigen unter „Über“ das Update der App: ob sie aktuell ist, ob eine neue Version
  geladen wird oder bereit ist, „Nach Updates suchen“, „Jetzt neu starten“, sobald eine Version geladen ist, und den
  Schalter für die automatische Suche, wie in den Menüs der App.
- Chats mit Personen: „Gefällt mir“ im ⋯-Menü einer Nachricht der anderen Person setzt ein Herz daran, das beide Seiten
  sehen, „Gefällt mir nicht mehr“ nimmt es zurück. Braucht die neue Version auf den Backends beider Konten.

### Geändert
- Die Grenze von 30 fehlgeschlagenen Anmeldungen pro Stunde zählt je Konto: Raten an einem Konto sperrt nicht mehr die
  Passwort-Anmeldung aller anderen, und fehlgeschlagene Joins, Claims und Einrichtungslinks sperren sie gar nicht mehr.

### Behoben
- Springt man in einen Chat (Tab, Befehlspalette, Benachrichtigung, Favoriten-Kachel), scrollt die Chatliste links zu
  seiner Zeile, nur so weit wie nötig; eine Unterhaltung unter einem zugeklappten Bot zeigt die Zeile des Bots.
- iPhone und iPad (Web-App und Home-Bildschirm-App): Bei offener Tastatur springt das Fenster nicht mehr nach oben.
  iOS beachtet `interactive-widget=resizes-content` nicht und schob stattdessen die ganze Seite; die App nimmt jetzt die
  Höhe über der Tastatur (`visualViewport`), die Seitenleisten und Dialoge auch (das Feld eines Dialogs bleibt über der
  Tastatur), und das Fenster bleibt stehen. Umbenennen einer Unterhaltung per langem Drücken auf ihren Tab öffnet die
  Tastatur im Feld.
- Auf Tablet und Computer öffnen die offenen Änderungen eines Bots (Git-Symbol im Chatkopf und in der Liste) in der
  Seitenleiste, als Bot-Seite direkt bei den offenen Änderungen, wie „Bot bearbeiten“; das Handy behält die eigene Seite.
- Die Modell-Chips gehen von links das stärkste nach rechts das schwächste (Fable, Opus, Sonnet, Haiku), danach die
  anderen Engines, egal in welcher Reihenfolge der Rechner die Modelle meldet.
- Die Chatliste zeigt laufende und wartende Bots ganz oben, die fertigen mit Ungelesenem darunter (bisher umgekehrt).
- Die Suche über der Chatliste hat ihre Filter (Nachrichten, Bots, Dateien, Routinen) auf jedem Bildschirm, nicht nur
  auf dem Handy; auf dem Desktop suchte sie nur Nachrichten.
- Sprachnachrichten mit der Sprache „Automatisch erkennen“ werden nur noch unter den Sprachen der App erkannt
  (Englisch, Deutsch): Whisper hielt kurze Aufnahmen ab und zu für Französisch und schrieb sie französisch auf („Oui,
  elle est close“ für „Ja, leg los“). Braucht faster-whisper 1.0 oder neuer; mit einem älteren bleibt die Erkennung frei.
- Die Favoriten-Kacheln oben in der Liste bewegen sich wie die Liste: Ein Bot, der arbeitet oder auf dich wartet,
  springt nach vorne, fertige mit Ungelesenem folgen, dann der Rest, jeweils neueste Nachricht zuerst.
- „Kontext leeren“ ist ein Chip in der Zeile der Kontextzahl oben auf der Bot-Seite und im Menü eines Chats (kein
  Eintrag „Neue Session“ weiter unten mehr), und ein Tipp setzt die Zahl sofort zurück, im Kopf und auf der Seite; die
  offene Seite folgt auch neuen Zahlen.
- „Bot bearbeiten“ in der Seitenleiste setzt den Cursor nicht mehr ins erste Feld (keine Tastatur auf dem Tablet), und
  wo die Leiste über dem Chat liegt, schließt ein Klick daneben den Editor samt Bot-Seite.
- Sprachnachrichten mit kurzem Transkript nehmen die volle Blasenbreite ein, die Audiospur ist so lang wie bei einem
  langen (auf dem iPad war sie nur ein kurzer Stummel).
- Profilbilder: Fehlt der Schlüssel des gewählten Bildmodells, ist aber der des anderen Anbieters gespeichert (Gemini
  gewählt, nur ein OpenAI-Schlüssel), kommt das Foto von dessen Modell statt eines gezeichneten Bilds; gezeichnet wird
  nur ohne jeden Schlüssel. Fotos über OpenAI nutzen `gpt-image-2`, weil OpenAI `gpt-image-1` eingestellt hat (die
  Einstellung behält ihren Wert).


## [0.7.1] - 2026-11-20

### Behoben
- Die Desktop-Apps von 0.7.0 sind da: Ihre Builds hielten an einem Test an, der noch die Startseite vor dem
  Einrichtungs-Assistenten erwartete, so kam 0.7.0 ohne Downloads und ohne Update für installierte Apps. Die Apps sind
  dieselben, die 0.7.0 gewesen wäre.

## [0.7.0] - 2026-11-20

### Neu
- Release-Notes auch auf Deutsch: „Was ist neu?“ zeigt die Notes in der Sprache der App; die deutschen kommen aus der
  neuen `docs/CHANGELOG.de.md`, die jede Version enthält, und eine Version ohne sie zeigt die englischen mit Hinweis.
- Die Einrichtung der Desktop-App ist ein Assistent in drei Schritten (Einrichtungsweg, dieser Rechner, KI-Anbieter;
  der dritte steht direkt unter dem zweiten auf derselben Seite und ist die Wahl eines Anbieters: Claude mit dem Abo
  oder mit einem API-Schlüssel, Codex, GitHub Copilot oder keiner mit den kostenlosen Modellen von OpenCode; er
  entfällt, wenn schon eine Engine bereit ist): Nach jeder Anmeldung an einem Relay (Einladungslink, URL und Passwort,
  QR-Code) folgt „Diesen Rechner einrichten“, das nach den Ordnern fragt und das Backend auf diesem Rechner für das
  angemeldete Konto startet. Wer nur mit einem Link eingeladen wurde, landet so nicht mehr bei „kein Rechner
  erreichbar“. Dafür darf jedes Konto einen eigenen Rechner einbringen: Ein angemeldetes Gerät bittet das Relay um eine
  Einladung (neue Anfrage `machine_own`; das Hauptkonto bekommt einen Rechner des Relays, jedes andere Konto einen an
  sich gebundenen Rechner, 15 Minuten gültig). Der Einrichtungsweg
  „Auf diesem Rechner“ heißt jetzt „Ohne Einrichtung“ und springt sofort zum zweiten Schritt; die Einladung eines
  Rechners und ein Einrichtungslink fragen dort nach den Ordnern, bevor sie beitreten.
- Die Ordner der Chatliste haben eine eigene Reihenfolge: Mit der Maus ziehst du einen Ordner auf einen anderen, auf
  dem Handy hat sein Menü „Nach oben“ und „Nach unten“ (neuer Frame `category_order`, optionales `order` am Ordner,
  wird mit ihm synchronisiert). Ein Bot oder eine Gruppe, auf die Überschrift eines Ordners gezogen, kommt hinein,
  auf „In keinem Ordner“ wieder heraus.
- Die offenen Änderungen der Repos eines Bots stehen im Kopf seines Chats wie in der Liste (das Git-Symbol mit der
  Zahl der Repos); ein Tipp öffnet sie, und zurück geht es von dort in den Chat.
- Bots sortieren die Chatliste auf Wunsch in Ordner: die neuen Werkzeuge `set_folder` (Bots und Gruppen per ID oder
  Name in einen Ordner, der bei Bedarf angelegt wird; ein leerer Ordner nimmt sie heraus; ein unbekannter Name ändert
  nichts) und `list_folders`, auf jeder Engine, mit einer Zeile im Chat.
- Bilder und Videos im Chat: Ein Bild, das ein Bot mit `send_file` schickt (ohne Vorschau), lädt von seinem Rechner in
  die Nachricht, sobald es ins Bild scrollt, und öffnet sich groß ohne zweiten Abruf; Videos (MP4, WebM, MOV) laufen
  in einem Player über der Seite, statt heruntergeladen zu werden, und werden einmal pro Seite abgerufen.
- Welche IDE „Diesen Chat in der IDE öffnen“ öffnet, wählst du in den Einstellungen des Rechners: VS Code (wie
  bisher), Cursor, Windsurf, VS Code Insiders oder VSCodium (neue Rechner-Einstellung `handoverIdeApp`); der Button,
  die Rückfrage und die Zeile im Chat nennen sie. Ein eigenes `HANDOVER_IDE` in der `.env` gewinnt weiterhin und
  sperrt die Wahl mit Begründung (`offers.ideFromEnv` in `machine_settings`, `ide` in `backend_status`).
- Profilbilder für Konten: Jede Person setzt ihr eigenes unter „Bearbeiten“ in der Kontenliste, ein Admin setzt eines
  für jedes Konto in dessen Dialog „Bearbeiten“. Das Bild wird auf dem Gerät quadratisch zugeschnitten und auf 256 px
  verkleinert; das Relay speichert es beim Konto (neues optionales `avatar` in `account_update`, `RelayAccount` und
  `Person`, eine PNG-, JPEG- oder WebP-Data-URL mit höchstens 150.000 Zeichen, `null` entfernt es) und gibt es mit den
  Personen an die Backends weiter, sodass Personenchats und die Kontenliste es statt der Initialen zeigen.

### Geändert
- Ein eingeladenes Konto hat alle Personen, die es anschreiben darf, von Anfang an in der Chatliste, nicht erst nach
  einer ersten Nachricht (das Hauptkonto, das jedes Konto erreicht, listet weiter nur die, mit denen es schreibt).
- Direkt nach dem Start zeigt eine leere Rechnerliste bis zu 45 Sekunden den Ladebalken statt „Noch kein Rechner
  erreichbar“: Das eigene Backend der Desktop-App meldet sich einige Sekunden nach der Einrichtung.
- Der im dritten Schritt der Desktop-Einrichtung gewählte Anbieter ist der einzige eingeschaltete; ein von früher
  eingeschalteter startete neue Bots ohne Anmeldung („Not logged in“).
- Ist Claude auf einem Rechner ausgeschaltet, läuft ein auf Claude gestellter Chat (das Modell „Standard“ eines neuen
  Bots) mit dem ersten eingeschalteten Anbieter, statt „Not logged in · Please run /login“ zu antworten; der Editor
  wählt diesen Anbieter für einen neuen Bot vor, und der Modell-Umschalter zeigt ihn statt „Standard“.
- Die Vorschläge im Editor (Name, Rolle, Profilbild) und das eigene Bild eines Bots brauchen kein Claude mehr: Ist
  Claude auf dem Rechner ausgeschaltet, beantwortet sie ein eingeschalteter Anbieter.
- Die Anmeldung auf der Einrichtungsseite der Desktop-App (Einladungslink, URL und Passwort) zeigt nicht mehr
  zwischendurch die Web-App: Sie meldet sich unsichtbar an, die Seite geht zu Schritt 2 weiter, alle Schritte bleiben
  sichtbar.
- Eine abgelehnte Anmeldung auf der Einrichtungsseite der Desktop-App (ein verbrauchter oder abgelaufener
  Einladungslink, ein falsches Passwort) führt zurück zu Schritt 1, mit dem Grund unter dem Feld, statt zur
  Anmeldeseite der Web-App; nach einem TOTP-Code fragt weiter die Web-App.
- Schritt 2 der Desktop-Einrichtung nach einer Anmeldung hat kein „Nicht jetzt“ mehr: Der Rechner tritt dem Relay bei,
  oder Schritt 1 nimmt einen anderen Weg.
- Verliert ein Rechner mit Bots seine Anmeldung, steht das auf der Seite „Status“, mit seinen Bots und dem Weg zur
  Anmeldung, und der Tab „Status“ trägt so lange ein „!“; die Chatliste zeigt nur noch die ersten Schritte einer neuen
  Installation.
- Ein Rechner, der Bots ausführt und seine Anmeldung verloren hat (ein abgelaufener Claude-Login), steht oben in der
  Liste auf dem Handy („Auf OFFICE-PC erneut anmelden“, mit seinen Bots und dem Weg zur Anmeldung dort), auch wenn ein
  anderer Rechner angemeldet ist. Bisher kam die Karte nur, solange gar kein Rechner bereit war, und dann als erste
  Schritte.
- Menü und Seite eines Bots zeigen zuerst die Umschalter (Kontext, Modell, Rechner); „Neue Unterhaltung“ und „In eine
  Unterhaltung verschieben“ (in einer Unterhaltung „Umbenennen“) führen die Einträge darunter an, statt über den
  Umschaltern zu stehen.
- Die Anmeldung und die Einrichtungsseite der Desktop-App verzichten auf ihre Erklärungen (die Einleitungszeile, die
  Hinweise unter Passwort, QR-Code und Ordnern, die Links für Neue, die Warnung beim Passwortweg, die die Rückfrage vor
  dem Verbinden wiederholt) und behalten nur Felder, Buttons, kurze Trenner, die Rückfrage und Fehler. Die Felder
  heißen „Passwort“ und „URL“ (ohne Beispieladresse darin) statt „Relay-Passwort“ und „Server-URL“.
- Die Anmeldung (Browser, Apps) und die Einrichtungsseite der Desktop-App sind ein kleiner Assistent: zuerst
  „Einrichtungsweg wählen“, dann nur die Felder dieses Wegs. Bei der Anmeldung: Einladungslink, URL und Passwort (im
  Browser nur das Passwort), QR-Code zeigen, QR-Code scannen (wo es eine Kamera gibt) und der Geräte-Anmeldecode aus
  dem Backend-Log, solange das Hauptkonto kein Gerät hat. Auf der Einrichtungsseite: Einladungslink, URL und Passwort
  (das dort eingegebene Passwort meldet an, die Seite des Relays fragt nicht mehr danach), QR-Code (sofort gezeigt,
  wenn die URL bekannt ist; die Anmeldung der Apps macht es genauso) und auf diesem Rechner, wobei die Ordner, in
  denen die Bots arbeiten dürfen, nicht mehr eingeklappt sind und der Satz zum Standardordner fehlt (die Liste nennt
  ihn).
- Die vier ersten Schritte (Rechner, KI-Anbieter, erster Bot, Geräte) sind aus der Liste verschwunden. Übrig ist die
  Anmeldung bei einem KI-Anbieter: Solange ein Rechner verbunden und keiner seiner Anbieter bereit ist, steht sie in
  der Startansicht neben der Liste, auf dem Handy oben in der Liste. Ein neuer Bot kommt über „+“, das Handy über die
  Geräte in den Einstellungen, der Umzug auf ein Relay auf einem Server ebenfalls von dort.
- Die Einrichtungsseite der Desktop-App und ihr Ordnerfenster nutzen die Farben der Web-App: Orange statt Grün für den
  Hauptbutton, derselbe Hintergrund, dieselbe Karte und dieselben Felder, sodass das Fenster nach der Anmeldung nicht
  mehr die Farbe wechselt.
- Die Kontenauswahl nach dem Abmelden bietet kein „Neues Konto anlegen“ mehr an: Ein neues Konto kommt aus dem
  Kontomenü oder den Einstellungen eines angemeldeten Admins.
- Ein Tipp auf einen Favoriten oben in der Liste öffnet den Chat, der auf dich wartet: einen mit offener Frage, sonst
  den neuesten fertigen Chat mit Ungelesenem, das kann auch eine der Unterhaltungen des Bots sein; ansonsten den
  Hauptchat.
- Das Sprachmodell für Sprachnachrichten bleibt geladen, solange „Modell geladen halten“ (früher „Modell beim
  Backend-Start laden“, standardmäßig an) in den Einstellungen des Rechners an ist: Es wird nicht mehr nach 30
  Minuten Leerlauf beendet, sodass eine Sprachnachricht nach einer Pause nicht mehr auf den Kaltstart von Whisper
  wartet. Ausgeschaltet lädt das Modell bei Bedarf und stoppt wie bisher nach 30 Minuten Leerlauf.
- Modelle heißen überall ohne Version: im Chatkopf, in der Liste, im Modellumschalter (auch nicht im Tooltip), in der
  Chatzeile nach einem Wechsel, bei den Wochenbalken des Abos pro Modell und bei Bild- und Sprachmodellen in den
  Einstellungen („Opus“ statt „Opus 5.5“, „GPT Sol (Codex)“ statt „GPT-6.1 Sol (Codex)“). Eine in den
  Bot-Einstellungen festgelegte Modell-ID, die wie der Chip einer Familie aussähe, trägt „(fest)“.
- Ein Link für eine Person, die auf ihrem eigenen Rechner eingerichtet wird: „Einladungslink erstellen“ in der Zeile
  eines Kontos mit gespeicherter Einrichtung erzeugt dessen Einrichtungslink, angezeigt mit „Link widerrufen“ wie eine
  Einladung; „Einrichtungslink erstellen“ und „Einrichtung löschen“ sind aus dem Dialog „Bearbeiten“ des Kontos
  verschwunden. Löschen und Entfernen stehen unten in diesem Dialog; er hat kein „Schließen“ und kein „Namen speichern“
  mehr, Namen und Passwörter werden gespeichert, sobald du ihr Feld verlässt. In der Kontenliste auf dem Handy rutschen
  die Buttons einer Zeile mit zwei Buttons unter ihren Text.
- Die Einladung einer Person in ein Konto gilt 7 Tage statt 15 Minuten und übersteht einen Neustart des Relays, sodass
  die Person zuerst eine App installieren kann. Sie funktioniert weiterhin nur einmal; eine neue Einladung ersetzt die
  letzte des Kontos, und das Löschen des Kontos beendet sie. Kopplungslinks für die eigenen weiteren Geräte bleiben bei
  15 Minuten.
- Ein Weg hinein: Die Anmeldung der Web-App und die Einrichtungsseite der Desktop-App sind dieselbe Karte. Beide
  beginnen mit dem Feld „Einladungslink“, das jeden zugeschickten Link annimmt (eine Einladung in ein Konto, einen
  Kopplungslink, einen Einrichtungslink, auf dem Desktop auch die Einladung eines Rechners) und sie unterscheidet;
  darunter folgen QR-Code und Passwort. Die Desktop-App ergänzt nur „Auf diesem Rechner starten“ für alle ohne
  Einladung; ihre Wege A bis C und das Glossar sind weg. In den Apps ist das Adressfeld der Anmeldung wieder die
  Server-URL.
- Ein Admin kann per QR-Code einladen: „QR-Code scannen“ in der Zeile eines Kontos, das hier nicht angemeldet ist,
  scannt den Code auf der Anmeldung dieser Person und schickt nach einer Bestätigung mit Gerät und Konto die Einladung
  des Kontos versiegelt an dieses Gerät. Der Code auf der Einrichtungsseite der Desktop-App der Person bekommt den
  Einrichtungslink des Kontos, sodass der Rechner ohne Link eingerichtet wird; ein Konto ohne gespeicherte Einrichtung
  sagt das. Kein neuer Frame.

### Behoben
- Ein neu deployter Backend-Container war fünf Minuten weg: Das Relay lehnte seine Anmeldung ab, solange der alte
  Container noch verbunden war, und er wartete fünf Minuten auf den nächsten Versuch. Direkt nach einem Start versucht
  er es jetzt alle 20 Sekunden erneut (bis zu neunmal); war er einmal drin, bedeutet eine Ablehnung weiterhin ein
  zweites Backend und die lange Wartezeit.
- Karten und Hinweise in der Chatliste (Anmeldung, Laden, erste Schritte) übernehmen nicht mehr das Raster einer
  Chatzeile, das ihren Text in die 48 px breite Bildspalte setzte; nur die Zeilen von Chats haben es jetzt.
- Handy: Die Karte „Bei einem KI-Anbieter anmelden“ oben in der Chatliste quetschte ihren Text in eine 48 px breite
  Spalte, ein Wort pro Zeile; sie hatte das Raster einer Chatzeile übernommen. Zu sehen, wenn nur ein Rechner ohne
  Anmeldung wach war.
- Die erste Sprachnachricht nach dem Aufwachen eines Rechners wurde oft nicht transkribiert: Das Laden von Whisper
  (Python, die CUDA-Bibliotheken, 1,6 GB Modell von einer kalten Platte) dauerte länger als die erlaubten drei
  Minuten, der Start wurde aufgegeben und nicht wiederholt. Es darf jetzt zehn Minuten dauern, und mit „Modell geladen
  halten“ wird ein fehlgeschlagener Start dreimal im Abstand von 90 Sekunden wiederholt, mit dem Grund im Log des
  Backends.
- „Diesen Chat in der IDE öffnen“ öffnet wieder die Sitzung des Chats statt einer leeren: Die Erweiterung von Claude
  Code lässt von einem Programm gestartete Sitzungen aus ihrer Liste weg und startet dann eine neue, deshalb markiert
  das Backend das Transkript als anzuzeigendes, bevor es die IDE öffnet.
- Ein langer Druck auf einen Link in einer Nachricht öffnet nicht mehr die Linkvorschau des Systems, die die Zielseite
  lud und die iOS-App und die Home-Bildschirm-App zum Absturz bringen konnte (etwa ein Link eines Kartenscanners); das
  ⋯-Menü der Nachricht hat stattdessen „Link kopieren“. Die iOS-App schaltet die Vorschau ebenfalls ab
  (`allowsLinkPreview: false`).
- Ein Einrichtungslink, der dort eingefügt wurde, wo eine Einladung hingehört („Hinzufügen“ unter Konten, das
  Adressfeld der Anmeldung, der Scanner), wurde auf die Adresse des Relays gekürzt und endete beim Passwortformular.
  Die Desktop-App übernimmt ihn jetzt und fragt, ob dieser Rechner eingerichtet werden soll, ein Browser zeigt die
  Seite des Links, und ein Handy sagt, dass der Link auf den Rechner gehört.
- Das Profilbild einer Person verschwindet nicht mehr, wenn ein Backend aus der Zeit vor den Profilbildern zuletzt
  antwortet: Die App behält das Bild, das irgendein Backend des Kontos kennt, und verwirft es erst, wenn keines es
  mehr kennt.

### Sicherheit
- „Status“ eines anderen Kontos als dem des Eigentümers listet nur die Rechner, die es bedienen (seinen eigenen
  Rechner, die Rechner des Relays, auf denen es läuft), nicht mehr alle des Eigentümers, und ein solches Konto kann
  nur diese wecken: Das Wecken eines anderen Rechners wird wie bei einem unbekannten beantwortet. Das Konto des
  Eigentümers sieht und weckt wie bisher jeden Rechner.

## [0.6.0] - 2026-11-15

### Neu
- „Bei Claude anmelden“ in den ersten Schritten meldet Claude Code ohne Terminal mit dem Abo an: Das Backend führt
  `claude auth login` aus, der Browser auf diesem Rechner zeigt die Anmeldung von Anthropic, und die CLI nimmt die
  Antwort selbst entgegen, sodass OpenFolk nie einen Code oder ein Token sieht. Ein zweiter Tipp beginnt von vorn (ein
  zu früh geschlossener Tab). Ein Backend ohne Desktop (eine Windows-Aufgabe in Sitzung 0, Linux ohne Display) öffnet
  wie bisher das Terminal. Die Antwort `claude_sign_in` trägt das neue optionale Feld `via: 'browser'`.
- „Bot duplizieren“ auf der Seite eines Bots und in seinem Menü: eine Kopie unter neuem Namen auf dem Rechner des Bots
  mit Profil, Modell, Freigabestufe, Ordner und Bild sowie Kopien seiner Routinen, pausiert, damit nichts doppelt
  läuft; Verlauf, Wissen, Unterhaltungen, Favorit, Stummschaltung und die dauerhaft erlaubten Werkzeuge bleiben beim
  Original. Neue Frames `bot_duplicate` und `bot_duplicated`; Bots aus der Einrichtung eines Admins lassen sich nicht
  kopieren.
- Weniger Schritte für Neue: Eine neue Installation, deren Rechner Claude Code schon angemeldet hat, startet mit
  eingeschaltetem Claude und überspringt die Wahl der KI-Anbieter (das Backend fragt die CLI beim ersten Start,
  höchstens 20 Sekunden lang). „Ohne Anmeldung ausprobieren“ in den ersten Schritten schaltet die kostenlosen Modelle
  von OpenCode ein, die weder Abo noch Schlüssel brauchen, und sagt, dass deren Anbieter mit den Daten trainieren
  dürfen; ein neuer Bot startet dann auf OpenCode, solange Claude nicht bereit ist.
- Ein Anthropic-API-Schlüssel wird geprüft, bevor er gespeichert wird (`GET /v1/models`, keine Tokens): Einen
  Schlüssel, den Anthropic nicht kennt (401) oder dem es den Zugriff verweigert (403), speichert der Rechner nicht und
  sagt, warum; ohne klare Antwort (kein Netz, 429, 5xx) wird er wie bisher gespeichert. Die ersten Schritte verlinken
  die Console-Seite für Schlüssel und sagen, wie der Schlüssel abgerechnet wird.
- Nachrichten weiterleiten: „Weiterleiten“ im ⋯-Menü einer Nachricht öffnet eine Seite mit den anderen Chats (mit
  Suche); der gewählte Chat öffnet sich mit der Nachricht über der Eingabe, wo du eigene Worte ergänzt oder sie so
  schickst, wie sie ist. Das Zitat trägt die neuen optionalen Felder `forwarded`, `origin` und `originChat` und behält
  bis zu 20.000 Zeichen (eine Antwort 300); der Bot liest den weitergeleiteten Text ganz, mit seinen Zeilenumbrüchen.
  In einen Personenchat geht er ohne Herkunft. Im Chat zeigt eine Weiterleitung vier Zeilen; ein Tipp öffnet den
  ganzen Text an Ort und Stelle (auch in der Leiste über der Eingabe), die Zeile „von …“ öffnet den Chat, aus dem sie
  kam.
- Das Handy bleibt still, während ein Desktop benutzt wird: Die Desktop-App und Browser auf einem breiten Bildschirm
  melden, ob sie sichtbar sind und in den letzten zwei Minuten Eingaben hatten (`presence` mit den neuen optionalen
  Feldern `desktop` und `active`, jetzt an jeden wachen Rechner geschickt). Solange bekommt das Handy keine Antworten,
  Routine-Ergebnisse oder Nachrichten von Personen, und Freigaben, Fragen und Übergaben erst nach drei Minuten, sofern
  sie bis dahin nicht beantwortet wurden oder der Chat geöffnet wurde; Rechner wach und Nutzungslimits bleiben
  unverändert. Ein sichtbarer Desktop ohne Eingaben hält das Handy nicht mehr still. „Auf diesem Gerät immer
  benachrichtigen“ in den Benachrichtigungseinstellungen eines Handys nimmt es davon aus; die Einstellung reist mit
  dem Abonnement (`push_subscribe` mit den neuen optionalen Feldern `form` und `always`) und wird zwischen den
  Rechnern synchronisiert.
- Routinen auf der Seite des Bots: je eine Zeile mit der Laufzeit in Worten („werktags 8:00“, „alle 2 Stunden“), dem
  nächsten Lauf und einem Schalter aktiv/pausiert; aufgeklappt die Anweisung, „Jetzt ausführen“, „Bearbeiten“, „Im
  Chat bearbeiten“ und die letzten 20 Läufe mit Start, Dauer, Status (ok, Fehler, läuft), dem Grund eines Fehlschlags
  und einem Sprung zur Antwort im Chat. Das Backend speichert die Läufe in der Routine (neues optionales `runs`, mit
  ihr an die anderen Rechner synchronisiert) und schickt den nächsten Fälligkeitszeitpunkt aus dem Cron-Ausdruck
  (neues optionales `nextRun`, nie gespeichert); das Ergebnis eines Durchgangs nennt die aufgezeichnete Antwort
  (optionales `entryId`). „Im Chat bearbeiten“ setzt „Ändere die Routine „…“: “ in das Eingabefeld, und der Bot ändert
  oder erstellt seine eigenen Routinen mit den neuen Werkzeugen `set_routine` und `list_routines` auf jeder Engine,
  mit einer Zeile im Chat; das Wecken des Rechners bleibt beim User.
- Befehlspalette und Tastenkürzel auf dem Desktop und im Browser: Strg+K (Cmd+K auf dem Mac) durchsucht Bots,
  Gruppen, Personen, Unterhaltungen, Routinen, die Abschnitte der Einstellungen und Aktionen (neuer Bot, neue Gruppe,
  Einstellungen, Status, Rechner wecken), dazu Nachrichten der letzten vier Wochen mit „Ältere Nachrichten suchen“ und
  angehängte Dateien nach Namen; ein Treffer öffnet den Chat an der Nachricht. Kürzel: Strg+N, Strg+Umschalt+N,
  Strg+F, Strg+1 bis 9, Alt+Hoch/Runter, Strg+[ und Strg+], Strg+I, Strg+Enter, Strg+B, Strg+, und Strg+/ für eine
  Übersicht. Die Desktop-App listet sie in einem neuen Menü „Gehe zu“. Der Frame `search` nimmt die neuen optionalen
  Felder `since` und `files` (in `search_result` zurückgegeben). Auf dem Handy bekommt die Suche über der Liste
  stattdessen Chips: Nachrichten, Bots, Dateien, Routinen.
- Diktieren als Einstellung des Geräts („Mikrofon: ins Eingabefeld diktieren statt eine Sprachnachricht zu senden“,
  standardmäßig aus): Während der Aufnahme bleiben Textfeld, Anhängen und Einfügen nutzbar, X verwirft (auch Escape im
  Feld), und ein Haken daneben holt den Text vom Rechner des Bots, der dort landet, wo der Cursor war; das Mikrofon
  diktiert weiter, und die Nachricht geht mit dem Senden-Button als Text hinaus, ohne die Aufnahme und ohne dass die
  Antwort vorgelesen wird. Neue Frames `transcribe` und `transcribed`; ein älteres Backend sagt, dass es dafür zu alt
  ist. Whisper bekommt beim Diktieren Name, Ordner und Repository des Bots (in einer Gruppe die ihrer Mitglieder) als
  `initial_prompt`; Sprachnachrichten bleiben, wie sie waren (#59).
- Die Statusseite nennt die Backend-Version jedes Rechners als Erstes in der Zeile darunter; ein Backend vor 0.2.1
  schickt keine und zeigt keine (#64).
- Desktop-App für Intel-Macs: Die CI baut sie auf einem Intel-Runner, signiert und notarisiert sie wie die für Apple
  Silicon und hängt `OpenFolk-X.Y.Z-x64.dmg` und `-mac.zip` an das Release. Eine einzige `latest-mac.yml` nennt die
  Dateien beider, sodass jeder Mac mit seinem eigenen Build aktualisiert. Beide READMEs beginnen mit einer
  Download-Tabelle, die das Paket jedes Systems über openfolk.app verlinkt und über die Versionen hinweg gleich bleibt.

### Geändert
- Eine neue Nachricht im Chat eines Bots schließt seine offenen Freigabe- und Fragekarten: Der Bot erfährt, dass
  nichts von dem passiert, wonach er gefragt hat, und dass er seinen Durchgang beenden soll; die Nachricht folgt als
  nächste Anweisung. Gruppen behalten ihre Karten, da die Nachricht einem anderen Mitglied gelten kann.
- Eine Freigabe, die innerhalb von 30 Minuten niemand beantwortet, bleibt als abgelaufene Karte ohne Buttons im Chat
  („nichts passiert“), statt zu verschwinden (`approval_done` mit dem neuen optionalen Feld `expired`).
- Die Suche über der Liste auf dem Handy durchsucht wie die Palette zuerst die Nachrichten der letzten vier Wochen,
  darunter „Ältere Nachrichten suchen“; Treffer erscheinen neueste zuerst, und die Antworten mehrerer Rechner addieren
  sich, statt dass die letzte die anderen ersetzt.
- Ein Admin wählt die Rechner, auf denen ein Konto läuft: im Formular für ein neues Konto und unter „Bearbeiten“ in
  seiner Zeile, „Alle meine Rechner, auch neue“ (wie bisher) oder einzeln. Ein nicht angehakter Rechner bedient das
  Konto nicht, und dessen Geräte sehen ihn nicht; er behält die Daten des Kontos und nimmt sie wieder auf, wenn er
  angehakt wird. Ein Konto mit Einrichtungslink ist keine eigene Art mehr: Sein erster Link hakt die Rechner des Relays
  ab, und der Admin kann einige davon wieder anhaken, neben dem eigenen Rechner der Person. Das Relay speichert die
  Wahl (`machines` in `RelayAccount`, neue optionale Felder in `account_create`, `account_update` und, für einen
  Admin, die Rechner des Relays in `accounts`) und teilt sie den Backends mit `account_added` und `account_released`
  mit; die Backends brauchen keine Änderung.
- Der Modellumschalter nennt die Claude-Modelle nur nach Familie (Fable, Opus, Sonnet, Haiku), ohne Version: Jeder
  Chip ist der Alias, der immer die neueste Version ausführt, die die CLI anbietet; die Version dahinter steht im
  Tooltip. Eine im Editor festgelegte Modell-ID behält ihre Version. Kopf und Chatliste zeigen weiterhin die Version,
  die läuft.
- „Rechner hinzufügen“ zeigt zuerst den Link für die Einrichtung der Desktop-App, wobei „Link kopieren“ nur den Link
  kopiert, und darunter den Befehl `npm run join` mit „Befehl kopieren“. Die Einrichtung der Desktop-App und
  `npm run join` nehmen auch den ganzen eingefügten Befehl an, Anführungszeichen inklusive (#61).
- Die Einstellungen eines Rechners listen seine erlaubten Ordner (geändert an diesem Rechner: im Tray der Desktop-App
  oder über `ALLOWED_ROOTS`) und nennen den Ordner darunter „Standardordner für neue Bots“, gewählt mit der
  Ordnerauswahl des Bot-Editors („Auswählen …“) oder wie bisher eingetippt (#62).
- Die Seite „Neuer Bot“ fragt nur nach Rolle, Name, Ordner und Repository, die Rolle zuerst; die Vorlagen stehen als
  Chips unter der Rolle (ein Tipp übernimmt die Rolle und, unsichtbar, die Arbeitsanweisungen und die Freigabestufe
  der Vorlage, die wieder wegfallen, wenn die Rolle überschrieben wird), drei Vornamen mit demselben Anfangsbuchstaben
  wie die Rolle kommen ohne das Modell („Weitere“ für drei mehr), der Rechner erscheint nur, wenn es eine Wahl gibt,
  und der Button heißt „Erstellen“. Alles andere (Bild, Arbeitsbereich, Modell, Freigabestufe, Ton, Stimme,
  Listenordner, wem er schreiben darf) wartet in den Einstellungen des Bots, und der Bot fragt in seinem Chat, was noch
  offen ist. Die Vorlagenauswahl, „Im Chat einrichten“ und „keine Vorlage“ sind weg.
- Der Windows-Installer installiert mit einem Klick: Er fragt einmal nach Administratorrechten, installiert wie bisher
  für alle Benutzer nach `C:\Program Files\OpenFolk` und startet die App, ohne die Seiten für Sprache, Ordner und
  Abschluss. Ein Update behält den Ordner, in den eine frühere Version installiert wurde.

### Behoben
- Ein anderes Konto als das Hauptkonto sieht, solange keiner seiner Rechner wach ist (etwa direkt nach einer
  Einladung), nicht mehr die ersten Schritte einer neuen Installation mit „npm start“, sondern einen Hinweis, dass
  noch kein Rechner erreichbar ist und seine Bots und Personen erscheinen, sobald einer läuft.
- Bot-Editor, „Neuer Bot“, der Modellumschalter und das Modell im Chatkopf übernehmen die Engines und Modelle des
  Rechners des Bots (im Editor: des dort gewählten Rechners). Die `models` jedes Backends ersetzten die Liste jedes
  anderen, sodass bei zwei Rechnern Cursor des einen für dessen Bots fehlen konnte (#63).
- iPhone, Home-Bildschirm-App: iOS 27 machte den oberen Rand der Seite samt Kopf unscharf. Ein fester Streifen in der
  Farbe des Kopfs liegt jetzt ganz oben, was iOS dazu bringt, die Unschärfe wegzulassen und die Statusleiste wie den
  Kopf einzufärben; der Stil der Statusleiste ist `default` statt des veralteten `black-translucent`, sodass die Seite
  unter der Statusleiste beginnt. Die App muss vom Home-Bildschirm entfernt und neu hinzugefügt werden (#65).
- Desktop-App: Das Tray-Menü ist direkt nach der ersten Einrichtung vollständig („Erlaubte Ordner …“, „Dieses Fenster
  neu anmelden“, „Verbindung zu … trennen“, „Ohne Anmeldung ausführen“); es wurde einmal beim Start aufgebaut und war
  erst nach einem Neustart vollständig (#60).

### Sicherheit
- Die Web-App zeigt ein Profilbild nur aus einer Data-URL eines Bildes oder einer Object-URL; alles andere in
  `avatar` zeigt die Initialen (CodeQL js/xss, js/client-side-unvalidated-url-redirection).
- hono 4.13.18 und @hono/node-server 2.1.8, die der MCP-Server des Agent SDK mitbringt (CSRF, Umgehungen von
  Middleware mit `mount()` und dem RegExpRouter, `validator('form')`, ein Backslash im Pfad, ein Absturz bei
  `ECONNRESET` während eines WebSocket-Upgrades).

## [0.5.0] - 2026-11-10

### Neu
- Eine Person mit einem Link auf ihrem eigenen Rechner einrichten: Ein Admin wählt unter Einstellungen → Konten →
  „Einrichten“ die Bots eines Kontos (jeder mit einem Repository, einem eigenen Token und seiner Freigabestufe), wem
  die Person schreiben kann und an wen die Bots übergeben, und erzeugt einen Einrichtungslink (7 Tage, einmalig,
  widerrufbar). Die Person installiert die Desktop-App, meldet sich bei Claude an und öffnet den Link („In OpenFolk
  öffnen“, die App registriert `openfolk://`); die App tritt dem Relay als Rechner bei, der an dieses Konto gebunden ist
  (`/setup-invite`, `/setup`), klont jedes Repository mit seinem Token hinter einem Credential-Helper und legt die Bots
  an, die die Person weder ändern noch löschen kann (`Bot.managed`). Ein gebundener Rechner bedient nur sein Konto,
  und das Konto läuft nur auf solchen Rechnern; Personenchats und die Einrichtung wandern über die neue
  Personenroute des Relays zwischen den Rechnern (`person` mit der `id` des Absenders, `person_result`), werden in
  einem Postausgang gehalten, bis sie zugestellt sind, und vom Empfänger nur einmal übernommen (`person-seen.json`),
  egal wie oft sie erneut geschickt werden. Das Konto besitzt den Rechner (eigene Claude-Anmeldung, eigene
  Einstellungen). „Verbindung zu … trennen“ im Menü der Desktop-App ist der Weg zurück. Neue Frames `setups`,
  `setup_save`, `setup_delete`, `setup_link`; neue Peer-Daten `person_message`, `setup`, `setup_request`.
- Freigabestufe „nur lesen“ (`read`): ein Bot, der liest und antwortet und dem Schreiben, Befehle und fremde Dienste
  ohne Karte verweigert werden. Ein Support-Bot einer Einrichtung holt seinen Klon und spult ihn vor, bevor er
  antwortet, höchstens alle fünf Minuten.
- Reichweite „ausgewählte Kontakte“ (`listed`, mit `contacts` in `account_update`): Ein Konto erreicht genau die
  Konten, die es nennt.
- Ein neuer Bot richtet sich in seinem Chat selbst ein: Die Vorlage „Im Chat einrichten“ (Standard) braucht nur einen
  Namen und einen Ordner; nach dem Speichern sieht sich der Bot den Ordner an, stellt ein paar Fragen mit Optionen und
  füllt Arbeitsbereich, Rolle und Arbeitsanweisungen mit dem neuen Werkzeug `set_profile` selbst aus (auch für spätere
  Wünsche des Users), mit einer Zeile im Chat und allem editierbar in seinen Einstellungen (optionales `setup` in
  `bot_save`). Zuletzt bietet er ein Profilbild an: `make_avatar` führt den Generator des Editors für den Bot selbst aus
  (ein Foto mit 512 Pixeln mit dem Schlüssel des Bildmodells, ab Nano Banana 2; sonst das gezeichnete SVG, so wie es
  ist), mit einem Wunsch für das Bild (`wish` im Vorschlag). Jeder neue Bot macht das, auch einer aus einer anderen
  Vorlage (er überspringt, was die Vorlage gesetzt hat), und sein Chat öffnet sich direkt nach dem Speichern.
- Aufträge zwischen Bots kommen von selbst zurück: `message_bot` kehrt sofort zurück, und das Ergebnis trifft in der
  Unterhaltung, die den Auftrag gegeben hat, als neue Nachricht ein, mit der der Bot dort weitermacht, mit einer
  Benachrichtigung, egal wie lange der Auftrag dauert; `wait_for_reply=true` wartet weiterhin bis zu 20 Minuten. Eine
  Leiste über der Eingabe nennt, auf wen der Chat seit wann wartet, öffnet diesen Chat und beendet das Warten oder
  bricht den Auftrag ab. Offene Aufträge überstehen einen Neustart, ein Auftrag an einen schlafenden Rechner geht
  hinaus, sobald er aufwacht, und ein Ergebnis für einen schlafenden Rechner wartet beim Ziel, bis es bestätigt ist
  (neue Peer-Daten `job_feedback`, `job_ack`, `job_cancel`; das `job_done` eines älteren Ziels zählt ebenfalls).
  `list_conversations` und `conversation` von `message_bot` geben einer bestimmten Unterhaltung einen Auftrag, auch
  einer anderen desselben Bots; Schleifen werden an den Chats entlang der Kette erkannt (#43).
- „Rechner-Sitzungen“ im „+“-Menü (VS Code und Terminal): die Sitzungen aller Ordner auf jedem wachen Rechner, neueste
  zuerst, zum Lesen, live Mitverfolgen und Fortsetzen mit dem Bot, in dessen Ordner sie liegen. Die Liste auf der Seite
  eines Bots bleibt bei seinem Ordner. `vscode_sessions` und `vscode_open` funktionieren dafür ohne `botId`; ein
  älteres Backend antwortet mit einem Fehler, den die Liste für diesen Rechner anzeigt.
- Codex-Sitzungen aus seiner VS-Code-Erweiterung und CLI in beiden Listen, markiert mit „Codex“: lesen und live
  mitverfolgen und eine als Abzweig in einer Unterhaltung auf Codex fortsetzen (der App-Server listet, liest und forkt
  sie; optionales `engine` in `vscode_open`, `vscode_adopt` und den Listeneinträgen).
- „Offene Änderungen“ sagt, seit wann ein Repo etwas offen hat: die neueste Änderung seiner Dateien, bei einem mit nur
  ungepushten Commits der letzte Commit (`since` in `GitRepo`, optional; ältere Backends schicken keines) (#46).
- Ein Klon, den Git mangels Zugangsdaten verweigert (ein privates Repository), sagt, wohin das Git-Token gehört, mit
  einem Button zu den Einstellungen des Rechners des Bots bei „Pushen mit Git“ (`credentials` in `folder_cloned`)
  (#38).
- Beim Löschen eines Bots kann auch sein Arbeitsordner gelöscht werden: Der Löschdialog fragt zuerst den Rechner des
  Bots und bietet „Auch den Arbeitsordner löschen“ an, wenn kein anderer Bot irgendeines Kontos dort darin, darunter
  oder darum herum arbeitet, er selbst kein erlaubter Ordner und kein Ordner für Bots ist und keine Arbeit enthält, die
  nicht auf einem Git-Server liegt; sonst bleibt das Kästchen mit Begründung aus (`folder_delete_check`, `deleteFolder`
  in `bot_delete`; ein älteres Backend behält den Ordner) (#36).
- `set_avatar`: Auf Wunsch setzt ein Bot sein eigenes Profilbild aus einer PNG-, JPEG-, WebP- oder GIF-Datei seines
  Ordners (bis 300 KB, an den Bytes erkannt, kein SVG); sein Chat sagt das (#44).
- Screenshots und ein kurzes Demo-GIF in beiden READMEs, aus Demodaten erzeugt mit `npm run screenshots` (#12).
- Desktop-App unter Linux: „Ohne Anmeldung ausführen“ startet das Backend als systemd-User-Dienst `openfolk-backend`
  mit Lingering, sodass sich ein geweckter Rechner ohne Anmeldung meldet (das .deb-Paket; das AppImage kann das
  nicht). `docs/running.md` zeigt denselben Dienst für einen Checkout und warum ein Mac eine Anmeldung braucht (#11).
- Ein Weck-Agent für ein Relay auf einem Server: `WAKE_METHOD=agent` mit `WAKE_AGENT_TOKEN` und
  `wake-agent/wake-agent.mjs` auf einem kleinen Gerät im Heimnetz (ein Raspberry Pi, ein NAS), das sich selbst mit dem
  Relay verbindet und dort das Wake-on-LAN-Paket sendet, ohne dass am Router ein Port geöffnet wird. Es bekommt immer
  nur „wake <MAC>“ für die Rechner in `WAKE_MACHINES`; eine Datei, Node 22, keine npm-Pakete, Einrichtung in
  `wake-agent/README.md`. Die Compose-Dateien reichen die Weck-Einstellungen an das Relay durch (#45).

### Geändert
- Die Einstellungsseite ohne ihre Erklärtexte unter den Feldern; Hinweise zu einem Zustand bleiben (alle Rechner
  schlafen, kein Anbieter eingeschaltet, kein Herunterfahren in dieser Einrichtung, die Home-Bildschirm-App des
  iPhones). „Über“ ohne das Emoji, und seine Versionshinweise nutzen die Breite eines breiten Bildschirms.
- Das Abmelden führt zu einer Auswahl der Konten auf diesem Gerät: Ein Tipp meldet ohne Passwort wieder an, „Mit einem
  anderen Konto anmelden“ öffnet das Formular. Ein Konto, das 30 Tage nicht das aktive war, verliert seinen Schlüssel
  auf dem Gerät und fragt wieder nach seinem Passwort; das „⋮“-Menü einer Zeile vergisst das Konto. „Abmelden“ steht
  ganz unten in den Einstellungen, unter dem angemeldeten Konto. Das Kontomenü der Seitenleiste erscheint jetzt auf
  jedem Relay mit Konten; ein Admin legt ein neues Konto aus diesem Menü oder der Auswahl an, und das Gerät ist sofort
  dort angemeldet.
- Die Kontenliste sieht aus wie die Geräteliste, mit höchstens zwei Buttons rechts: „Wechseln“ oder
  „Einladungslink erstellen“ und „Einrichten“. „Einrichten“ enthält das Konto selbst (seinen Namen, jetzt von einem
  Admin änderbar, Adminrechte, „Nur Admins“, Löschen) und, bei einem Konto ohne Adminrechte, seine Bots auf dem
  eigenen Rechner der Person, jeder zugeklappt zu einer Zeile mit Repository und Stufe. „Ein Konto oder Relay
  hinzufügen“ fragt zuerst nach dem Namen der neuen Person, und das Anlegen eines Kontos öffnet nicht mehr sofort
  dessen Einladung. Dialoge nutzen mehr von einem breiten Bildschirm.
- Desktop-App: Strg und + oder - zoomt mit jedem Tastaturlayout (die +-Taste einer deutschen Tastatur tat nichts),
  auf dem Ziffernblock und mit Strg und Mausrad; Strg+0 setzt zurück. Die Stufe bleibt über Starts und Seiten hinweg.
- Das Verschieben eines Bots auf einen anderen Rechner fragt nichts mehr: Ein Tipp auf den Rechner verschiebt ihn, ein
  schlafender Rechner wird dafür geweckt, und Arbeit, die noch nicht auf dem Git-Server liegt, kommt von selbst mit
  (auf dem bisherigen Rechner mit git stash beiseitegelegt); der Toast sagt, was passiert ist. Die App schickt
  `bot_move` nicht mehr mit `dryRun`.

### Behoben
- Das Löschen eines Kontos konnte das Backend eines Rechners beenden, der es bediente: Noch unterwegs befindlicher
  Verkehr des Kontos (seine sich schließenden Browser) ließ das Backend es erneut bedienen, obwohl seine Daten weg
  waren. Solcher Verkehr findet jetzt niemanden mehr.
- Ein Testlauf der Desktop-App (`scripts/desktop-smoke.mjs`) registriert sich nicht mehr anstelle der installierten
  App für `openfolk://`-Links.
- Beim Öffnen der Web-App blieb manchmal nur eine leere Seite mit einem nackten Suchfeld: Wenn eines ihrer Module
  nicht lud (eine Netzlücke beim Aufwachen des Handys, das Relay startete während eines Deployments neu), startete
  nichts. `boot.js` lädt die Seite jetzt neu, bis zu dreimal innerhalb von zwei Minuten, und sagt es dann mit einem
  Button „Neu laden“.
- Desktop-App: Der Dialog „Update bereit“ öffnet sich einmal pro Version; die sechsstündlichen Prüfungen und „Nach
  Updates suchen“ stapeln sich nicht mehr übereinander (#58).
- Desktop-App unter Windows: Der Dialog „Update bereit“ sagt, dass die Installation nach Administratorrechten fragt,
  auch wenn sie beim Beenden läuft (#58).
- Desktop-App: Ein fehlgeschlagenes „Nach Updates suchen“ sagt in zwei kurzen Zeilen, warum jede Quelle scheiterte
  (openfolk.app und GitHub), statt der ganzen Meldung von electron-updater mit Antwort-Headern und dem Feed (#57, #58).

### Sicherheit
- Die Desktop-Apps werden mit minimatch 11 gebaut, wo electron-builder 9.x und 10.x mitbrachte (GHSA-g3hv-75wg-m249,
  ein Denial of Service durch ein präpariertes Muster); es lief immer nur beim Bauen, nicht in der App.

## [0.4.0] - 2026-11-08

### Neu
- Ordner in der Chatliste: „+“ → „Neuer Ordner“; ein Bot oder eine Gruppe kommt über ihr Menü („Ordner“) oder ihre
  Einstellungen hinein. Ein Tipp auf die Überschrift klappt den Ordner zu, ein langer Druck benennt ihn um oder löscht
  ihn. Laufende Bots und ungelesene Antworten stehen derweil oben; Ordner werden wie Bots zwischen den Rechnern
  synchronisiert.
- Ein Satz von 24 fertigen Profilbildern: „KI-Avatar“ im Bot-Editor öffnet ihn zuerst, das Bildmodell ist der letzte
  Eintrag. Gezeichnet von `npm run avatar-set` nach `webapp/avatars/`.
- `FIRST_DEVICE_CODE` für ein Backend in einem Container: Der Code für das erste Gerät des Hauptkontos lässt sich
  vorab setzen und an jemanden weitergeben, der nur mit einem Handy anfängt. Er bleibt aus dem Log; die ersten
  Schritte in einem Container beginnen jetzt mit dem API-Schlüssel und den Gerätecodes, die keinen Computer brauchen.
- Eine Leiste über Codeblöcken in Antworten mit der Sprache, „Kopieren“ und Zeilenumbruch (#55, von @SvenvanB).
- Ein Zahnrad im Chatkopf öffnet die Seite des Bots oder den Editor der Gruppe, wie ein Tipp auf den Titel (#50, von
  @SvenvanB).
- Bots ohne Projektordner: Bleiben Ordner und Repository leer, bekommt der Bot einen nach ihm benannten Ordner im
  Ordner für Bots seines Rechners (#37). Die Ordnerauswahl legt einen neuen Ordner unter dem angezeigten an (#35).
  Beides läuft über den neuen Frame `folder_create`; ein älteres Backend sagt, dass ein Ordner einzutragen ist.
- Das Backend-Image mit Sprachnachrichten: jedes Tag von `ghcr.io/openfolk/openfolk-local` auch als `-voice`, mit
  Python und faster-whisper auf der CPU (`local/Dockerfile.voice`, #41).
- `docs/running.md` sagt, in welcher Reihenfolge Relay, Backends und Apps zu aktualisieren sind und wie sich ein
  Desktop-Fenster im Modus „Relay-Adresse“ nach dem Umzug auf `openfolk://app` neu anmeldet (#40).
- Sprachunterhaltung: Der Button neben dem Mikrofon öffnet eine Seite, auf der du freihändig mit einem Bot sprichst.
  Die Aufnahme geht nach einer Pause hinaus, die Antwort wird vorgelesen (was der Bot vor einem Werkzeug sagt, sofort)
  und das Mikrofon öffnet sich wieder; ein Tipp auf das Bild schickt sofort ab oder stoppt die Stimme. Der Bot wird
  gebeten, kurz zu antworten.
- Mit „OpenAI Realtime“ in den Einstellungen und einem OpenAI-Schlüssel läuft die Sprachunterhaltung über
  `gpt-realtime-2.1` (oder mini) wie bei ChatGPT: Unterbrechen funktioniert, OpenAI spricht die Antwort des Bots. Das
  Backend öffnet die Verbindung mit dem gespeicherten Schlüssel; dafür braucht es Backends dieser Version.
- Vorlesen auf dem Rechner des Bots: „Der Rechner des Bots“ als Stimme in den Einstellungen liest mit Piper vor,
  kostenlos und offline, eine männliche und eine weibliche Stimme pro Sprache; „Automatisch“ nimmt sie, wenn kein
  Schlüssel gespeichert ist. Dafür müssen Sprachnachrichten auf dem Rechner eingerichtet sein, deren Einrichtung jetzt
  `piper-tts` installiert und die Stimmen lädt; eine eigene Umgebung braucht `pip install piper-tts`, was die Zeile des
  Rechners in den Einstellungen sagt.
- Eine eigene Stimme pro Bot: Der Editor listet die Stimmen des Anbieters, der gerade vorliest (OpenAIs 13, Geminis
  30, Pipers pro Sprache), mit „Anhören“ für eine Probe; sie wird pro Anbieter gespeichert, ein anderer Anbieter liest
  mit der Art (männlich oder weiblich). Die Sprachunterhaltung über OpenAI Realtime übernimmt sie ebenfalls, wo die
  Realtime-Modelle sie haben.
- Das Vorlesen mit der Stimme des Geräts wählt anhand der Namen der Systemstimmen eine der Art des Bots (männlich oder
  weiblich); ohne eine solche liest eine andere mit veränderter Tonhöhe, und ein Hinweis sagt, wie man eine lädt.

### Geändert
- Der Code für ein erstes Gerät funktioniert nur einmal: Nachdem ein Gerät des Hauptkontos mit dem Backend gesprochen
  hat, öffnet er nichts mehr, auch solange kein Gerät am Relay angemeldet ist.
- Fragen und Hinweise sind HTML-Dialoge der App statt `confirm()` und `alert()` des Browsers (#48, von @SvenvanB).
- Das Löschen eines Bots oder einer Gruppe fragt in einer „Gefahrenzone“, die auflistet, was geht und was bleibt,
  nach dessen Namen (#49, von @SvenvanB).
- Von der Seite des Bots aus öffnet sich der Editor im Seitenbereich anstelle der Seite, die nach dem Speichern neu
  gezeichnet wird (#56, von @SvenvanB).
- Antworten eines Bots füllen die Breite ihrer Spalte (#54, von @SvenvanB).
- Der Schalter fürs Vorlesen von Antworten steht neben der Stimme, zu der er gehört (#53, von @SvenvanB).
- Anmeldung und Kopplung benennen ihre Geheimnisse getrennt: Relay-Passwort, Schlüssel und Kopplungslink (#52, von
  @SvenvanB).

### Behoben
- Der Dialog „Schlüssel nötig“ nimmt den ganzen Kopplungslink an, wie sein Text sagt, nicht nur den Schlüssel (#47
  von @SvenvanB, behebt #42).
- Der obere Teil der Anmeldeseite bleibt in einem niedrigen Fenster erreichbar (#51, von @SvenvanB).

## [0.3.0] - 2026-11-06

### Neu
- Chats mit Personen: „+“ → „Person“ schreibt an ein anderes Konto auf demselben Relay, ein Teammitglied oder einen
  Kunden, mit Dateien, Sprachnachrichten, Benachrichtigungen, Ungelesen, Favorit, Stummschaltung und Suche. Jede Seite
  behält ihre eigene Kopie. Personenchats und Kundenkonten brauchen das Relay dieser Version; aktualisiere es
  zusammen mit den Apps.
- Kundenkonten: „Kunde: chattet nur mit den Admins“ beim Anlegen eines Kontos, oder „Nur Admins“ und „Erreicht alle“
  in der Liste, sodass ein Kunde sein Team erreicht und keinen anderen Kunden.
- Übergabe von einem Bot an eine Person: „Übergeben an“ in den Einstellungen des Bots gibt ihm das Werkzeug
  `hand_over`; die Person bekommt die Zusammenfassung des Bots und eine Benachrichtigung, der User einen Button
  „Weiter mit …“ im Chat des Bots.
- Push-Arten „Nachricht von einer Person“ und „Ein Bot übergibt dir einen Chat“.
- Slash-Befehle: „/“ am Anfang einer Nachricht im Chat eines Bots listet die Befehle von Claude Code für seinen Ordner
  (deine eigenen, die des Projekts, die von Plugins, ein paar eingebaute). Eine Nachricht, die mit `/name` beginnt,
  erreicht den Bot ohne vorangestelltes Zitat, Delegation oder Gruppenhinweis, sodass Claude Code sie ausführt, auch
  in Gruppen und Routinen.
- Desktop-App: „Diesen Rechner auch mit meinem Relay-Server verbinden“ funktioniert auch per QR-Code. Die
  Einrichtungsseite zeigt einen Code für die Adresse des Relays, ein angemeldetes Handy scannt ihn und bestätigt, und
  der Rechner tritt bei, ohne einen Link zu kopieren.
- Das Verschieben eines Bots auf einen anderen Rechner braucht keinen Ordner und kein Repository mehr: ein Tipp auf
  den Rechner und eine Bestätigung. Jeder Rechner hat in seinen Einstellungen einen „Ordner für Bots“, der Rechner
  eines Bots merkt sich, wo der Bot darunter liegt, und sein Repository, und der neue Rechner legt den Bot an
  dieselbe Stelle unter seinem eigenen Ordner für Bots, klont das Repository oder legt den Ordner an. Der Dialog mit
  beiden Feldern bleibt für den Fall, dass die Stelle dort belegt ist. Die Klone des Bot-Editors landen ebenfalls im
  Ordner für Bots.

### Behoben
- VS-Code-Sitzungen eines Bots, dessen Ordner hinter einer Junction oder einem Symlink liegt oder einen sehr langen
  Pfad hat, werden wieder gelistet und verfolgt: OpenFolk benennt den Transkriptordner so wie Claude Code (aufgelöster
  Pfad, bei 200 Zeichen gekürzt plus ein Hash, `CLAUDE_CODE_PROJECT_DIR_NAME`).

### Sicherheit
- Umzug auf ein eigenes Relay: Die Seite folgt dem Link vom Backend nur, wenn er zu dem Relay führt, das im Formular
  eingegeben wurde (http oder https), nie woandershin.

## [0.2.1] - 2026-11-04

### Neu
- Desktop-App: „Erlaubte Ordner …“ im Tray- und App-Menü wählt die Ordner, in denen Bots arbeiten dürfen
  (`ALLOWED_ROOTS` in der `.env` des Profils), auch auf der Einrichtungsseite für „auf diesem Rechner starten“; das
  Speichern startet das Backend neu, sobald kein Bot arbeitet. Eine neue Installation ohne Wahl bekommt einen eigenen
  Ordner (`<Benutzerordner>/OpenFolk`) statt des ganzen Benutzerordners; eine Installation, die schon lief, behält den
  Benutzerordner, schriftlich festgehalten, und das Fenster warnt, dass er weit gefasst ist (von @SvenvanB).
- Ein Bot, dessen Ordner abgelehnt wird, nennt den Ordner und die erlaubten getrennt und sagt, wie man mehr erlaubt,
  in der Desktop-App mit ihrem Menü (von @SvenvanB).
- „Über“ am Ende der Einstellungen nennt in jeder App (Browser, Desktop, Handy) die Version von OpenFolk; ein Klick
  zeigt, was darin neu ist, die früheren Versionen eingeklappt darunter. Darunter die Version der Desktop-App, die
  Protokollversion der Web-App und, pro verbundenem Backend, dessen Protokollversion und Start (von @SvenvanB).
- Die Version steht neben dem Namen oben in der Seitenleiste; ein Klick zeigt, was darin neu ist.
- Nach dem Umzug auf ein Relay auf einem Server sagt die App einmal „Umgezogen nach <relay>“, wenn sie dort angemeldet
  ist (von @SvenvanB).
- `docs/running.md` erklärt, welche Schritte die Desktop-App ohne die `npm run …`-Befehle eines Checkouts erledigt,
  die erlaubten Ordner eines Rechners (`ALLOWED_ROOTS`) und wie Git pusht, ohne dass jemand eine Abfrage beantwortet
  (ein Token in den Rechner-Einstellungen, SSH-Schlüssel aus einem Agent oder dem macOS-Schlüsselbund); die deutsche
  README hat eine Anleitung in fünf Schritten für ein eigenes Relay. Beide READMEs sagen, in welcher Reihenfolge man
  eine Person in ein neues Konto einlädt, dass der Kontoname in der Seitenleiste das aktive Konto ist und dass
  OpenFolk die IDE begleitet, nicht ersetzt.
- Desktop-App: „Automatisch nach Updates suchen“ direkt unter „Nach Updates suchen“ schaltet die automatischen
  Prüfungen und Downloads ohne Neustart aus und ein; eine Prüfung aus dem Menü funktioniert in beiden Fällen (von
  @SvenvanB).
- Die Farbe deiner eigenen Nachrichten lässt sich unter „Darstellung“ aus acht wählen, pro Gerät; Grün bleibt der
  Standard (von @SvenvanB).
- Auf einem iPhone oder iPad in einem Safari-Tab sagen die Einstellungen, dass nur die Home-Bildschirm-App
  Benachrichtigungen bekommt und dass das Gerät dort neu gekoppelt werden muss (von @SvenvanB).
- Die Statuszeilen sagen, ob die Verbindung lokal ist oder über welches Relay sie läuft (von @SvenvanB).
- Ein Stift im Kopf der Seite eines Bots öffnet seinen Editor (von @SvenvanB).

### Geändert
- Eine zweite Backend-Anmeldung unter einem verbundenen Namen von derselben Adresse ist ein Neustart (ein Container,
  der neu deployt wird, das zweimal gestartete Backend): weiterhin abgelehnt, aber nicht mehr als Sicherheitshinweis
  gepusht; der Hinweis für eine andere Adresse nennt die Adresse als Grund.
- Die Einrichtungsseite des Desktops beschriftet ihre drei Wege mit A bis C (auf diesem Rechner starten, diesen
  Rechner auch mit meinem Relay-Server verbinden, nur anzeigen), erklärt Bot, Backend und Relay-Server und fragt vor
  „nur anzeigen“ nach, weil die App dann keine Bots auf diesem Rechner ausführt (von @SvenvanB).
- Die Desktop-Apps laufen auf Electron 44.10.2 (vorher 44.7.0).
- Der Kopf der Seite eines Bots bleibt sichtbar, während die Seite scrollt (von @SvenvanB).
- „Neue Unterhaltung“ sagt, wofür sie da ist: eine frische Sitzung desselben Bots ohne den Verlauf der anderen Chats,
  im „+“-Menü, in ihrem Tooltip und in der leeren Unterhaltung (von @SvenvanB).
- Der Bot-Editor markiert seine Pflichtfelder: Name und einen Ordner oder ein Repository (von @SvenvanB).
- Der Kontoname neben dem Titel in der Seitenleiste sagt in seinem Tooltip, dass er das aktive Konto ist, und wechselt
  auf Tipp; die Liste eines Geräts mit mehreren Konten war ohne ihn schwer zu lesen.
- „Sprachnachrichten einrichten“ lädt das Sprachmodell als eigenen Schritt, mit seiner Größe, sodass die erste
  Sprachnachricht nicht mehr auf einen Download von bis zu 1,6 GB wartet; es installiert die CUDA-Bibliotheken auch,
  wo `nvidia-smi` nicht im PATH liegt, und ein Python des Rechners, das faster-whisper schon hat, wird so genutzt, wie
  es ist.
- Das Log eines Containers nennt den Code für ein erstes Gerät nur, bis sich ein Gerät des Hauptkontos verbunden hat,
  und eine Engine, die bloß nicht angemeldet ist (Copilot auf einem Rechner, der es nicht nutzt), schreibt nicht mehr
  bei jedem Start eine Zeile ins Log.
- „Über“ in den Einstellungen nennt die Version von OpenFolk, die jedes verbundene Backend ausführt (`version` in
  `backend_status`, optional; ältere Backends zeigen wie bisher ihre Protokollversion).
- Ein abgelehnter Bot-Ordner kommt mit dem Ordner und den erlaubten als Felder der Antwort (`refused` in
  `folder_checked` und `folder_cloned`), sodass die App sie nicht mehr aus einer englischen oder deutschen Meldung
  herauslesen muss.

### Behoben
- Desktop-App: Das Schließen von „Einrichtung ändern“ ohne Wahl brachte beim nächsten Klick auf das Tray- oder
  Dock-Symbol die Einrichtungsseite statt des Chats zurück (von @SvenvanB).
- Desktop-App: Nach dem Update auf 0.2.0 zeigte das Fenster die Anmeldeseite statt des Chats, weil der Speicher der
  Web-App mit ihrer neuen Adresse umgezogen war; „auf diesem Rechner“ bemerkt jetzt die fehlende Anmeldung und koppelt
  das Fenster neu. Ein Relay vor 0.2.0 lehnt die neue Adresse der App ganz ab: Mit einem solchen Relay zeigt das
  Fenster wie bisher die Web-App, die das Relay ausliefert, angemeldet wie bisher, bis das Relay aktualisiert ist.
  „Dieses Fenster neu anmelden“ tat nichts, solange das Fenster die App zeigte.
- Claude Code, angemeldet mit `CLAUDE_CODE_OAUTH_TOKEN` (aus `claude setup-token`), gilt als angemeldet; die ersten
  Schritte fragten nach einer Anmeldung.
- Eine Sprachnachricht auf einem Rechner ohne eingerichtete Sprachnachrichten sagt das sofort, statt nach drei
  Minuten mit „Whisper startet nicht“ zu enden; ein noch herunterzuladendes Sprachmodell bekommt eine halbe Stunde,
  und wenn die CUDA-Bibliotheken fehlen, läuft „automatisch“ auf der CPU, statt zu scheitern.
- Der Git-Host unter „Pushen mit Git“ nimmt eine Adresse (`https://git.example.com/…`) an und behält ihren Hostnamen;
  sie wurde mit „Invalid string“ abgelehnt. Geänderte Git-Zugangsdaten erreichen die laufenden Sitzungen der Bots bei
  ihrem nächsten Durchgang statt erst nach einem Neustart des Backends.
- Das Speichern eines Bots mit einem Repository und einem Ordner, der existiert, aber keinen Klon davon enthält (leer
  nach einem fehlgeschlagenen Klon), klont in den Ordner oder sagt, warum es nicht geht, statt den Bot ohne sein
  Repository zu speichern.
- Ein falscher `E2E_KEY` nennt das erwartete Format und das, was er bekommen hat; eine Byte-Order-Mark,
  Anführungszeichen oder unsichtbare Zeichen um einen kopierten Schlüssel zählen nicht mehr mit.
- Die Log-Zeile über eine fehlende Claude-Anmeldung eines anderen Kontos nennt das Konto und seinen Befehl.

## [0.2.0] - 2026-11-04

### Neu
- `docker-compose.coolify.yml` betreibt Relay und Backend in Coolify aus den fertigen Images, ohne Host-Port und mit
  einem Einrichtungscode, den Coolify erzeugt; `docker-compose.server.yml` baute dort beide Images auf dem Server.
- „Immer für diesen Bot“ auf der Freigabekarte eines externen MCP-Werkzeugs: Das Werkzeug fragt für diesen Bot nicht
  mehr nach, auf jedem Rechner. Der Bot-Editor listet diese Werkzeuge; entfernst du den Haken bei einem, fragt es
  wieder.
- In den Desktop-Apps lässt sich der rechte Rand der Chatliste ziehen, um ihre Breite zu ändern (260 bis 640 px); die
  Breite bleibt gespeichert, ein Doppelklick stellt sie zurück.

### Geändert
- Das Stummschalten eines Bots oder einer Gruppe ist aus den Push-Einstellungen auf seine Seite und ins Menü der
  Liste gewandert („Stummschalten“, neben dem Favoriten).
- Ein Block „Konten“ in den Einstellungen für alles, was eine Anmeldung ist: eine nach Relay gruppierte Liste mit den
  Konten dieses Geräts (wechseln, entfernen) und, für einen Admin, allen anderen auf dem Relay (Einladung, Admin,
  löschen); ein einziges „Hinzufügen“ nimmt eine Einladung, einen Kopplungslink eines anderen Relays, eine Adresse
  oder, für einen Admin, eine neue Person; der Schalter für die gemeinsame Liste steht darunter. Die Blöcke „Relays“
  und „Alle Konten“ sowie „Bei einem anderen Konto anmelden“ im Menü der Seitenleiste sind weg; das Hauptkonto hat
  nichts Eigenes mehr zu bearbeiten; das Abmelden bleibt unter „Geräte und Sicherheit“. Die Einstellungen sind eine
  Seite wie die Repo-Seite (ein Kopf mit dem Titel, der Inhalt über die ganze Breite), ohne Symbole in den
  Überschriften; die Zurück-Pfeile der Seiten erscheinen nur auf dem Handy. Etwas dort hinzuzufügen (einen
  KI-Schlüssel, eine Person oder einen Link, einen Rechner, ein Gerät) öffnet einen kleinen Dialog wie der Bot-Editor
  statt eines Formulars innerhalb der Seite.
- Die Desktop-Apps holen ihren Update-Feed von openfolk.app, direkt von GitHub, wenn das nicht antwortet. Die erste
  Prüfung eines Tages zählt die Installation anonym (Tagessummen pro System und Version, keine IP, keine Kennung,
  öffentlich unter `openfolk.app/update/stats.json`); „Diese Installation anonym zählen“ im Menü schaltet das ab.
- Das Verschieben eines Bots auf einen schlafenden Rechner fragt, bevor dieser geweckt wird; abgelehnt, wird nichts
  geweckt und das Verschieben nicht gestartet.
- Die Konto-Einstellungen erklären sich selbst: Die Anmeldung dieses Geräts bei einem anderen Konto hat einen eigenen
  Abschnitt, die Liste und das Formular für neue Konten sagen, was ein Einladungslink und das Adminrecht bewirken, und
  die Buttons nennen, was sie erzeugen.

### Behoben
- „Rechner hinzufügen“ und der zweite Faktor in den Einstellungen blieben leer, sobald das Gerät den
  Ende-zu-Ende-Schlüssel hatte: Die Web-App verwarf die eigenen Antworten des Relays als unverschlüsselt (#17).
- Die Zeile eines Bots in der Chatliste wächst nicht mehr, wenn sie offene Git-Änderungen, weitere Unterhaltungen,
  eine Warteschlange oder ein Stumm-Zeichen zeigt; diese Markierungen teilen sich eine Zeile.

### Sicherheit
- Die Konnektoren des claude.ai-Kontos, mit dem Claude Code angemeldet ist (Gmail, Google Drive und andere),
  erreichen die Sitzungen der Bots nicht mehr. Sie kamen mit dem Login, sodass ein Bot, der eine präparierte Seite oder
  Datei las, dazu hätte gebracht werden können, Mails oder die Variablen eines Servers zu lesen. „Konnektoren“ in den
  Einstellungen eines Rechners lässt sie wieder zu.
- In *riskant* fragt jeder Aufruf eines externen MCP-Werkzeugs nach, auch solche namens get, list, search oder read:
  Der Name sagt nichts darüber, was zurückkommt. Die MCP-Ressourcen-Werkzeuge (`ListMcpResourcesTool`,
  `ReadMcpResourceTool`) und Allow-Regeln in den Claude-Code-Einstellungen des Users überspringen die Freigabe nicht
  mehr.
- `docs/running.md` erklärt, dass ein Container die Ports des Hosts über das Docker-Gateway erreicht, an der Firewall
  des Hosting-Anbieters vorbei.

## [0.1.2] - 2026-10-20

### Behoben
- Das Beenden der Desktop-App fragt nicht mehr, ob auf arbeitende Bots gewartet werden soll, während ein untätiges
  Backend noch herunterfährt.

### Sicherheit
- Das Relay speichert Passwörter (`USER_PASSWORD`, das beim Beanspruchen gesetzte Passwort, die Passwörter weiterer
  Konten) als gesalzene scrypt-Hashes statt SHA-256. Ein Relay, das `USER_PASSWORD` aus seiner Umgebung bekommt,
  braucht nichts. Ein mit `npm run claim` beanspruchtes Relay bleibt beansprucht und behält seine Backends, aber sein
  altes Passwort meldet nicht mehr an: Geräte per Link koppeln (`npm run pair`), oder `USER_PASSWORD` und
  `AGENT_TOKEN` setzen, oder `owner.json` löschen und es neu beanspruchen; das Start-Log des Relays sagt das. Ein Admin
  setzt das Passwort eines weiteren Kontos neu.
- Die Web-App lässt eine Chat- oder Rechner-ID wie `__proto__` aus einem Frame nicht mehr bis zu `Object.prototype`
  durch, und Antworten auf Namensvorschläge rufen nur die Vorschlags-Buttons auf, die sie kennt.

## [0.1.1] - 2026-10-20

### Behoben
- macOS: Die Desktop-App ist signiert und notarisiert; 0.1.0 erschien ohne Mac-Paket. electron-builder 26.17.0
  entsperrt seinen temporären Schlüsselbund mit dem richtigen Passwort, und die Lizenz ist in die Ressourcen der App
  gewandert.
- Ein Rechner, dessen Hostname länger als 32 Zeichen ist (auf Macs häufig), wurde vom Relay abgelehnt und verband sich
  nie; der Name wird passend gekürzt.
- Windows: Ein Bot, dessen Ordner hinter einem kurzen (8.3-)Namen, einer Junction oder einem Link liegt, wurde nicht
  als in seinem Repo arbeitend erkannt, sodass das Pullen aller Repos unter ihm pullen konnte.
- Die Einstellungen eines Rechners schlossen sich wieder, wenn direkt nach dem Öffnen eine Nachricht vom Backend
  eintraf.

## [0.1.0] - 2026-10-20

Erste öffentliche Version. Das Backend wird unter Windows 11 entwickelt und getestet; das Relay läuft überall, wo
Node 22 oder Docker läuft.

### Neu
- Web-App im Messenger-Stil (Handy zuerst, als PWA installierbar) für Bots, jeder mit Bild, Name, Rolle, Ton, Modell,
  Freigabestufe und einem Arbeitsordner auf einem Rechner. Englisch und Deutsch.
- Engines: standardmäßig Claude Code (Claude Agent SDK), OpenAI Codex sowie Cursor, GitHub Copilot, Google
  Antigravity und OpenCode über das Agent Client Protocol. „KI-Anbieter“ in den Einstellungen eines Rechners schaltet
  jede Engine ein oder aus und wählt Abo oder API-Schlüssel. Claude kann auf „Abo und API-Schlüssel, nach Regeln“
  laufen: Meldet das Abo sein Limit, laufen die Sitzungen mit dem Schlüssel weiter, bis es zurückgesetzt wird, bis zu
  einer Tagesobergrenze in US-Dollar.
- Die ersten Schritte enthalten die Anmeldung bei einem KI-Anbieter: Jeder Rechner meldet, welche Engines bereit sind,
  die Web-App zeigt den Befehl für Claude Code und startet die Gerätecode-Anmeldung von Codex und Copilot, sodass ein
  Backend in einem Container dafür kein Terminal braucht.
- Freigaben und Multiple-Choice-Fragen als Karten im Chat, Push-Benachrichtigungen an Browser (Web Push) und die Apps
  (APNs, FCM), Auslastung der Abo-Zeitfenster.
- Gruppenchats, Aufträge von Bot zu Bot mit `message_bot` (pro Bot: „Kann Aufträge geben an“ alle Bots, ausgewählte
  Bots oder keine), Routinen mit optionalem Wecken und Herunterfahren des Rechners, Wissen für einen Bot, einen Ordner,
  eine Gruppe oder alle, Dateien in beide Richtungen, Sprachnachrichten, die auf dem Rechner transkribiert werden
  („Sprachnachrichten einrichten“ installiert faster-whisper).
- Bots durchsuchen mit `search_history` den Verlauf aller Chats auf ihrem Rechner und lesen einen Treffer mit
  `read_history` im Zusammenhang; die Suche der Web-App findet Einträge mit allen Wörtern einer Anfrage.
- Der Bot-Editor hat ein Ordner- und ein Repository-Feld; jedes füllt das andere, und das Speichern klont das
  Repository in den Ordner. Ein auf einen anderen Rechner verschobener Bot nimmt seine Sitzungen mit. „Offene
  Änderungen“ warnt, wenn einem Rechner die Zugangsdaten fehlen, um in eines der Repositories seiner Bots zu pushen.
- Mehrere Chats nebeneinander auf breiten Bildschirmen, jeder in einer eigenen Spalte; die Einstellungen öffnen sich
  als Bereich daneben.
- „Diesen Chat in der IDE öffnen“ und „… in einem Terminal“ auf dem Rechner (standardmäßig VS Code mit Claude Code
  für VS Code und `claude --resume`).
- `npm start` ganz ohne `.env`: Das Backend betreibt das Relay in seinem eigenen Prozess auf 127.0.0.1, erzeugt beim
  ersten Start jeden Schlüssel und öffnet die Web-App mit einem Kopplungslink. `npm run pair` erzeugt einen Link für
  ein weiteres Gerät, `npm run env` schreibt die erzeugten Werte für weitere Rechner in die `.env`.
- Ein eigenes Relay: Ohne Tokens gestartet, wartet es auf seinen Eigentümer und schreibt einen Einrichtungscode in
  sein Log; `npm run claim` (oder `RELAY_SETUP_CODE` in der Umgebung des Backends) beansprucht es. Fertiges Image
  `ghcr.io/openfolk/openfolk` für amd64 und arm64 und eine Vorlage für Unraid (`deploy/unraid/openfolk-relay.xml`).
- Das Backend als Linux-Container: das Image `ghcr.io/openfolk/openfolk-local` mit `docker-compose.local.yml` und
  `docker-compose.server.yml` für Relay und Backend auf einem Server, automatisch beansprucht. Die Ordner der Bots
  liegen in einem Ordner des Hosts (`WORK_DIR`), sodass sie sich über SSH oder mit VS Code Remote öffnen lassen.
- Weitere Rechner treten per Einladung bei: „Rechner hinzufügen“ in den Einstellungen, dann
  `npm run join -- "<link>"`; jeder bekommt ein eigenes Agent-Token, und „Abmelden“ trennt ihn wieder.
- Desktop-Apps für Windows, macOS und Linux (AppImage, .deb), die die Bots „auf diesem Rechner“ ausführen oder sich
  mit einem Relay verbinden und sich aus den GitHub-Releases aktualisieren, nachdem die Bots fertig sind. Apps für iOS
  und Android (Capacitor) um dieselbe Web-App.
- Anmeldung per QR-Code: Ein angemeldetes Gerät scannt den Code auf der Anmeldeseite eines neuen; die mobilen Apps,
  der Browser und die Desktop-App scannen mit der Kamera des Geräts.
- Releases enthalten die Desktop-Pakete, ihre Update-Feeds und eine `SHA256SUMS`, gebaut und per Smoke-Test geprüft
  von der CI auf jedem System.
- `npm install --omit=optional` lässt Codex und Copilot weg (etwa 600 MB).
- `PROTOCOL_VERSION`: Web-App und Backends melden, was sie sprechen, und sagen, welche Seite ein Update braucht.
- Der Anmeldeschritt der ersten Schritte öffnet ein Terminal mit Claude Code auf dem Rechner (die Desktop-Apps bringen
  Claude Code ohne ein `claude` im PATH mit) und nimmt statt eines Abos einen Anthropic-API-Schlüssel an.
- Umzug auf ein Relay auf einem Server aus der App heraus: Die ersten Schritte und die Einstellungen beanspruchen es
  mit dem Einrichtungscode aus seinem Log; das Backend zieht ohne Neustart um, und die Seite folgt, dort angemeldet.
- Desktop-App: „Diesen Rechner mit meinem Server verbinden“ auf der Einrichtungsseite lässt den Rechner mit dem Link
  aus „Rechner hinzufügen“ beitreten; unter Windows startet „Ohne Anmeldung ausführen“ das Backend ab Systemstart über
  eine geplante Aufgabe.
- Ein Backend in einem Container schreibt einen Code für das erste Gerät des Hauptkontos in sein Log; die Anmeldeseite
  nimmt ihn an („Code aus dem Server-Log“), solange es kein Gerät gibt, sodass das erste Gerät kein `docker exec`
  braucht.

### Geändert
- Eine neue Installation startet ohne eingeschalteten KI-Anbieter: Die ersten Schritte fragen, welche du nutzt, und
  nur diese starten. Bestehende Rechner behalten alle. Ein Rechner darf jetzt alle Anbieter ausgeschaltet haben.
- Benachrichtigungen, Geräte und Sicherheit sowie Konten sind Blöcke der Einstellungsseite statt eigener Seiten.
- Das Handy über Tailscale Serve ohne Server zu erreichen, wird nicht mehr angeboten; das Handy braucht ein Relay auf
  einem Server. Tailscale hält weiterhin die Verbindung des Backends zu einem solchen Relay aus dem Internet heraus
  (`docs/tailscale.md`).

### Sicherheit
- Das Relay speichert keine Nachrichten und hält keine Zugangsdaten für Modelle. Ende-zu-Ende-Verschlüsselung zwischen
  Geräten und Backends ist standardmäßig an (der Schlüssel wird beim ersten Start erzeugt, `E2E_KEY=off` schaltet sie
  ab); jeder verschlüsselte Frame trägt einen Zähler und seine Sendezeit, und doppelt zugestellte oder mehr als zehn
  Minuten abweichende Frames werden verworfen. Mit dem Schlüssel auf einem Gerät ignoriert die Web-App
  unverschlüsselte Frames von Backends.
- Das Relay speichert Passwort und Agent-Token nur als SHA-256-Hashes, beim Beanspruchen mindestens 16 Zeichen lang.
  Kopplungslinks, TOTP als zweiter Faktor (in der App eingerichtet, jeder Code nur einmal akzeptiert), Geräteschlüssel,
  die nach 90 Tagen ohne Nutzung ablaufen, optionale Beschränkung auf Tailscale. Der Kopplungslink mit dem
  Ende-zu-Ende-Schlüssel geht nur an ein interaktives Terminal, nie in eine Logdatei.
- Grenzen des Relays: 16 KB vor der Anmeldung, zehn nicht angemeldete Verbindungen pro Adresse, ein Client, der nicht
  mehr liest, wird getrennt, sobald 96 MB auf ihn warten. `/ws/client` lehnt fremde Webseiten ab (Origin).
  `X-Forwarded-For` zählt nur von einem Proxy an einer privaten oder Loopback-Adresse, sofern `TRUST_PROXY` nichts
  anderes sagt.
- Dateien gehen nur aus den Ordnern der Bots und den Uploads an die App, nie aus den Punktordnern unter Home; Links
  und Junctions werden vor jeder Prüfung aufgelöst, und der Ordner eines Bots wird vor jedem Auftrag gegen die
  `ALLOWED_ROOTS` des Rechners geprüft.
- Lesende Werkzeuge werden für `.env`-Dateien, Schlüssel und Zugangsdaten in jeder Freigabestufe verweigert; Vorlagen
  wie `.env.sample` bleiben lesbar. In „riskant“ wird ein Shell-Befehl in die Befehle zerlegt, die er ausführt, und
  jeder fragt nach, wenn er außerhalb des Bot-Ordners schreibt, ein Geheimnis liest, Code aus dem Internet ausführt,
  Pakete installiert oder mit erhöhten Rechten läuft. ACP-Aufrufe unbekannter Art fragen nach, statt durchzugehen.
- Peer-Daten zwischen Backends werden vor der Nutzung gegen ein Schema geprüft; Bot-Text wird ohne Klassen, IDs,
  Styles und `data-`-Attribute bereinigt; nur die mitgelieferte Einrichtungsseite der Desktop-App kann ihre
  Relay-Adresse ändern; die mobilen Apps lehnen eine einfache `http://`-Relay-Adresse ab.
- Dateien im Datenordner des Backends werden mit Modus 0600 geschrieben (Linux und macOS). Rekursives Löschen läuft
  über `removeTree`, weil `fs.rmSync` unter Windows mit Node 24 Verzeichnis-Junctions folgt.

[Unreleased]: https://github.com/OpenFolk/OpenFolk/compare/v0.7.1...HEAD
[0.7.1]: https://github.com/OpenFolk/OpenFolk/compare/v0.7.0...v0.7.1
[0.7.0]: https://github.com/OpenFolk/OpenFolk/compare/v0.6.0...v0.7.0
[0.6.0]: https://github.com/OpenFolk/OpenFolk/compare/v0.5.0...v0.6.0
[0.5.0]: https://github.com/OpenFolk/OpenFolk/compare/v0.4.0...v0.5.0
[0.4.0]: https://github.com/OpenFolk/OpenFolk/compare/v0.3.0...v0.4.0
[0.3.0]: https://github.com/OpenFolk/OpenFolk/compare/v0.2.1...v0.3.0
[0.2.1]: https://github.com/OpenFolk/OpenFolk/compare/v0.2.0...v0.2.1
[0.2.0]: https://github.com/OpenFolk/OpenFolk/compare/v0.1.2...v0.2.0
[0.1.2]: https://github.com/OpenFolk/OpenFolk/compare/v0.1.1...v0.1.2
[0.1.1]: https://github.com/OpenFolk/OpenFolk/compare/v0.1.0...v0.1.1
[0.1.0]: https://github.com/OpenFolk/OpenFolk/releases/tag/v0.1.0
