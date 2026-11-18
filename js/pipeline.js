// Ablauf: Welt bauen -> Kapitel planen -> schreiben -> pruefen & korrigieren -> Kanon fortschreiben -> speichern
import { jsonAnfrage, textAnfrage } from './claude.js';
import * as P from './prompts.js';
import { weltSchema, planSchema, pruefSchema, deltaSchema } from './schemas.js';
import { kanonAusWelt, wendeDeltaAn, slugify, zeitleisteMd, figurenMd, weltMd } from './canon.js';
import { lokal, aufGithub, einstellungen } from './store.js';
import { stimmenZuweisen } from './audio.js';

function mdDateien(kanon) {
  return [
    { pfad: 'WELT.md', inhalt: weltMd(kanon) },
    { pfad: 'FIGUREN.md', inhalt: figurenMd(kanon) },
    { pfad: 'ZEITLEISTE.md', inhalt: zeitleisteMd(kanon) },
  ];
}

export async function speichern(g, nachricht, nurKapitel, status) {
  await lokal.speichere(g);
  try {
    const sha = await aufGithub(g, mdDateien(g.kanon), nachricht, nurKapitel);
    if (sha) status?.(`Auf GitHub gespeichert (${sha.slice(0, 7)}).`);
  } catch (e) {
    status?.(`⚠ GitHub-Speichern fehlgeschlagen: ${e.message} – lokal ist alles gesichert.`);
  }
}

export async function neueGeschichte(opts, status) {
  status('Ich entwerfe Welt, Machtsystem und Figuren …');
  const p = P.weltenbauPrompt(opts);
  const { daten: welt } = await jsonAnfrage({
    system: p.system,
    user: p.user,
    schema: weltSchema,
    effort: 'high',
  });
  const kanon = kanonAusWelt(welt, opts);
  kanon.meta.laenge = opts.laenge || 3000;
  stimmenZuweisen(kanon);
  let slug = slugify(welt.titel);
  const vorhanden = new Set((await lokal.alle()).map((g) => g.slug));
  for (let i = 2; vorhanden.has(slug); i++) slug = `${slugify(welt.titel)}-${i}`;
  const g = { slug, kanon, kapitel: [] };
  await speichern(g, `Neue Geschichte: ${welt.titel}`, [], status);
  return g;
}

export async function naechstesKapitel(g, wunsch, status, onText) {
  const nr = (g.kapitel.at(-1)?.nr || 0) + 1;
  const laenge = g.kanon.meta.laenge || einstellungen().laenge || 3000;
  const system = P.systemPrompt(g.kanon);

  status(`Kapitel ${nr}: Plan wird erstellt …`);
  const { daten: plan } = await jsonAnfrage({
    system,
    user: P.planPrompt(g, nr, wunsch, laenge),
    schema: planSchema,
    effort: 'high',
  });
  status(`Kapitel ${nr}: „${plan.titel}" wird geschrieben …`, plan);

  const { text: roh } = await textAnfrage(
    { system, user: P.schreibPrompt(g, nr, plan, laenge), effort: 'high', maxTokens: 64000 },
    onText
  );
  let text = roh.trim();

  status(`Kapitel ${nr}: Kontinuitätsprüfung …`, plan);
  const { daten: pruef } = await jsonAnfrage({
    system,
    user: P.pruefPrompt(text),
    schema: pruefSchema,
    effort: 'high',
  });
  const korrekturen = [];
  for (const pr of pruef.probleme) {
    if (pr.zitat && text.includes(pr.zitat) && pr.ersatz !== pr.zitat) {
      text = text.replace(pr.zitat, pr.ersatz);
      korrekturen.push(pr);
    }
  }
  onText?.(text);

  status(`Kapitel ${nr}: Kanon wird fortgeschrieben …`, plan);
  const { daten: delta } = await jsonAnfrage({
    system,
    user: P.deltaPrompt(text, nr),
    schema: deltaSchema,
    effort: 'medium',
  });
  const woerter = text.split(/\s+/).length;
  const log = wendeDeltaAn(g.kanon, delta, nr, plan.titel, woerter);
  stimmenZuweisen(g.kanon);
  g.kapitel.push({ nr, titel: plan.titel, text, plan, korrekturen });

  status(`Kapitel ${nr}: wird gespeichert …`, plan);
  await speichern(g, `Kapitel ${nr}: ${plan.titel}`, [nr], status);
  return { nr, plan, korrekturen, log };
}
