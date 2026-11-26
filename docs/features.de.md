# OpenFolk: Funktionen

Was OpenFolk kann, Funktion für Funktion, geschrieben für die Menschen, die es benutzen. Jeder Abschnitt steht für
sich und lässt sich einzeln lesen, zitieren oder posten. Die englische Fassung ist [features.md](features.md), mit
denselben Abschnitten unter denselben Nummern. Installation und Betrieb beschreibt die [README](README.de.md).

## 1. Bots

Einen KI-Coding-Agenten im Terminal laufen zu lassen ist einfach. Fünf davon über mehrere Projekte, und dabei zu
wissen, welcher gerade auf dich wartet, ist es nicht. OpenFolk macht aus jedem Agenten einen Bot: einen Kollegen mit
Bild, Name, Rolle und Ton, der in einem festen Ordner arbeitet, zum Beispiel ein Bot je Repository.

Die Bots stehen in einer Liste wie die Chats eines Messengers. Du siehst auf einen Blick, wer arbeitet, woran, und
wer eine Antwort hat, die du noch nicht gelesen hast. Diese beiden Gruppen rücken in der Liste nach oben, sodass du
zuerst die Bots siehst, die dich brauchen.

Ein Bot arbeitet weiter, wenn du die App schließt. Ist er fertig oder braucht er eine Entscheidung, bekommst du eine
Benachrichtigung aufs Handy.

## 2. Einen Bot anlegen

Ein neuer Bot dauert eine Minute. „+“ öffnet eine kurze Seite, die nach Rolle, Name und einem Ordner oder der
Adresse eines Git-Repositorys fragt, mehr nicht. Unter der Rolle stehen fertige Vorlagen: Chief of Staff, Entwickler,
Infrastruktur, Social Media, Landingpages, Produkt-Scout und Mail. Ein Tipp übernimmt die Rolle samt passenden
Arbeitsanweisungen und einer Freigabe-Stufe.

OpenFolk schlägt Vornamen vor, die zur Rolle passen, auf Wunsch weitere. Trägst du statt eines Ordners die Adresse
eines Repositorys ein, klont der Rechner es für den Bot. Ein Bot ohne eigenes Projekt, für Recherche oder
Brainstorming, lässt beide Felder leer und bekommt einen Ordner mit seinem Namen.

Nach „Anlegen“ öffnet sich der Chat des Bots, und den Rest macht er selbst: Er sieht sich seinen Ordner an, stellt
dir ein paar Fragen mit Optionen zum Antippen, schreibt Fachgebiet und Arbeitsanweisungen selbst und bietet zum
Schluss ein Profilbild an.

## 3. Das Profil eines Bots

Jeder Bot hat eine eigene Seite mit allem, was ihn ausmacht: Bild, Fachgebiet, Rolle, Ton, Modell, Freigabe-Stufe,
der Ordner, in dem er in der Liste steht, die Bots, denen er Aufträge geben darf, und die Stimme, die seine Antworten
vorliest.

Für das Bild gibt es ein Set fertiger Porträts. Mit einem OpenAI- oder Gemini-Schlüssel in den Einstellungen erzeugt
„KI-Avatar“ stattdessen ein Foto, und „Vorschlag“ schlägt Name, Rolle oder Bild aus dem vor, was der Ordner des Bots
über das Projekt verrät. Ein Bot kann sein Bild auch selbst setzen oder erzeugen, wenn du ihn im Chat darum bittest.

„Bot duplizieren“ legt eine Kopie unter neuem Namen an, mit demselben Profil, Modell, Ordner und Bild. Seine Routinen
kommen pausiert mit; Verlauf, Wissen und Unterhaltungen bleiben beim Original.

## 4. Freigaben im Chat

Ein Agent, der alles darf, ist ein Risiko, und ein Agent, der bei allem fragt, ist nutzlos. In OpenFolk wählst du je
Bot. In der Standard-Stufe fragt der Bot vor dem, was wehtun kann: Löschen, Pushen, Deployen, SSH, Dienste neu
starten, Schreiben außerhalb seines Ordners, Pakete installieren, Code aus dem Internet ausführen und vor jedem
Aufruf eines externen Dienstes.

Die Frage erscheint als Karte im Chat, auch auf dem Handy. Du gibst einmal frei, erlaubst es für den Rest der
Session oder lehnst mit einer Begründung ab, die der Bot liest und mit der er weiterarbeitet. Ohne Antwort wird nach
30 Minuten abgelehnt, und die Karte bleibt als abgelaufen im Chat stehen. Schreibst du statt einer Antwort eine neue
Nachricht, schließen sich die offenen Karten, nichts von dem Gefragten passiert, und deine Nachricht ist die nächste
Anweisung des Bots.

Zwei weitere Stufen decken die Ränder ab: Die eine fragt vor jeder einzelnen Änderung, die andere fragt nie. Deine
geheimen Dateien und Schlüssel bekommt ein Bot in keiner Stufe zu lesen.

## 5. Rückfragen

Manchmal braucht ein Bot keine Erlaubnis, sondern eine Entscheidung: welcher von drei Wegen, welcher Name, welcher
der offenen Punkte zuerst. Er fragt mit einer Karte im Chat, die die Optionen als Knöpfe zeigt.

Ein Tipp antwortet. Passt keine der Optionen, hat die Karte ein Freitextfeld. Die Rückfrage kommt wie eine Freigabe
als Benachrichtigung, damit kein Bot stundenlang stillsteht wegen einer Entscheidung, die dich fünf Sekunden kostet.

## 6. Benachrichtigungen

Dein Handy meldet sich, wenn ein Bot fertig ist, wenn eine Routine gelaufen ist, wenn ein Bot eine Freigabe braucht
oder eine Rückfrage hat, wenn ein Rechner aufgewacht ist, wenn ein Abo-Limit erreicht ist und wenn dir eine Person
schreibt. Jede Art lässt sich auf aus, leise, normal oder hoch stellen, für alle deine Geräte auf einmal. Einzelne
Bots und Gruppen schaltest du stumm.

Solange du an einem Computer arbeitest, bleibt das Handy still: Antworten und Routine-Ergebnisse brummen nicht in der
Tasche, während du ohnehin draufschaust. Freigaben und Rückfragen kommen erst nach drei Minuten durch, wenn bis dahin
niemand den Chat geöffnet oder geantwortet hat. Ein Schalter auf dem Handy stellt das ab, wenn du dort jede
Benachrichtigung willst.

Du bestimmst, wie viel eine Benachrichtigung der Mobile-Apps zeigt: den Namen des Bots oder nichts als „OpenFolk“.

## 7. Nachrichten während der Arbeit

Du musst nicht warten, bis ein Bot fertig ist, um ihm etwas zu sagen. Eine Nachricht, die du schickst, während er
arbeitet, getippt oder gesprochen, geht in den laufenden Auftrag: Der Bot liest sie beim nächsten Schritt und nimmt
sie in seinen Plan auf, so wie im Terminal. Der Chat sagt dir, dass das passiert ist.

Ist die Nachricht für später gedacht, stellt „Danach“ neben dem Eingabefeld sie hinter den laufenden Auftrag. Das
gilt für Bots mit Claude; bei den anderen KI-Anbietern wartet jede Nachricht, bis der Auftrag fertig ist.

## 8. Aktivität

Der Chat eines Bots zeigt, was der Bot tut, nicht nur, was er sagt. Jeder Schritt, eine Datei, die er liest, ein
Befehl, den er ausführt, eine Suche, erscheint als Zeile, die du aufklappst, um Ergebnis und Dauer zu sehen. Die
Liste zeigt in einer Zeile, woran jeder Bot gerade arbeitet.

Lange Aufgaben, die ein Bot im Hintergrund startet, ein Testlauf, ein Build, ein Hilfsagent, stehen in der
Statuszeile über dem Eingabefeld. Laufen nur noch sie, beendet „Stopp“ sie nach einer Rückfrage auf dem Rechner
des Bots. Was sie bis dahin getan haben, bleibt.

## 9. Unterhaltungen und Entwürfe

Ein Bot, mehrere Themen. Neben seinem Hauptchat kann ein Bot weitere Unterhaltungen haben, jede eine frische Session
im selben Ordner: eine für das Refactoring, eine für den Fehler des Tages, eine fürs Brainstorming. Sie stehen als
Tabs direkt unter dem Namen des Bots. Ein Tipp wechselt, „+“ beginnt eine neue, und ein Punkt markiert einen Tab,
der arbeitet oder etwas Ungelesenes hat.

Text, den du getippt und nicht abgeschickt hast, bleibt bei seinem Chat. Schau in einen anderen Chat und komm
zurück, und der Text ist wieder da, auch nach einem Neuladen. Die Liste zeigt für so einen Chat „Entwurf: …“, damit
du die halb geschriebene Nachricht nicht vergisst.

## 10. Gruppenchats

Mehrere Bots in einem Chat. Einen Bot sprichst du mit @ und seinem Namen an, alle mit @all, und jeder antwortet aus
seinem Ordner mit seinem Wissen: der Entwickler zum Code, der Infrastruktur-Bot zum Server.

Bots können sich in der Gruppe per @ weiterreichen, bis zu viermal je Nachricht. Eine Frage zu einem gescheiterten
Deploy geht vom Entwickler zum Infrastruktur-Bot und zurück, ohne dass du Nachrichten zwischen zwei Chats hin- und
herträgst.

## 11. Ordner

Bei zehn oder zwanzig Bots braucht die Liste Ordnung. „+“ → „Neuer Ordner“ legt einen Ordner in der Liste an; Bots
und Gruppen kommen über ihr Menü hinein oder indem du sie auf die Überschrift des Ordners ziehst. Ein Tipp auf die
Überschrift klappt den Ordner ein, und Ordner lassen sich umbenennen, verschieben und löschen.

Bots, die arbeiten oder eine ungelesene Antwort haben, rücken in der Liste nach oben, egal in welchem Ordner sie
stehen. Für einen Ordner, bei dem du das nicht willst, gibt es „Bots bleiben im Ordner“.

Du kannst auch einfach einen Bot bitten aufzuräumen: Er sortiert Bots und Gruppen in Ordner, legt neue an und sagt
in seinem Chat, was er verschoben hat. Die Ordner sind auf allen deinen Geräten gleich.

## 12. Bot an Bot

Ein Bot kann einem anderen Bot einen Auftrag geben, auf demselben Rechner oder auf einem anderen. Der Produkt-Bot
bittet den Entwickler, etwas zu bauen, der Entwickler bittet den Infrastruktur-Bot, den Server zu prüfen. Ein Bot
kann auch einer eigenen Unterhaltung einen Auftrag geben, etwa vom Brainstorming zum Coden.

Der auftraggebende Bot wartet nicht blockiert. Das Ergebnis kommt von selbst in die Unterhaltung zurück, die den
Auftrag gegeben hat, egal wie lange es dauert; der Bot macht dort damit weiter, und du bekommst eine
Benachrichtigung. Eine Leiste über dem Eingabefeld zeigt, auf wen der Chat seit wann wartet, mit „Nicht mehr warten“
und „Auftrag abbrechen“.

Offene Aufträge überstehen einen Neustart. Ein Auftrag für einen schlafenden Rechner geht hinaus, sobald er
aufwacht. Schleifen werden abgelehnt, und in den Einstellungen jedes Bots legst du fest, wem er Aufträge geben darf:
allen, ausgewählten Bots oder keinem.

## 13. Missionen

Eine Mission gibt einem Team aus Bots ein langfristiges Ziel, das es selbstständig verfolgt. Du beschreibst das Ziel
in eigenen Worten, und der Builder macht daraus einen Vorschlag: Erfolgs- und Abbruchkriterien, ein Team mit einem
Supervisor, Meilensteine, Risiken, ein Budget, Leitplanken und einen Zeitplan. Du bearbeitest alles, bevor etwas
angelegt wird.

Der Supervisor führt die Mission dann in Zyklen. Er plant Aufgaben, gibt sie ans Team, prüft die Ergebnisse und
protokolliert seine Entscheidungen mit dem Grund. Vier Autonomiestufen legen fest, was er dich vorher fragen muss,
von jeder Delegation bis nur noch zu Änderungen an Grenzen. Budget, Autonomie, Regeln und Leitplanken änderst nur du
in der App, nie ein Bot.

Die Missionsseite zeigt Ziel, Fortschritt, das Team bei der Arbeit, die Aufgaben, die Entscheidungen, die auf dich
warten, das Protokoll und die Zahlen des Projekts als Kacheln, Kurven und Tabellen. Der Notaus stoppt alles, bis du
fortsetzt.

## 14. Routinen

Eine Routine ist ein Auftrag nach Zeitplan: täglich, werktags, wöchentlich, stündlich oder in jedem anderen Abstand.
„Prüf jeden Morgen um 8 die offenen Pull Requests“, „schreib freitags den Wochenbericht“.

Auf der Seite des Bots hat jede Routine eine Zeile, die in Worten sagt, wann sie läuft, wann der nächste Lauf ist,
und einen Schalter zum Pausieren. Aufgeklappt zeigt sie ihre Anweisung, „Jetzt ausführen“ und die letzten 20 Läufe
mit Beginn, Dauer, Status und, bei einem Fehlschlag, dem Grund. „Im Chat zeigen“ springt zur Antwort.

Du kannst auch den Bot im Chat bitten: Er legt seine eigenen Routinen an und ändert sie, nie die eines anderen Bots.
Eine Routine kann ihren Rechner für den Lauf wecken und danach wieder herunterfahren.

## 15. Slash-Commands

Wer Claude Code im Terminal nutzt, hat Commands und Skills, auf die er sich verlässt. In OpenFolk sind sie auch da:
„/“ am Anfang einer Nachricht listet die Commands für den Ordner des Bots, deine eigenen, die des Projekts, die von
Plugins und einige eingebaute.

Sie laufen genau wie im Terminal, auch in Gruppenchats und in Routinen. So startet eine Routine einen Command, den
du schon geschrieben hast, statt einen langen Auftrag zu wiederholen.

Das gilt für Bots mit Claude; die anderen KI-Anbieter haben keine solche Liste.

## 16. Dateien, Bilder und Videos

Dateien anhängen, einfügen oder in den Chat ziehen. Bilder und PDFs gehen direkt ans Modell, ein Screenshot des
Fehlers ist deshalb oft die schnellste Fehlermeldung. Bots schicken Dateien zurück: den fertigen Export, das
erzeugte Bild, den Plan.

Bilder stehen im Chat und öffnen sich mit einem Tipp groß, Videos laufen in der App, und Markdown-Dateien wie ein
Plan, den ein Bot geschrieben hat, öffnen sich formatiert zum Lesen, mit „Speichern“ für die Datei.

Dateien reisen Ende-zu-Ende-verschlüsselt, bis 20 MB je Datei. Geheime Dateien und Schlüssel werden nie
herausgegeben, egal wer fragt.

## 17. Wissen

Bots merken sich Dinge. Ein Bot behält einzelne Fakten, etwa wie du Commits geschrieben haben willst oder welcher
Server das Staging-System ist, und hat sie in jeder späteren Unterhaltung parat. Ein Fakt gehört einem Bot, einem
Ordner, einer Gruppe oder allen.

Bots durchsuchen außerdem die früheren Nachrichten aller Chats auf ihrem Rechner. „Was haben wir zum Deploy
entschieden?“ wird aus der Unterhaltung beantwortet, in der es entschieden wurde, auch wenn das vor Wochen der Chat
eines anderen Bots war.

Wissen von außen, ein Wiki, Notion oder Confluence, kommt über die Dienste herein, die du an deine Bots anbindest.

## 18. Gefällt mir

„Gefällt mir“ im Menü einer Bot-Antwort setzt ein Herz daran. Der Bot antwortet nicht darauf. Er erfährt es mit
deiner nächsten Nachricht und kann sich merken, was dir an seiner Arbeitsweise gefallen hat.

Es ist die leise Art, Rückmeldung zu geben: keine Nachricht „gut gemacht, mehr davon“, nur ein Tipp, und der Bot
lernt mit der Zeit, wie eine gute Antwort für dich aussieht. In Chats mit Personen funktioniert das Herz wie in
jedem Messenger: Ihr seht es beide.

## 19. Sprachnachrichten und Diktieren

Mikrofon halten und sagen, was du willst; der Bot bekommt es als Text. Die Aufnahme wird auf dem Rechner in Text
umgewandelt, auf dem der Bot läuft, nicht von einem Cloud-Dienst. Die Einstellungen des Rechners richten das mit
einem Knopf ein.

Willst du den Text lieber sehen, bevor er rausgeht, stellst du das Mikrofon für dieses Gerät auf Diktieren: Das
Eingabefeld bleibt beim Sprechen nutzbar, der Haken schreibt den Text an die Cursorstelle, und du schickst ihn als
normale Nachricht. Damit Projektbegriffe besser erkannt werden, bekommt die Umwandlung Name, Ordner und Repository
des Bots als Hinweise.

## 20. Antworten vorlesen

Jede Antwort lässt sich vorlesen, über das Menü der Nachricht oder von selbst, wenn du mit einer Sprachnachricht
gefragt hast. So ist ein Bot auch beim Kochen, Autofahren oder Spazierengehen nutzbar.

Du wählst, woher die Stimme kommt. Der Rechner des Bots liest kostenlos und offline vor, mit einer männlichen und
einer weiblichen Stimme je Sprache. Mit einem OpenAI- oder Gemini-Schlüssel klingen die Stimmen natürlicher; der
Text geht dann an diesen Anbieter. Jeder Bot kann eine eigene Stimme haben, mit „Anhören“ für eine Hörprobe.

## 21. Sprachdialog

Der Knopf neben dem Mikrofon öffnet eine Seite, auf der du freihändig mit einem Bot sprichst. Du redest, und nach
einer Sprechpause geht die Aufnahme von selbst raus. Du siehst, was verstanden wurde und was der Bot tut, und die
Antwort wird Satz für Satz vorgelesen, während der Bot noch schreibt. Danach geht das Mikrofon wieder auf.

Damit sich das wie ein Gespräch anfühlt, läuft der Dialog auf einem schnellen Modell, und der Bot wird gebeten, kurz
und in gesprochener Sprache zu antworten. Schwere Arbeit, Code, längere Recherchen, „denk gründlich nach“, geht an
den Hauptchat des Bots auf seinem eigenen Modell, und was gesagt wurde, kommt dort ebenfalls an.

Mit einem OpenAI-Schlüssel kann der Dialog stattdessen wie der Sprachmodus von ChatGPT laufen: Er erkennt das Ende
deines Satzes und lässt sich unterbrechen. Deine Stimme geht dann an OpenAI und kostet einige Cent pro Minute.

## 22. Weiterleiten

„Weiterleiten“ im Menü einer Nachricht gibt sie an einen anderen Bot, eine Unterhaltung, eine Gruppe oder eine
Person. Der gewählte Chat öffnet sich mit der Nachricht über dem Eingabefeld; du ergänzt ein paar Worte oder keine
und schickst sie ab.

Der Bot bekommt die ganze Nachricht und ihre Herkunft. Eine Antwort des Recherche-Bots wird so zum Auftrag des
Entwicklers, ohne Kopieren und Einfügen. Im Chat zeigt die Weiterleitung ein paar Zeilen, ein Tipp klappt den ganzen
Text auf, und die Zeile darunter führt zurück in den Chat, aus dem sie kam.

## 23. Favoriten, fixierte Nachrichten und Gelesen-Stand

Markiere die Bots, die du am meisten nutzt, als Favoriten, und fixiere die Nachrichten, zu denen du immer wieder
zurückkommst, etwa die Entscheidung, den Befehl oder den Link. Eine fixierte Nachricht ist oben in ihrem Chat einen
Tipp entfernt.

All das, und was du gelesen hast, ist auf jedem Gerät gleich. Liest du eine Antwort auf dem Handy, ist sie am
Desktop gelesen; fixierst du eine Nachricht am Schreibtisch, ist sie auf dem Handy fixiert.

## 24. Spalten auf breiten Bildschirmen

Auf einem breiten Bildschirm ist ein einzelner Chat verschenkter Platz. Strg-Klick oder ein Klick mit der mittleren
Maustaste öffnet einen Chat in einer eigenen Spalte neben den anderen, so viele wie Platz haben. Du kannst einen
Chat auch aus der Liste auf eine Spalte ziehen.

Jede Spalte hat ihr eigenes Eingabefeld, ihre eigene Warteschlange und ihre eigene Suche. So siehst du drei Bots
nebeneinander arbeiten und antwortest jedem dort, wo er steht. Die Seite des Bots dockt ebenfalls als Spalte an.
Handy und Laptop bleiben bei einem Chat.

## 25. Befehlspalette und Tastenkürzel

Strg+K (Cmd+K am Mac) öffnet eine Palette über alles: Bots, Gruppen, Personen, Unterhaltungen, Routinen, die
Abschnitte der Einstellungen und Aktionen wie „Neuer Bot“ oder das Wecken eines ausgeschalteten Rechners. Sie findet
auch Nachrichten und angehängte Dateien, und ein Treffer öffnet den Chat an dieser Nachricht.

Für alles, was du oft tust, gibt es eine Taste: neuer Bot, im Chat suchen, zum n-ten Chat springen, zurück und vor
durch die geöffneten Chats, senden von überall. Strg+/ zeigt alle.

Auf dem Handy leistet die Suche über der Liste dasselbe, mit Filtern für Nachrichten, Bots, Dateien und Routinen.

## 26. Offene Änderungen

Der Tab „Repos“ zeigt, was deine Bots in Git hinterlassen haben: nicht committete Dateien und Commits, die noch
nicht gepusht oder noch nicht geholt sind, für jedes Repository im Ordner eines Bots. Ein Zähler zeigt, wie viele es
sind.

Je Repository committest und pushst du, oder holst den neuen Stand, mit einem Tipp, auch vom Handy. Der letzte
Schritt eines Auftrags wartet so nicht mehr, bis du wieder am Schreibtisch sitzt.

## 27. Repos bleiben aktuell

Nichts ist ärgerlicher als ein Bot, der auf dem Code von gestern aufbaut. OpenFolk holt die Repositorys seiner Bots
beim Start, nach dem Aufwachen eines Rechners, jede Viertelstunde und wenn ein anderer deiner Rechner aus der App
pusht. Repositorys ohne lokale Änderungen rücken auf den neuesten Stand vor.

Dabei ist es vorsichtig: Es macht nie einen Merge, Rebase oder Reset, und es lässt ein Repository in Ruhe, solange
ein Bot darin arbeitet. Was es nicht übernehmen konnte, steht mit dem Grund unter „Offene Änderungen“. Ein Schalter
in den Einstellungen schaltet es ab.

## 28. VS Code und Terminal

OpenFolk ersetzt deinen Editor nicht. Am Schreibtisch arbeitest du weiter in VS Code, Cursor oder im Terminal, und
OpenFolk listet die Sessions, die du dort hattest. Du kannst sie live mitlesen und eine davon als Unterhaltung mit
einem Bot fortsetzen, mit ihrem ganzen Kontext. Du fängst am Schreibtisch an und machst vom Sofa aus weiter.

Andersherum geht es auch: „Diesen Chat in der IDE öffnen“ oder „im Terminal öffnen“ übergibt die Session eines Chats
an seinen Rechner, und du machst dort mit der Tastatur weiter.

## 29. Mehrere Rechner

Der PC im Büro, der Laptop, ein Server. OpenFolk läuft auf jedem davon, und du siehst alle ihre Bots in einer Liste.
Jeder Bot wohnt auf einem Rechner und arbeitet dort in einem Ordner.

Schläft ein Rechner, schlafen seine Bots, und die App bietet an, ihn zu wecken. Der Tab „Status“ zeigt jeden Rechner
mit seinen Bots und dem, was dort läuft. Ein weiterer Rechner kommt mit einem Link oder QR-Code aus den
Einstellungen dazu.

## 30. Einen Bot umziehen

Ein Bot zieht mit einem Tipp auf seiner Seite auf einen anderen Rechner. Das Repository wird dort geklont, falls es
fehlt, ein schlafender Rechner wird für den Umzug geweckt, und die Unterhaltungen kommen mit ihrem ganzen Kontext
mit. Der Bot macht dort weiter, wo er aufgehört hat.

Arbeit, die noch nicht auf dem Git-Server liegt, kommt von selbst mit: nicht committete Änderungen, neue Dateien,
Commits, die nie gepusht wurden. Sie reist verschlüsselt, ohne Push dazwischen. So schickst du einen Bot vom Büro-PC
auf den Laptop, bevor du gehst, mitten in der Aufgabe.

## 31. Rechner wecken und herunterfahren

Ein Rechner muss nicht den ganzen Tag laufen, damit seine Bots erreichbar sind. OpenFolk weckt einen schlafenden
oder ausgeschalteten Rechner, wenn du ihn brauchst, aus der App oder für eine Routine, und kann ihn danach wieder
herunterfahren. Ein so geweckter Rechner lässt seine Bots unter Windows und Linux laufen, ohne dass sich jemand
anmeldet.

So läuft die nächtliche Routine auf dem starken PC zu Hause, der den Rest der Zeit aus ist. Das Wecken braucht ein
Relay auf einem Server, denn irgendetwas muss wach sein, um zu wecken.

## 32. Status und Kontingent

Der Tab „Status“ ist die Übersicht über dein Setup: die Rechner mit ihren Bots, welche KI-Anbieter auf jedem bereit
sind, und Knöpfe zum Wecken oder Herunterfahren eines Rechners.

Er zeigt auch, wie viel von deinem Abo verbraucht ist, das 5-Stunden- und das Wochenfenster, und wann jedes
zurückgesetzt wird. So weißt du vor einem langen Auftrag, ob noch Platz dafür ist. Eine Benachrichtigung meldet,
wenn ein Limit erreicht ist.

## 33. KI-Anbieter

Bots laufen standardmäßig mit Claude Code. Ein Bot, oder eine einzelne Unterhaltung, kann auch OpenAI Codex, Cursor,
GitHub Copilot, Google Antigravity oder OpenCode nutzen. Das Modell wählst du je Bot, der Infrastruktur-Bot kann
also auf etwas anderem laufen als der Entwickler.

Jeder Anbieter meldet sich mit deinem eigenen Abo oder deinem eigenen Schlüssel an, auf deinem eigenen Rechner.
OpenFolk sieht diese Anmeldungen nie und verkauft keine Tokens. Zum Ausprobieren ganz ohne Konto brauchen die
kostenlosen Modelle von OpenCode keine Anmeldung.

## 34. Abo und API-Schlüssel

Claude kann über dein Abo laufen, über einen API-Schlüssel oder über beides nach Regeln. Mit beidem nutzen die Bots
das Abo, bis es sein Limit meldet, und machen dann mit dem API-Schlüssel weiter, bis das Limit zurückgesetzt wird,
höchstens bis zu einem Tagesbetrag, den du festlegst.

Der Auftrag, den das Limit gestoppt hat, läuft mit dem Schlüssel noch einmal. Eine lange Aufgabe stirbt so nicht um
drei Uhr nachts, weil das Wochenfenster voll ist.

## 35. Chats mit Personen

OpenFolk ist auch ein Messenger für Menschen. „+“ → „Person“ öffnet einen Chat mit einem Teammitglied oder einem
Kunden auf demselben Relay. Texte, Dateien und Sprachnachrichten gehen hin und her, mit Benachrichtigungen, Suche
und allem, was ein Chat hat.

Ein Bot kann an eine Person übergeben: Er schickt ihr seine Zusammenfassung, sie bekommt eine Benachrichtigung, und
du machst mit ihr direkt weiter. Bots lesen die Chats zwischen Personen nicht. „Blockieren“ hält Nachrichten in
beide Richtungen auf.

## 36. Konten

Eine Installation kann mehrere Menschen bedienen: dich beruflich und privat, eine Kollegin, ein Konto je Kunde.
Jedes Konto hat eigene Bots, Chats, eigenes Wissen, eigene Geräte und eigene Anmeldungen bei den KI-Anbietern, Abos
und Verbrauch bleiben also getrennt.

Du lädst jemanden mit einem Link oder QR-Code ein. Je Konto legst du fest, welche Rechner es nutzen darf, zum
Beispiel nur den Cloud-Server für einen Kollegen, und ob es allen schreiben darf oder nur den Admins. Ein Kunde
erreicht dann sein Team und keinen anderen Kunden.

Ein Gerät kann in mehreren Konten gleichzeitig angemeldet sein und zeigt deren Bots in einer Liste.

## 37. Eine Person auf ihrem eigenen Computer

Eine Mitarbeiterin oder ein Kunde kann die eigenen Bots auf dem eigenen Computer laufen lassen, mit dem eigenen Abo,
während du diese Bots von deinem OpenFolk aus einrichtest. Du bereitest das Konto vor, wählst die Bots, zum Beispiel
einen Support-Bot, der das Projekt nur liest, und einen Entwicklungs-Bot, der es ändert, und schickst einen Link.

Die Person installiert die Desktop-App, öffnet den Link und findet ihre Bots fertig vor, die Repositorys geklont.
Deine Bots, Chats und Rechner erreichen ihren Computer nie, und ihre Chats erreichen deine Rechner nicht. Du kannst
ihre Bots später ändern; die Änderung kommt an, sobald ihr Computer das nächste Mal online ist.

## 38. Mehrere Relays

Ein Relay je Kunde, eines für die Firma, eines privat. Die Desktop- und die Mobile-Apps können in mehreren Relays
gleichzeitig angemeldet sein. Jedes Relay behält seine eigenen Rechner, Konten und seinen eigenen Schlüssel.

Die Liste zeigt die Bots aller Relays zusammen, mit dem Namen des Relays als Kennzeichen. So musst du nicht zwischen
Installationen wechseln, um zu sehen, wer auf dich wartet.

## 39. Der Tresor

Bots brauchen Zugangsdaten für ihre Arbeit: das API-Token des Hosters, das Passwort eines Mail-Kontos. Die gehören
nicht in einen Chat. Sie kommen in den Tresor in den Einstellungen, mit einem Namen, einer Notiz und den Bots, die
sie nutzen dürfen.

Ein Bot verwendet einen Eintrag über dessen Namen, ohne den Wert je zu sehen. Der Wert wird in der App nie wieder
angezeigt, nur ersetzt oder gelöscht, und er wird in allem geschwärzt, was ein Bot sagt und tut. Er kann so nicht in
einer Antwort oder im Verlauf landen. Auf der Festplatte liegt der Tresor verschlüsselt.

## 40. Ende-zu-Ende-Verschlüsselung

Alles zwischen deinen Geräten und deinen Rechnern ist Ende-zu-Ende-verschlüsselt, vom ersten Start an: Chats,
Dateien, Verlauf, der Abgleich zwischen den Rechnern. Das Relay in der Mitte reicht nur weiter, was es nicht lesen
kann, und speichert keine Nachrichten.

Die Anmeldungen deiner KI-Anbieter verlassen deine Rechner nie. Wer das Relay betreibt, auch du selbst auf einem
gemieteten Server, kann keinen Chat lesen und deine Abos nicht nutzen.

## 41. Geräte und Anmeldung

Ein neues Gerät kommt mit einem Kopplungslink oder QR-Code dazu, den ein schon angemeldetes Gerät erzeugt. Der Link
gilt einmal, 15 Minuten lang, und übergibt auch den Schlüssel. Es geht auch andersherum: Ein angemeldetes Handy
scannt den QR-Code auf der Anmeldeseite eines neuen Laptops.

Jedes Gerät hat seinen eigenen Schlüssel und lässt sich einzeln abmelden. Jede neue Anmeldung löst eine
Benachrichtigung aus, und ein zweiter Faktor (TOTP) lässt sich einschalten.

## 42. Connectoren

Die Dienste, die mit deinem Claude-Konto verbunden sind, etwa Gmail oder Drive, sind mächtig, und nicht jeder Bot
soll sie erreichen. Sie bleiben den Bots verschlossen, bis du sie zulässt, je Rechner, in dessen Einstellungen.

Werkzeuge, die du selbst für ein Projekt eingerichtet hast, funktionieren wie bisher. Jeder Aufruf eines externen
Dienstes fragt in der Standard-Stufe vorher nach einer Freigabe, und „Immer für diesen Bot“ merkt sich deine
Antwort.

## 43. Melden

„Melden“ im Menü einer Bot-Antwort oder der Nachricht einer Person schickt sie mit einem Grund an die Admins deines
Relays. Gibt es keinen weiteren Admin, geht die Meldung an den Herausgeber der App.

Das zählt dort, wo sich mehrere Menschen eine Installation teilen: Etwas, das nicht hätte geschrieben werden sollen,
erreicht jemanden, der handeln kann.

## 44. Apps für jedes Gerät

Überall dieselbe App: im Browser, installierbar auf dem Startbildschirm; als Desktop-App für Windows, macOS und
Linux; und als App für iOS und Android. Was du auf dem Handy siehst, siehst du auch am Schreibtisch.

Die Desktop-App bringt alles mit. Installieren, „Ohne Setup“ wählen, und sie lässt deine Bots auf diesem
Computer laufen, ohne Terminal, und aktualisiert sich selbst. Die Mobile-Apps bringen native Benachrichtigungen mit
und legen den Schlüssel im sicheren Speicher des Handys ab.

Die Oberfläche gibt es auf Deutsch und Englisch.

## 45. Drei Wege, es zu betreiben

Auf einem Computer: Desktop-App installieren und loslegen. Mehr braucht es nicht, und alles bleibt auf diesem
Rechner.

Mit einem eigenen Relay auf einem kleinen Server: Dein Handy erreicht deine Bots von überall, Benachrichtigungen
kommen an, und schlafende Rechner lassen sich wecken. Deine Rechner verbinden sich nach außen, am Router muss also
nichts geöffnet werden.

Ganz auf einem Server: Bots, die laufen, während alle deine Computer aus sind. Für alle drei Wege gilt dieselbe
Regel: Das Relay reicht verschlüsselte Daten weiter, und Sessions, Verlauf und Anmeldungen bleiben auf den Rechnern,
auf denen die Bots laufen.

## 46. Open Source

OpenFolk ist Open Source unter der MIT-Lizenz. Du darfst es nutzen, ändern und weitergeben, auch in eigenen
Produkten. Es gibt kein Konto bei uns und kein Abo bei uns, und deine Chats bleiben auf deinen eigenen Rechnern.

Der Code liegt auf GitHub unter [OpenFolk/OpenFolk](https://github.com/OpenFolk/OpenFolk). Fehler, Ideen und
Beiträge sind dort willkommen.
