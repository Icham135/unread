// Story-Daten: 1:1 aus der Twine-Datei übernommen (Texte unverändert).
// Knoten: m = Mikes Nachrichten, photo = Foto danach, set = Merker setzen,
// wait = Sekunden Pause (Mike offline), offline = Mike offline bei den Antworten,
// c = Antworten (Funktion bekommt die Merker f), end = Ende des bisherigen Stands.
// Sprachmemos von Mike (Aufnahmen in audio/memo-<name>.mp3, sec = Länge in Sekunden)
const MEMO = {
  flur: { name: 'flur', sec: 13, text: 'Okay… ich steh im Flur. Ich bleib jetzt mal zehn Sekunden still. (Pause) Hörst du das? … Nein. Doch. … Nee. Ich glaube, das ist nur das Haus. Alter, mein Herz rast.' },
  treppe: { name: 'treppe', sec: 16, text: 'Ich geh jetzt hoch. Die Treppe knarzt wie verrückt, ich versuch leise zu sein. (Pause) Wer baut bitte ein Haus ohne Hintertür? … Egal. Ich schau oben nach einem Fenster. Wenn du nichts mehr von mir hörst, dann… nein. Quatsch. Bis gleich.' },
  ticken: { name: 'ticken', sec: 17, text: 'Ich hab’s gehört. Das ist nicht das Haus. (Pause) Das ist ein Ticken. Wie eine Uhr, aber… zu gleichmässig. Es kommt von hinter der Tür am Ende des Gangs. (Pause) Ich geh kurz nachschauen. Sag Sarah… nein. Ich bin gleich zurück.' }
};
window.STORY = {
  start: 'start',
  nodes: {
    start: { m: ['Bro, ich bin drin.', 'Das ist echt verrückt hier.'], c: () => [
      ['Wer ist da und warum schreibst du mir?', 'wer'],
      ['Was meinst du mit "ich bin drin"? Wo bist du??', 'wo']] },
    wer: { m: ['Ist das dein Ernst?', 'Ich bin es, Mike.', 'Dein bester Freund...'], c: () => [
      ['Tut mir leid, hab ein neues Smartphone, wo bist du?', 'wo']] },
    wo: { m: ["Ich bin im alten Miller's Haus. Das ist echt gruslig hier."], photo: 'haus', c: () => [
      ['Was machst du da drin?', 'wieso'],
      ['Alter, das ist echt krass', 'krass']] },
    wieso: { m: ['Du weisst doch, dass die krass reich waren. Vielleicht finde ich noch was Wertvolles.'], c: () => [
      ['Was ist mit den Besitzern?', 'besitzer'],
      ['Klingt gut, aber sei vorsichtig', 'legLos']] },
    krass: { m: ['Das kannst du laut sagen.', 'Zeit die Bude auszuräumen.'], c: () => [
      ['Alter, was wenn dich jemand sieht?', 'besitzer'],
      ['Klingt gut, aber sei vorsichtig', 'legLos']] },
    besitzer: { m: ['Die Familie wird bereits seit über zwei Monaten vermisst.', 'Und bis vor kurzem ging hier die Polizei ein und aus.', 'Bestimmt war hier vor mir noch niemand.', 'Zeit das auszunutzen.'], c: () => [
      ['Ich denke du solltest da verschwinden. Hab ein Ungutes Gefühl', 'keineGuteIdee'],
      ['Klingt gut, aber sei vorsichtig', 'legLos']] },
    keineGuteIdee: { m: ['Du weisst, ich kann das Geld gebrauchen.', 'Sarah kriegt bald unser Baby und ich will ihr was bieten können'], c: () => [
      ['Sei einfach vorsichtig okay', 'legLos'],
      ['Was wenn du erwischt wirst? Dann kannst du Sarah garnichts bieten', 'horAuf']] },
    horAuf: { m: ['Ist das dein Ernst? Ich hab gewusst, dass ich dir nicht hätte schreiben sollen.', 'Dann behalte ich halt die ganze Beute für mich.', 'Ich durchsuche das Wohnzimmer. Melde mich vielleicht später wieder.'], offline: true, c: () => [
      ['Ich mache mir einfach Sorgen um dich', 'wohnzimmerSauber']] },
    legLos: { m: ['Soll ich mir zuerst die Küche oder das Wohnzimmer reinziehen?'], c: () => [
      ['Durchsuche das Wohnzimmer', 'wohnzimmer'],
      ['Durchsuche die Küche', 'kueche']] },
    wohnzimmer: { m: ['Also. Gib mir ein paar Minuten. Ich melde mich wieder bei dir.'], wait: 10, next: 'wohnzimmerSauber' },
    wohnzimmerSauber: { m: ['Irgendetwas stimmt hier nicht. Da ist alles so sauber. Sollte das nicht voller Staub sein?'], set: 'wohnz', c: () => [
      ['Kannst du mir ein Bild vom Wohnzimmer senden?', 'bildWohnzimmer'],
      ['Vielleicht war das die Polizei. Such nach was Wertvollem', 'weitermachen']] },
    bildWohnzimmer: { m: [], photo: 'wohnzimmer', c: () => [
      ['Hast du dir den Schrank angesehen?', 'schrank'],
      ['Ist das ein Gemälde der Familie? Echt creepy', 'portraet']] },
    portraet: { m: ['Ja, das Teil ist übelst gruselig.', 'Sieht aus wie ein Bild aus dem Mittelalter'], c: () => [
      ['Hast du dir den Schrank daneben angesehen?', 'schrank'],
      ['Ist dir abgesehen vom Staub sonst noch was aufgefallen?', 'nachfrage']] },
    nachfrage: { m: ['Nichts besonderes. Nur... was ich komisch finde, ist dass der Fernseher umgedreht wurde.', 'Der Bilschirm zeigt gegen die wand und nicht gegen das Sofa.'], c: () => [
      ['Das muss nichts zu bedeuten haben. Such weiter', 'schrank'],
      ['Am besten fässt du nichts an. Durchsuche mal die Küche', 'kueche']] },
    schrank: { m: f => f.schrank
        ? ['Der Schrank steht noch offen.', 'Die Murmeln liegen überall auf dem Boden.']
        : ['Ach du Scheisse!', 'Das war echt abgefuckt.', 'DA WAR ALLES VOLLER MURMELN.', 'Als ich den Schrank geöffnet habe, sind alle rausgefallen.', 'Fuck, das war ein Riesenkrach.'],
      set: 'schrank', c: () => [
      ['Verschwinde besser von da. Es könnte sein, dass dich jemand gehört hat', 'flucht'],
      ['Untersuche den Schrank', 'schrankUnters']] },
    schrankUnters: { m: ['Da war ein kleiner schwarzer Schlüssel drin.', 'Ich nehme ihn mit.', 'Was nun?'], set: 'schluessel', c: f => [
      f.kueche ? ['Gehe weiter. Jetzt bist du ja sowieso schon da', 'weitergehen'] : ['Schau dir mal die Küche an', 'kueche'],
      ['Verschwinde am besten vorerst aus diesem Haus', 'flucht']] },
    weitermachen: { m: ['Vermutlich hast du recht. Ich mache wohl zu viele Gedanken.', 'Was soll ich als nächstes tun?'], c: f => [
      ['Durchsuche die Dekorationen nach etwas Wertvollem', 'deko'],
      ...(f.kueche ? [] : [['Sieht es in der Küche auch so aus?', 'kueche']])] },
    deko: { m: ['Da ist nichts. Nur wertlose Gegenstände und Fotos.', 'Zieh dir das rein:'], photo: 'deko', c: f => [
      ['Ist das ein Familienfoto der Millers?', 'portraet'],
      f.kueche ? ['Hast du dir den Schrank daneben angesehen?', 'schrank'] : ['Echt furchteinflössend. Durchsuche die Küche', 'kueche']] },
    kueche: { m: ['Also. Gib mir ein paar Minuten. Ich melde mich wieder bei dir.', 'Der Scheiss ist echt eklig. Stinkt überall nach verdorbenem Essen.'], set: 'kueche', c: f => [
      f.wohnz ? ['Geh besser wo anders hin', 'weitergehen'] : ['Geh ins Wohnzimmer', 'wohnzimmerSauber'],
      ['Weisst du woher der Geruch kommt?', 'geruch']] },
    geruch: { m: ['Ich glaube das kommt aus dem Kühlschrank.'], c: () => [
      ['Öffne den Kühlschrank', 'kuehlOffen'],
      ['An deiner Stelle würde ich den Kühlschrank nicht öffnen', 'kuehlZu']] },
    kuehlZu: { m: ['Du hast wahrscheinlich recht. Bestimmt ist da eine Menge verdorbenes Zeugs drin.', 'Was soll ich nun tun?'], c: () => [
      ['Ist in den Schränken was?', 'schraenke'],
      ['Du könntest weiter nach was wertvollem suchen.', 'weitergehen']] },
    kuehlOffen: { m: ['Fuck mann. Das kann nicht wahr sein.', 'Da ist ein totes Tier drin.', 'Es ist alles voller Blut!', 'Ein beschissener geköpfter Rabe.'], c: () => [
      ['Verschwinde aus diesem Haus!', 'flucht'],
      ['Bleib ruhig. Vielleicht haben sich Kinder aus der Nachbarschaft ein Streich erlaubt.', 'ruhig']] },
    ruhig: { m: ['Weisst du wie abgefuckt das ist?!', 'Na schön. Was soll ich tun?'], c: f => f.wohnz
      ? [['Such weiter nach was Wertvollem', 'weitergehen'], ['Ist in den Schränken in der Küchewas?', 'schraenke']]
      : [['Geh ins Wohnzimmer', 'wohnzimmerSauber'], ['Such weiter nach was Wertvollem', 'weitergehen']] },
    schraenke: { m: ['Ich schaus mir an.', 'Nur ein paar Gabeln und Küchengeräte. Nichts von Wert.'], c: f => f.wohnz
      ? [['Such weiter nach was Wertvollem', 'weitergehen'], ['An deiner Stelle würde ich das Gebäude verlassen', 'flucht']]
      : [['Geh ins Wohnzimmer', 'wohnzimmerSauber'], ['Such weiter nach was Wertvollem', 'weitergehen']] },
    flucht: { m: ['Vielleicht besser.', 'Alter. Du wirst mir nicht glauben. Die verdamte Tür lässt sich nicht mehr öffnen.'], c: () => [
      ['Wie bist du denn reingekommen?', 'polizeiband'],
      ['Gibt es einen anderen Weg raus?', 'ausweg']] },
    polizeiband: { m: ['Die Tür war offen. Nur das Polizeiband war davor.'], c: () => [
      ['Vermutlich hat sie sich automatisch verriegelt, als du sie hinter dir geschlossen hast.', 'verriegelt'],
      ['Denkst du da ist jemand im Haus?', 'jemand']] },
    verriegelt: { m: ['Das kann sein.', 'Es muss einen anderen Weg raus geben.', 'Vielleicht über die Hintertür?', 'Oder die Fenster?'], c: () => [
      ['Überprüfe die Fenster', 'fenster'],
      ['Überprüfe die Hintertür', 'hintertuer']] },
    jemand: { m: ['Das kann fast nicht sein. Ich hätte es bemerkt, wenn eine Person an mir vorbeigegangen wäre.', 'Ich habe ein echt mulmiges Gefühl.', 'Soll ich einen anderen Ausweg suchen, oder weitergehen?'], memo: MEMO.flur, c: () => [
      ['Ich würde einen Ausweg suchen', 'ausweg'],
      ['Gehe weiter. Jetzt bist du ja sowieso schon da', 'weitergehen']] },
    ausweg: { m: ['Ich weiss nicht. Vielleicht über die Hintertür?', 'Oder die Fenster?'], c: () => [
      ['Überprüfe die Fenster', 'fenster'],
      ['Überprüfe die Hintertür', 'hintertuer']] },
    fenster: { m: ['Scheisse. Hier unten sind alle verbarrikadiert.', 'Das muss die Polizei gemacht haben.', 'Denkst du im zweiten Stock oder im Keller hat es noch Fenster die sich öffnen lassen?'], c: () => [
      ['Ich würde in den zweiten Stock gehen', 'kerzen', 'og'],
      ['Vielleicht ist ein Kellerfenster noch offen', 'kerzen', 'keller']] },
    hintertuer: { m: ['Scheisse. Es gibt hier gar keine Hintertür. Am Ende des Ganges ist garnichts.', 'Ich überprüfe den zweiten Stock nach einem Ausgang.', 'Ich halte dich auf dem Laufenden.'], memo: MEMO.treppe, wait: 10, next: 'kerzen', floor: 'og' },
    weitergehen: { m: ['Hmm okay. Du hast recht.', 'Was soll ich mir als nächstes anschauen?'], c: f => [
      ['Gehe in den Keller', 'kerzen', 'keller'],
      ['Gehe in den zweiten Stock', 'kerzen', 'og'],
      ...(f.kueche ? [] : [['Gehe in die Küche', 'kueche']])] },
    kerzen: { m: ['Ich dachte die Bude sei seit Wochen verlassen.', 'Wieso zur Hölle brennen hier kerzen?!'], photo: 'kerzen', c: () => [
      ['Geh da sofort wieder raus alter!', 'bleiben'],
      ['Hörst du etwas?', 'geraeusch']] },
    geraeusch: { m: ['Du hast recht, da ist was. Es klingt mechanisch.'], memo: MEMO.ticken, end: true },
    bleiben: { m: ['Relax, das waren bestimmt nur ein paar Obdachlose. Ich geh weiter rein.'], memo: MEMO.ticken, end: true }
  }
};
