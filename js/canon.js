// Der Kanon: die einzige Wahrheit einer Geschichte. Aenderungen werden hier
// deterministisch eingespielt, nicht von der KI "frei" umgeschrieben.

export function slugify(s) {
  return (s || 'geschichte')
    .toLowerCase()
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/ß/g, 'ss')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 50) || 'geschichte';
}

export function kanonAusWelt(welt, opts) {
  return {
    meta: {
      titel: welt.titel,
      logline: welt.logline,
      genre: welt.genre,
      ton: welt.ton,
      stil: welt.stil,
      sprache: opts.sprache || 'Deutsch',
      erstellt: new Date().toISOString(),
    },
    welt: welt.welt,
    machtsystem: welt.machtsystem,
    handlungsbogen: welt.handlungsbogen,
    startzeit: welt.startzeit,
    zeit: welt.startzeit,
    figuren: welt.figuren.map((f) => ({ ...f, ersterAuftritt: 0, letzteAenderung: 0 })),
    orte: welt.orte,
    fraktionen: welt.fraktionen,
    gegenstaende: welt.gegenstaende,
    techniken: welt.techniken,
    zeitleiste: welt.vorgeschichte.map((e, i) => ({
      id: `e-0-${i + 1}`,
      kapitel: 0,
      weltzeit: e.weltzeit,
      ort: e.ort,
      figuren: [],
      ereignis: e.ereignis,
      folgen: '',
    })),
    faeden: welt.faeden.map((f) => ({ ...f, eingefuehrt: 0, status: 'offen', aufloesung: '' })),
    fakten: welt.fakten.map((t) => ({ kapitel: 0, text: t })),
    kapitel: [],
    stimmen: { erzaehler: {}, figuren: {} },
  };
}

function findeNachIdOderName(liste, id) {
  if (!id) return null;
  const n = id.toLowerCase();
  return (
    liste.find((x) => x.id === id) ||
    liste.find((x) => (x.name || '').toLowerCase() === n) ||
    null
  );
}

function fuegeEin(liste, neue, nr) {
  let n = 0;
  for (const e of neue || []) {
    const vorhanden = findeNachIdOderName(liste, e.id) || findeNachIdOderName(liste, e.name);
    if (vorhanden) {
      Object.assign(vorhanden, e, { id: vorhanden.id, letzteAenderung: nr });
    } else {
      liste.push({ ...e, ersterAuftritt: nr, letzteAenderung: nr });
      n++;
    }
  }
  return n;
}

// Spielt die Aenderungen eines Kapitels in den Kanon ein. Gibt ein Protokoll zurueck.
export function wendeDeltaAn(kanon, delta, nr, titel, woerter) {
  const log = [];
  const k = kanon;
  k.figuren ||= [];
  k.orte ||= [];
  k.fraktionen ||= [];
  k.gegenstaende ||= [];
  k.techniken ||= [];
  k.zeitleiste ||= [];
  k.faeden ||= [];
  k.fakten ||= [];
  k.kapitel ||= [];

  const neuF = fuegeEin(k.figuren, delta.neue_figuren, nr);
  if (neuF) log.push(`${neuF} neue Figur(en)`);
  for (const u of delta.figuren_updates || []) {
    const f = findeNachIdOderName(k.figuren, u.id);
    if (!f) continue;
    f[u.feld] = u.wert;
    f.letzteAenderung = nr;
    log.push(`${f.name}: ${u.feld} → ${u.wert}`);
  }
  for (const b of delta.beziehungen || []) {
    const f = findeNachIdOderName(k.figuren, b.von);
    if (!f) continue;
    f.beziehungen ||= [];
    const alt = f.beziehungen.find((x) => x.zu === b.zu);
    if (alt) alt.art = b.art;
    else f.beziehungen.push({ zu: b.zu, art: b.art });
  }
  const neuO = fuegeEin(k.orte, delta.neue_orte, nr);
  if (neuO) log.push(`${neuO} neue(r) Ort(e)`);
  fuegeEin(k.fraktionen, delta.neue_fraktionen, nr);
  fuegeEin(k.gegenstaende, delta.neue_gegenstaende, nr);
  for (const u of delta.gegenstand_updates || []) {
    const g = findeNachIdOderName(k.gegenstaende, u.id);
    if (!g) continue;
    if (u.besitzer) g.besitzer = u.besitzer;
    if (u.ort) g.ort = u.ort;
    g.letzteAenderung = nr;
  }
  fuegeEin(k.techniken, delta.neue_techniken, nr);

  (delta.ereignisse || []).forEach((e, i) =>
    k.zeitleiste.push({ id: `e-${nr}-${i + 1}`, kapitel: nr, ...e })
  );
  if (delta.ereignisse?.length) log.push(`${delta.ereignisse.length} Ereignis(se) in der Zeitleiste`);
  for (const t of delta.neue_fakten || []) k.fakten.push({ kapitel: nr, text: t });
  for (const f of delta.neue_faeden || [])
    if (!k.faeden.some((x) => x.id === f.id))
      k.faeden.push({ ...f, eingefuehrt: nr, status: 'offen', aufloesung: '' });
  for (const g of delta.geloeste_faeden || []) {
    const f = k.faeden.find((x) => x.id === g.id);
    if (f) {
      f.status = 'gelöst';
      f.aufloesung = g.aufloesung;
      f.geloestIn = nr;
      log.push(`Faden gelöst: ${f.beschreibung}`);
    }
  }

  const eintrag = {
    nr,
    titel,
    weltzeit: delta.weltzeit_ende,
    zusammenfassung: delta.zusammenfassung,
    woerter,
  };
  const idx = k.kapitel.findIndex((x) => x.nr === nr);
  if (idx >= 0) k.kapitel[idx] = eintrag;
  else k.kapitel.push(eintrag);
  k.zeit = delta.weltzeit_ende || k.zeit;
  return log;
}

// --- Lesbare Markdown-Dateien fuer GitHub ---------------------------------

const name = (kanon, id) =>
  kanon.figuren?.find((f) => f.id === id)?.name ||
  kanon.orte?.find((o) => o.id === id)?.name ||
  id;

export function zeitleisteMd(kanon) {
  const zeilen = [`# Zeitleiste – ${kanon.meta.titel}`, '', `Aktuelle Weltzeit: **${kanon.zeit}**`, ''];
  let kap = null;
  for (const e of kanon.zeitleiste) {
    if (e.kapitel !== kap) {
      kap = e.kapitel;
      zeilen.push('', kap === 0 ? '## Vorgeschichte' : `## Kapitel ${kap}`, '');
    }
    const wer = (e.figuren || []).map((f) => name(kanon, f)).join(', ');
    zeilen.push(
      `- **${e.weltzeit}** · ${name(kanon, e.ort) || '?'}${wer ? ` · ${wer}` : ''}  \n  ${e.ereignis}${e.folgen ? `  \n  _Folgen:_ ${e.folgen}` : ''}`
    );
  }
  return zeilen.join('\n') + '\n';
}

export function figurenMd(kanon) {
  const z = [`# Figuren – ${kanon.meta.titel}`, ''];
  for (const f of kanon.figuren) {
    z.push(
      `## ${f.name}${f.alias ? ` („${f.alias}")` : ''}`,
      '',
      `- **Rolle:** ${f.rolle}`,
      `- **Status:** ${f.status} · **Ort:** ${name(kanon, f.ort)} · **Stufe:** ${f.stufe}`,
      `- **Alter:** ${f.alter}`,
      `- **Aussehen:** ${f.aussehen}`,
      `- **Persönlichkeit:** ${f.persoenlichkeit}`,
      `- **Sprechweise:** ${f.sprechweise}`,
      `- **Ziel / Bedürfnis / Wunde:** ${f.ziel} / ${f.beduerfnis} / ${f.wunde}`,
      `- **Geheimnis:** ${f.geheimnis}`,
      `- **Bogen:** ${f.bogen}`,
      `- **Stimme:** ${f.stimme}`,
      `- **Beziehungen:** ${(f.beziehungen || []).map((b) => `${name(kanon, b.zu)} (${b.art})`).join('; ')}`,
      `- _Erster Auftritt: Kapitel ${f.ersterAuftritt ?? 0}, zuletzt geändert: Kapitel ${f.letzteAenderung ?? 0}_`,
      ''
    );
  }
  return z.join('\n');
}

export function weltMd(kanon) {
  const z = [`# ${kanon.meta.titel}`, '', `> ${kanon.meta.logline}`, '', `**Genre:** ${kanon.meta.genre} · **Ton:** ${kanon.meta.ton}`, '', '## Welt', kanon.welt.beschreibung, ''];
  kanon.welt.regeln.forEach((r) => z.push(`- ${r}`));
  z.push('', `## Machtsystem: ${kanon.machtsystem.name}`, kanon.machtsystem.beschreibung, '');
  kanon.machtsystem.stufen.forEach((s, i) => z.push(`${i + 1}. **${s.name}** – ${s.beschreibung}`));
  z.push('');
  kanon.machtsystem.regeln.forEach((r) => z.push(`- ${r}`));
  z.push('', '## Orte', '');
  kanon.orte.forEach((o) => z.push(`- **${o.name}** (${o.typ}, ${o.lage}): ${o.beschreibung}`));
  z.push('', '## Fraktionen', '');
  kanon.fraktionen.forEach((f) => z.push(`- **${f.name}** (${f.ausrichtung}): ${f.beschreibung}`));
  z.push('', '## Gegenstände', '');
  kanon.gegenstaende.forEach((g) => z.push(`- **${g.name}** – Besitzer: ${name(kanon, g.besitzer)}, Ort: ${name(kanon, g.ort)}. ${g.beschreibung}`));
  z.push('', '## Techniken', '');
  kanon.techniken.forEach((t) => z.push(`- **${t.name}** (${t.stufe}, Nutzer: ${name(kanon, t.nutzer)}): ${t.beschreibung} _Kosten:_ ${t.kosten}`));
  z.push('', '## Harte Fakten', '');
  kanon.fakten.forEach((f) => z.push(`- [Kap. ${f.kapitel}] ${f.text}`));
  z.push('', '## Handlungsfäden', '');
  kanon.faeden.forEach((f) => z.push(`- ${f.status === 'offen' ? '◻' : '✅'} ${f.beschreibung}${f.aufloesung ? ` → ${f.aufloesung}` : ''}`));
  z.push('', '## Kapitel', '');
  kanon.kapitel.forEach((k) => z.push(`${k.nr}. **${k.titel}** (${k.weltzeit}) – ${k.zusammenfassung}`));
  return z.join('\n') + '\n';
}
