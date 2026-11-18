// JSON-Schemas fuer die strukturierten Antworten von Claude.
// Strikte Schemas: jedes Objekt hat additionalProperties:false und alle Felder required.

const S = { type: 'string' };
const I = { type: 'integer' };
const arr = (items) => ({ type: 'array', items });
const obj = (properties) => ({
  type: 'object',
  properties,
  required: Object.keys(properties),
  additionalProperties: false,
});

const beziehung = obj({ zu: S, art: S });

export const figurSchema = obj({
  id: S,
  name: S,
  alias: S,
  rolle: S,
  geschlecht: { type: 'string', enum: ['m', 'w', 'd'] },
  alter: S,
  aussehen: S,
  persoenlichkeit: S,
  sprechweise: S,
  wunde: S,
  ziel: S,
  beduerfnis: S,
  geheimnis: S,
  bogen: S,
  stufe: S,
  status: S,
  ort: S,
  beziehungen: arr(beziehung),
  stimme: S,
});

const ortSchema = obj({ id: S, name: S, typ: S, lage: S, beschreibung: S, sinneseindruecke: S });
const fraktionSchema = obj({ id: S, name: S, ausrichtung: S, beschreibung: S, anfuehrer: S, sitz: S });
const gegenstandSchema = obj({ id: S, name: S, beschreibung: S, besitzer: S, ort: S });
const technikSchema = obj({ id: S, name: S, beschreibung: S, nutzer: S, stufe: S, kosten: S });
const fadenSchema = obj({ id: S, beschreibung: S });

export const weltSchema = obj({
  titel: S,
  logline: S,
  genre: S,
  ton: S,
  stil: S,
  welt: obj({ beschreibung: S, regeln: arr(S) }),
  machtsystem: obj({
    name: S,
    beschreibung: S,
    stufen: arr(obj({ name: S, beschreibung: S })),
    regeln: arr(S),
  }),
  figuren: arr(figurSchema),
  orte: arr(ortSchema),
  fraktionen: arr(fraktionSchema),
  gegenstaende: arr(gegenstandSchema),
  techniken: arr(technikSchema),
  vorgeschichte: arr(obj({ weltzeit: S, ort: S, ereignis: S })),
  startzeit: S,
  handlungsbogen: obj({ gesamtziel: S, akte: arr(obj({ titel: S, inhalt: S })) }),
  faeden: arr(fadenSchema),
  fakten: arr(S),
});

export const planSchema = obj({
  titel: S,
  weltzeit_beginn: S,
  weltzeit_ende: S,
  perspektive: S,
  ziel_des_kapitels: S,
  szenen: arr(
    obj({
      ort: S,
      figuren: arr(S),
      was_passiert: S,
      emotionaler_kern: S,
      bildmoment: S,
    })
  ),
  cliffhanger: S,
  zu_beachten: arr(S),
});

export const pruefSchema = obj({
  probleme: arr(
    obj({
      art: {
        type: 'string',
        enum: ['widerspruch', 'zeit', 'ort', 'macht', 'figur', 'format', 'stil'],
      },
      beschreibung: S,
      zitat: S,
      ersatz: S,
    })
  ),
});

const FIGUR_FELDER = [
  'name', 'alias', 'rolle', 'alter', 'aussehen', 'persoenlichkeit', 'sprechweise',
  'wunde', 'ziel', 'beduerfnis', 'geheimnis', 'bogen', 'stufe', 'status', 'ort', 'stimme',
];

export const deltaSchema = obj({
  zusammenfassung: S,
  weltzeit_ende: S,
  ereignisse: arr(obj({ weltzeit: S, ort: S, figuren: arr(S), ereignis: S, folgen: S })),
  neue_figuren: arr(figurSchema),
  figuren_updates: arr(obj({ id: S, feld: { type: 'string', enum: FIGUR_FELDER }, wert: S })),
  beziehungen: arr(obj({ von: S, zu: S, art: S })),
  neue_orte: arr(ortSchema),
  neue_fraktionen: arr(fraktionSchema),
  neue_gegenstaende: arr(gegenstandSchema),
  gegenstand_updates: arr(obj({ id: S, besitzer: S, ort: S })),
  neue_techniken: arr(technikSchema),
  neue_fakten: arr(S),
  neue_faeden: arr(fadenSchema),
  geloeste_faeden: arr(obj({ id: S, aufloesung: S })),
});

