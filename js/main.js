import { einstellungen, speichereEinstellungen, lokal, githubAktiv, githubListe, vonGithub } from './store.js';
import { neueGeschichte, naechstesKapitel, speichern } from './pipeline.js';
import { GENRES } from './prompts.js';
import { MODELLE } from './claude.js';
import { zerlege, Player, OPENAI_STIMMEN, browserStimmen, stimmenZuweisen, kapitelAlsMp3 } from './audio.js';

const app = document.getElementById('app');
const esc = (s) =>
  String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
const $ = (sel, el = document) => el.querySelector(sel);
const $$ = (sel, el = document) => [...el.querySelectorAll(sel)];

function farbe(name) {
  let h = 0;
  for (const c of name || '') h = (h * 37 + c.charCodeAt(0)) % 360;
  return `hsl(${h} 55% 58%)`;
}

// ---------------------------------------------------------------- Darstellung
function wendeLeseEinstellungenAn() {
  const e = einstellungen();
  document.documentElement.dataset.theme = e.thema || 'dunkel';
  document.documentElement.style.setProperty('--schrift', `${e.schrift || 1.15}rem`);
}
wendeLeseEinstellungenAn();

// ---------------------------------------------------------------- Laufender Auftrag
// Die Erzeugung laeuft weiter, auch wenn man die Ansicht wechselt.
const auftrag = { slug: null, status: '', live: '', fehler: false, laeuft: false };

function zeigeAuftrag() {
  const box = $('#auftrag');
  if (!box) return;
  if (!auftrag.status) {
    box.innerHTML = '';
    return;
  }
  box.innerHTML = `<div class="status ${auftrag.fehler ? 'fehler' : ''}">${esc(auftrag.status)}</div>
    ${auftrag.live ? `<details ${auftrag.laeuft ? 'open' : ''}><summary>Live-Text</summary><div class="lesen live klein">${esc(auftrag.live).replace(/\n/g, '<br>')}</div></details>` : ''}`;
  const live = $('.live', box);
  if (live) live.scrollTop = live.scrollHeight;
  $$('[data-gen]').forEach((b) => (b.disabled = auftrag.laeuft));
}

// ---------------------------------------------------------------- Player
const playerEl = $('#player');
const player = new Player({
  onSegment(i, seg, pausiert) {
    $$('.seg.aktiv').forEach((x) => x.classList.remove('aktiv'));
    $('#pl-play').textContent = player.laeuft && !pausiert ? '⏸' : '▶';
    if (i < 0) return;
    const el = $(`.seg[data-i="${i}"]`);
    if (el) {
      el.classList.add('aktiv');
      if (player.laeuft) el.scrollIntoView({ behavior: 'smooth', block: 'center' });
    }
    $('#pl-sprecher').textContent = seg?.name ? seg.name : seg?.typ === 'titel' ? 'Titel' : 'Erzähler';
    $('#pl-status').textContent = seg?.regie || '';
  },
  onStatus(t) {
    $('#pl-status').textContent = t;
    $('#pl-play').textContent = '▶';
  },
  onEnde() {
    $('#pl-play').textContent = '▶';
    if (player.naechstesHref && einstellungen().autoWeiter !== false) {
      sessionStorage.setItem('autoplay', '1');
      location.hash = player.naechstesHref;
    }
  },
});
$('#pl-play').onclick = () => (player.laeuft ? player.pause() : player.spiele());
$('#pl-vor').onclick = () => player.springe(1);
$('#pl-zurueck').onclick = () => player.springe(-1);
$('#pl-tempo').value = String(einstellungen().tempo || 1);
$('#pl-tempo').onchange = (e) => {
  speichereEinstellungen({ tempo: +e.target.value });
  player.setzeTempo(+e.target.value);
};

// ---------------------------------------------------------------- Router
// Zaehler gegen Wettlaeufe: eine langsamere, aeltere Ansicht darf eine neuere nicht ueberschreiben.
let routeNr = 0;
const veraltet = (n) => n !== routeNr;

async function route() {
  routeNr++;
  const h = location.hash || '#/';
  let m;
  if (!h.match(/^#\/(g\/[^/]+\/k|s\/[^/]+\/(de|en))\//)) {
    player.stopp();
    playerEl.hidden = true;
  }
  try {
    if (h === '#/' || h === '#') {
      await bibliothek();
      bindeSprache(() => '#/');
    }
    else if (h === '#/neu') neuAnsicht();
    else if (h === '#/einstellungen') einstellungsAnsicht();
    else if ((m = h.match(/^#\/s\/([^/]+)\/(de|en)\/(\d+)/))) await statischerLeser(m[1], m[2], +m[3]);
    else if ((m = h.match(/^#\/s\/([^/]+)(?:\/(\w+))?/))) await statischeAnsicht(m[1], m[2] || 'kapitel');
    else if ((m = h.match(/^#\/g\/([^/]+)\/k\/(\d+)/))) await leser(m[1], +m[2]);
    else if ((m = h.match(/^#\/g\/([^/]+)(?:\/(\w+))?/))) await geschichtsAnsicht(m[1], m[2] || 'kapitel');
    else await bibliothek();
  } catch (e) {
    app.innerHTML = `<div class="status fehler">${esc(e.message)}</div>`;
  }
  zeigeAuftrag();
}
addEventListener('hashchange', route);

// ---------------------------------------------------------------- Bibliothek
async function bibliothek() {
  const n = routeNr;
  const e = einstellungen();
  const alle = (await lokal.alle()).sort((a, b) => (b.geaendert || 0) - (a.geaendert || 0));
  const fertig = await statischeListe();
  const sl = leseSprache();
  const fertigHtml = fertig.length
    ? `<h2>${sl === 'en' ? 'Stories' : 'Geschichten'}</h2>${sprachUmschalter(sl)}` +
      fertig
        .map((x) => {
          const pos = +(localStorage.getItem(posKeyS(x.slug, sl)) || 0);
          const weiter = Math.min(x.kapitel, pos + 1) || 1;
          return `<div class="karte"><a class="titel" href="#/s/${x.slug}">${esc(tr(x.titel, sl))}</a>
          <div class="leise klein">${esc(tr(x.genre, sl))} · ${x.kapitel} ${sl === 'en' ? 'chapters' : 'Kapitel'}</div>
          <p>${esc(tr(x.logline, sl))}</p>
          <div class="reihe"><a class="knopf" href="#/s/${x.slug}/${sl}/${weiter}">${pos ? (sl === 'en' ? 'Continue' : 'Weiterlesen') : sl === 'en' ? 'Read' : 'Lesen'}</a>
          <a class="knopf zweit" href="#/s/${x.slug}">${sl === 'en' ? 'Overview' : 'Übersicht'}</a></div></div>`;
        })
        .join('') +
      `<h2>${sl === 'en' ? 'Your own stories' : 'Eigene Geschichten'}</h2>`
    : '';
  if (veraltet(n)) return;
  app.innerHTML = `
    <h1>Deine Bibliothek</h1>
    ${fertigHtml}
    ${!e.anthropicKey ? `<div class="status">Willkommen! Trage zuerst in den <a href="#/einstellungen">Einstellungen</a> deinen Anthropic-API-Schlüssel ein. Optional: GitHub, damit alles im Repository gespeichert wird.</div>` : ''}
    <div class="reihe"><a class="knopf" href="#/neu">＋ Neue Geschichte</a>
    ${githubAktiv() ? `<button class="knopf zweit" id="gh-laden">Von GitHub laden</button>` : ''}</div>
    <div id="gh-liste"></div>
    ${alle
      .map((g) => {
        const k = g.kanon;
        const pos = gelesenBis(g.slug);
        return `<div class="karte">
          <a class="titel" href="#/g/${g.slug}">${esc(k.meta.titel)}</a>
          <div class="leise klein">${esc(k.meta.genre)} · ${g.kapitel.length} Kapitel${pos ? ` · gelesen bis Kapitel ${pos}` : ''}</div>
          <p>${esc(k.meta.logline)}</p>
          <div class="reihe">
            ${g.kapitel.length ? `<a class="knopf" href="#/g/${g.slug}/k/${Math.min(g.kapitel.length, (pos || 0) + 1) || 1}">${pos ? 'Weiterlesen' : 'Lesen'}</a>` : ''}
            <a class="knopf zweit" href="#/g/${g.slug}">Übersicht</a>
          </div></div>`;
      })
      .join('') || '<p class="leise">Noch keine Geschichten. Leg los!</p>'}`;
  const b = $('#gh-laden');
  if (b)
    b.onclick = async () => {
      b.disabled = true;
      const ziel = $('#gh-liste');
      try {
        const namen = await githubListe();
        ziel.innerHTML = namen.length
          ? `<div class="karte">${namen.map((n) => `<div class="reihe" style="justify-content:space-between"><span>${esc(n)}</span><button class="knopf zweit" data-slug="${esc(n)}">Laden</button></div>`).join('')}</div>`
          : '<p class="leise">Im GitHub-Ordner liegen noch keine Geschichten.</p>';
        $$('[data-slug]', ziel).forEach(
          (x) =>
            (x.onclick = async () => {
              x.disabled = true;
              x.textContent = 'Lädt …';
              const g = await vonGithub(x.dataset.slug);
              stimmenZuweisen(g.kanon);
              g.geaendert = Date.now();
              await lokal.speichere(g);
              x.textContent = '✓';
              bibliothek();
            })
        );
      } catch (err) {
        ziel.innerHTML = `<div class="status fehler">${esc(err.message)}</div>`;
      }
      b.disabled = false;
    };
}

const gelesenBis = (slug) => +(localStorage.getItem(`erzaehlwerk.pos.${slug}`) || 0);

// ---------------------------------------------------------------- Neue Geschichte
function neuAnsicht() {
  app.innerHTML = `
    <h1>Neue Geschichte</h1>
    <p class="leise">Claude entwirft Welt, Machtsystem, Figuren mit Stimmen und einen Handlungsbogen. Alles wird zum Kanon, an den sich jedes Kapitel hält.</p>
    <form id="f">
      <label>Genre</label>
      <select name="genre">${Object.entries(GENRES).map(([k, v]) => `<option value="${k}">${esc(v.label)}</option>`).join('')}</select>
      <div id="frei" hidden><label>Eigenes Genre</label><input name="genreFrei" placeholder="z. B. Postapokalypse mit Kampfkunst"></div>
      <label>Prämisse / Ideen (optional)</label>
      <textarea name="praemisse" placeholder="z. B. Der jüngste Sohn eines gefallenen Clans wird Diener in der Sekte, die seine Familie ausgelöscht hat …"></textarea>
      <label>Hauptfigur (optional)</label>
      <input name="hauptfigur" placeholder="z. B. kühl und berechnend, aber mit einem weichen Kern">
      <label>Ton</label>
      <select name="ton">
        <option>episch und spannend, mit Herz und Humor in den richtigen Momenten</option>
        <option>düster, brutal und ernst – Rache und Verrat</option>
        <option>humorvoll und leicht, aber mit echten Einsätzen</option>
        <option>melancholisch und poetisch</option>
      </select>
      <label>Kapitellänge</label>
      <select name="laenge">
        <option value="2000">kurz (~2.000 Wörter, ~15 Min. Hören)</option>
        <option value="3000" selected>mittel (~3.000 Wörter, ~20 Min.)</option>
        <option value="4500">lang (~4.500 Wörter, ~30 Min.)</option>
      </select>
      <label>Sprache</label>
      <select name="sprache"><option>Deutsch</option><option>English</option></select>
      <p><button class="knopf" data-gen>Welt erschaffen</button></p>
    </form>
    <div id="auftrag"></div>`;
  const f = $('#f');
  f.genre.onchange = () => ($('#frei').hidden = f.genre.value !== 'eigenes');
  f.onsubmit = async (ev) => {
    ev.preventDefault();
    const opts = Object.fromEntries(new FormData(f));
    opts.laenge = +opts.laenge;
    starteAuftrag('neu', async (status) => {
      const g = await neueGeschichte(opts, status);
      g.geaendert = Date.now();
      await lokal.speichere(g);
      status(`„${g.kanon.meta.titel}" ist bereit. Jetzt das erste Kapitel schreiben!`);
      location.hash = `#/g/${g.slug}`;
    });
  };
}

async function starteAuftrag(slug, fn) {
  if (auftrag.laeuft) return;
  Object.assign(auftrag, { slug, status: 'Starte …', live: '', fehler: false, laeuft: true });
  zeigeAuftrag();
  const status = (t) => {
    auftrag.status = t;
    zeigeAuftrag();
  };
  try {
    await fn(status, (t) => {
      auftrag.live = t;
      zeigeAuftrag();
    });
  } catch (e) {
    auftrag.fehler = true;
    auftrag.status = `Fehler: ${e.message}`;
  }
  auftrag.laeuft = false;
  zeigeAuftrag();
}

// ---------------------------------------------------------------- Geschichte
const TABS = { kapitel: 'Kapitel', figuren: 'Figuren', welt: 'Welt', zeit: 'Zeitleiste', faeden: 'Fäden & Fakten', stimmen: 'Stimmen', daten: 'Rohdaten' };

async function geschichtsAnsicht(slug, tab) {
  const n = routeNr;
  const g = await lokal.hole(slug);
  if (veraltet(n)) return;
  if (!g) throw new Error('Geschichte nicht gefunden.');
  const k = g.kanon;
  app.innerHTML = `
    <h1>${esc(k.meta.titel)}</h1>
    <p class="leise">${esc(k.meta.logline)}</p>
    <div class="karte">
      <label for="wunsch" style="margin-top:0">Nächstes Kapitel schreiben</label>
      <textarea id="wunsch" placeholder="Optional: Was soll passieren? (z. B. „Mehr von der Rivalin“, „Ein Turnier“) – leer lassen, dann folgt Claude dem Handlungsbogen."></textarea>
      <div class="reihe" style="margin-top:.6rem">
        <button class="knopf" data-gen id="schreib">Kapitel ${g.kapitel.length + 1} schreiben</button>
        <select id="anzahl" style="width:auto"><option value="1">1 Kapitel</option><option value="2">2 Kapitel</option><option value="3">3 Kapitel</option><option value="5">5 Kapitel</option></select>
      </div>
      <div class="hinweis">Ablauf je Kapitel: Plan → Schreiben → Kontinuitätsprüfung mit Korrektur → Kanon fortschreiben → Speichern${githubAktiv() ? ' (lokal + GitHub)' : ' (lokal)'}.</div>
      <div id="auftrag"></div>
    </div>
    <div class="tabs">${Object.entries(TABS).map(([id, t]) => `<button data-tab="${id}" class="${id === tab ? 'aktiv' : ''}">${t}</button>`).join('')}</div>
    <div id="tab"></div>`;
  $$('[data-tab]').forEach((b) => (b.onclick = () => (location.hash = `#/g/${slug}/${b.dataset.tab}`)));
  $('#schreib').onclick = () => {
    const wunsch = $('#wunsch').value.trim();
    const anzahl = +$('#anzahl').value;
    starteAuftrag(slug, async (status, live) => {
      for (let i = 0; i < anzahl; i++) {
        const aktuell = await lokal.hole(slug);
        const r = await naechstesKapitel(aktuell, i === 0 ? wunsch : '', status, live);
        aktuell.geaendert = Date.now();
        await lokal.speichere(aktuell);
        status(
          `✓ Kapitel ${r.nr} „${r.plan.titel}" fertig.` +
            (r.korrekturen.length ? `\n${r.korrekturen.length} Kontinuitätsfehler gefunden und korrigiert.` : '\nKeine Kontinuitätsfehler gefunden.') +
            (r.log.length ? `\nKanon: ${r.log.slice(0, 8).join(' · ')}` : '')
        );
        if (location.hash.startsWith(`#/g/${slug}`) && !location.hash.includes('/k/')) route();
      }
    });
  };
  const tabEl = $('#tab');
  ({ kapitel: tabKapitel, figuren: tabFiguren, welt: tabWelt, zeit: tabZeit, faeden: tabFaeden, stimmen: tabStimmen, daten: tabDaten }[tab] || tabKapitel)(g, tabEl);
}

const nameVon = (k, id) => k.figuren?.find((f) => f.id === id)?.name || k.orte?.find((o) => o.id === id)?.name || k.fraktionen?.find((o) => o.id === id)?.name || id || '–';

function tabKapitel(g, el) {
  const pos = gelesenBis(g.slug);
  el.innerHTML = g.kapitel.length
    ? [...g.kanon.kapitel]
        .reverse()
        .map(
          (k) => `<div class="karte"><a class="titel" href="#/g/${g.slug}/k/${k.nr}">${k.nr}. ${esc(k.titel)}</a> ${k.nr <= pos ? '<span class="leise klein">✓ gelesen</span>' : ''}
          <div class="leise klein">${esc(k.weltzeit)} · ${k.woerter || '?'} Wörter</div><p class="klein">${esc(k.zusammenfassung)}</p></div>`
        )
        .join('')
    : '<p class="leise">Noch kein Kapitel. Schreib oben das erste!</p>';
}

function dl(paare) {
  return `<dl class="kanon">${paare.filter(([, v]) => v).map(([k, v]) => `<dt>${k}</dt><dd>${v}</dd>`).join('')}</dl>`;
}

function tabFiguren(g, el) {
  const k = g.kanon;
  el.innerHTML = k.figuren
    .map(
      (f) => `<details class="karte"><summary><span style="color:${farbe(f.name)}">${esc(f.name)}</span> <span class="leise klein">· ${esc(f.rolle)} · ${esc(f.stufe)}</span> ${/tot/i.test(f.status) ? '<span class="marke-tot">✝</span>' : ''}</summary>
      ${dl([
        ['Alias', esc(f.alias)],
        ['Status', esc(f.status)],
        ['Ort', esc(nameVon(k, f.ort))],
        ['Alter', esc(f.alter)],
        ['Aussehen', esc(f.aussehen)],
        ['Wesen', esc(f.persoenlichkeit)],
        ['Spricht', esc(f.sprechweise)],
        ['Ziel', esc(f.ziel)],
        ['Bedürfnis', esc(f.beduerfnis)],
        ['Wunde', esc(f.wunde)],
        ['Geheimnis', esc(f.geheimnis)],
        ['Bogen', esc(f.bogen)],
        ['Stimme', esc(f.stimme)],
        ['Beziehungen', (f.beziehungen || []).map((b) => `${esc(nameVon(k, b.zu))} – ${esc(b.art)}`).join('<br>')],
        ['Seit', `Kapitel ${f.ersterAuftritt ?? 0} · zuletzt geändert: Kapitel ${f.letzteAenderung ?? 0}`],
      ])}</details>`
    )
    .join('');
}

function tabWelt(g, el) {
  const k = g.kanon;
  const liste = (titel, arr, fn) => (arr?.length ? `<h3>${titel}</h3>${arr.map(fn).join('')}` : '');
  el.innerHTML = `
    <div class="karte"><h3 style="margin-top:0">Welt</h3><p>${esc(k.welt.beschreibung)}</p><ul>${k.welt.regeln.map((r) => `<li>${esc(r)}</li>`).join('')}</ul>
    <p class="leise klein">Aktuelle Weltzeit: <b>${esc(k.zeit)}</b></p></div>
    <div class="karte"><h3 style="margin-top:0">Machtsystem: ${esc(k.machtsystem.name)}</h3><p>${esc(k.machtsystem.beschreibung)}</p>
    <ol>${k.machtsystem.stufen.map((s) => `<li><b>${esc(s.name)}</b> – ${esc(s.beschreibung)}</li>`).join('')}</ol>
    <ul>${k.machtsystem.regeln.map((r) => `<li>${esc(r)}</li>`).join('')}</ul></div>
    <div class="karte"><h3 style="margin-top:0">Handlungsbogen</h3><p>${esc(k.handlungsbogen.gesamtziel)}</p>
    <ol>${k.handlungsbogen.akte.map((a) => `<li><b>${esc(a.titel)}</b> – ${esc(a.inhalt)}</li>`).join('')}</ol></div>
    ${liste('Orte', k.orte, (o) => `<details class="karte"><summary>${esc(o.name)} <span class="leise klein">· ${esc(o.typ)}</span></summary>${dl([['Lage', esc(o.lage)], ['Bild', esc(o.beschreibung)], ['Sinne', esc(o.sinneseindruecke)]])}</details>`)}
    ${liste('Fraktionen', k.fraktionen, (f) => `<details class="karte"><summary>${esc(f.name)} <span class="leise klein">· ${esc(f.ausrichtung)}</span></summary>${dl([['Anführer', esc(nameVon(k, f.anfuehrer))], ['Sitz', esc(nameVon(k, f.sitz))], ['', esc(f.beschreibung)]])}</details>`)}
    ${liste('Techniken', k.techniken, (t) => `<details class="karte"><summary>${esc(t.name)} <span class="leise klein">· ${esc(t.stufe)}</span></summary>${dl([['Nutzer', esc(nameVon(k, t.nutzer))], ['Wirkung', esc(t.beschreibung)], ['Kosten', esc(t.kosten)]])}</details>`)}
    ${liste('Gegenstände', k.gegenstaende, (x) => `<details class="karte"><summary>${esc(x.name)}</summary>${dl([['Besitzer', esc(nameVon(k, x.besitzer))], ['Ort', esc(nameVon(k, x.ort))], ['', esc(x.beschreibung)]])}</details>`)}`;
}

function tabZeit(g, el) {
  const k = g.kanon;
  el.innerHTML = `<p class="leise">Aktuelle Weltzeit: <b>${esc(k.zeit)}</b></p><div class="zeit">${[...k.zeitleiste]
    .reverse()
    .map(
      (e) => `<div class="e"><b>${esc(e.weltzeit)}</b> <span class="leise klein">· ${e.kapitel ? `Kapitel ${e.kapitel}` : 'Vorgeschichte'} · ${esc(nameVon(k, e.ort))}</span><br>${esc(e.ereignis)}
      ${e.figuren?.length ? `<div class="leise klein">Beteiligt: ${e.figuren.map((f) => esc(nameVon(k, f))).join(', ')}</div>` : ''}
      ${e.folgen ? `<div class="leise klein">Folgen: ${esc(e.folgen)}</div>` : ''}</div>`
    )
    .join('')}</div>`;
}

function tabFaeden(g, el) {
  const k = g.kanon;
  el.innerHTML = `<h3>Offene Fäden</h3>${k.faeden.filter((f) => f.status === 'offen').map((f) => `<div class="karte klein">◻ ${esc(f.beschreibung)} <span class="leise">(seit Kap. ${f.eingefuehrt})</span></div>`).join('') || '<p class="leise">keine</p>'}
    <h3>Gelöst</h3>${k.faeden.filter((f) => f.status !== 'offen').map((f) => `<div class="karte klein">✅ ${esc(f.beschreibung)}<br><span class="leise">→ ${esc(f.aufloesung)} (Kap. ${f.geloestIn ?? '?'})</span></div>`).join('') || '<p class="leise">noch keine</p>'}
    <h3>Harte Fakten</h3><ul class="klein">${[...k.fakten].reverse().map((f) => `<li><span class="leise">[Kap. ${f.kapitel}]</span> ${esc(f.text)}</li>`).join('')}</ul>`;
}

function tabStimmen(g, el) {
  const k = g.kanon;
  stimmenZuweisen(k);
  const tts = einstellungen().tts || 'browser';
  const bv = browserStimmen();
  const zeile = (name, st, label) => `
    <div class="karte" data-stimme="${esc(name)}">
      <b style="color:${name ? farbe(name) : 'inherit'}">${esc(label || name)}</b>
      <div class="hinweis">${esc(name ? k.figuren.find((f) => f.name === name)?.stimme || '' : 'Erzählstimme')}</div>
      <div class="reihe" style="margin-top:.5rem">
        <select data-feld="openai" style="width:auto" title="OpenAI-Stimme">${[...new Set(Object.values(OPENAI_STIMMEN).flat())].map((v) => `<option ${v === st.openai ? 'selected' : ''}>${v}</option>`).join('')}</select>
        <select data-feld="browser" style="width:auto;max-width:12rem" title="Gerätestimme"><option value="">Gerätestimme: automatisch</option>${bv.map((v) => `<option value="${esc(v.voiceURI)}" ${v.voiceURI === st.browser ? 'selected' : ''}>${esc(v.name)} (${esc(v.lang)})</option>`).join('')}</select>
        <label class="klein" style="margin:0;font-weight:400">Höhe <input data-feld="tonhoehe" type="range" min="0.5" max="1.6" step="0.05" value="${st.tonhoehe || 1}" style="width:6rem"></label>
        <label class="klein" style="margin:0;font-weight:400">Tempo <input data-feld="tempo" type="range" min="0.7" max="1.3" step="0.05" value="${st.tempo || 1}" style="width:6rem"></label>
        <button class="knopf zweit" data-probe>Probe</button>
      </div>
    </div>`;
  el.innerHTML = `<p class="leise klein">Aktive Sprachausgabe: <b>${tts === 'openai' ? 'OpenAI-Stimmen' : 'Gerätestimmen'}</b> (in den Einstellungen umstellbar). Höhe/Tempo gelten für Gerätestimmen; OpenAI-Stimmen bekommen zusätzlich die Stimmbeschreibung und Regieanweisung jeder Zeile.</p>
    ${zeile('', k.stimmen.erzaehler, 'Erzähler')}
    ${Object.entries(k.stimmen.figuren).map(([n, st]) => zeile(n, st)).join('')}
    <button class="knopf" id="st-speichern">Stimmen speichern</button> <span id="st-ok" class="leise"></span>`;
  const st = (karte) => {
    const n = karte.dataset.stimme;
    return n ? k.stimmen.figuren[n] : k.stimmen.erzaehler;
  };
  $$('[data-stimme]', el).forEach((karte) => {
    $$('[data-feld]', karte).forEach(
      (inp) => (inp.onchange = () => (st(karte)[inp.dataset.feld] = inp.type === 'range' ? +inp.value : inp.value))
    );
    $('[data-probe]', karte).onclick = () => {
      const n = karte.dataset.stimme;
      const seg = n
        ? { typ: 'rede', name: n, regie: 'ruhig', text: `Ich bin ${n}. So klinge ich, wenn ich spreche.` }
        : { typ: 'erzaehler', text: `Der Wind strich über die Dächer von ${k.orte[0]?.name || 'der Stadt'}, und irgendwo in der Ferne läutete eine Glocke.` };
      playerEl.hidden = false;
      player.lade(k, [seg], 'Stimmprobe');
      player.spiele(0);
    };
  });
  $('#st-speichern').onclick = async () => {
    g.geaendert = Date.now();
    await speichern(g, `Stimmen angepasst: ${k.meta.titel}`, [], (t) => ($('#st-ok').textContent = t));
    $('#st-ok').textContent ||= 'Gespeichert.';
  };
}

function tabDaten(g, el) {
  el.innerHTML = `<p class="leise klein">Der komplette Kanon als JSON. Du kannst ihn hier direkt korrigieren – Claude hält sich bei jedem weiteren Kapitel daran.</p>
    <textarea id="json" style="min-height:50vh;font-family:monospace;font-size:.8rem">${esc(JSON.stringify(g.kanon, null, 2))}</textarea>
    <div class="reihe" style="margin-top:.5rem"><button class="knopf" id="json-ok">Übernehmen & speichern</button>
    <button class="knopf zweit" id="loeschen">Geschichte lokal löschen</button><span id="json-msg" class="leise"></span></div>`;
  $('#json-ok').onclick = async () => {
    try {
      g.kanon = JSON.parse($('#json').value);
    } catch (e) {
      $('#json-msg').textContent = 'Ungültiges JSON: ' + e.message;
      return;
    }
    g.geaendert = Date.now();
    await speichern(g, `Kanon von Hand bearbeitet: ${g.kanon.meta.titel}`, [], (t) => ($('#json-msg').textContent = t));
    $('#json-msg').textContent ||= 'Gespeichert.';
  };
  $('#loeschen').onclick = async () => {
    if (!confirm('Diese Geschichte nur auf diesem Gerät löschen? (Auf GitHub bleibt sie erhalten.)')) return;
    await lokal.loesche(g.slug);
    location.hash = '#/';
  };
}

// ---------------------------------------------------------------- Leser
async function leser(slug, nr) {
  const n = routeNr;
  const g = await lokal.hole(slug);
  if (veraltet(n)) return;
  const kap = g?.kapitel.find((k) => k.nr === nr);
  if (!kap) throw new Error('Kapitel nicht gefunden.');
  if (nr > gelesenBis(slug)) localStorage.setItem(`erzaehlwerk.pos.${slug}`, String(nr));
  zeigeKapitel({
    slug,
    kanon: g.kanon,
    text: kap.text,
    titel: kap.titel,
    nr,
    zurueck: `#/g/${slug}`,
    vorHref: g.kapitel.some((k) => k.nr === nr - 1) ? `#/g/${slug}/k/${nr - 1}` : '',
    nachHref: g.kapitel.some((k) => k.nr === nr + 1) ? `#/g/${slug}/k/${nr + 1}` : '',
    endeHref: `#/g/${slug}`,
    endeText: 'Nächstes Kapitel schreiben →',
  });
}

// ---------------------------------------------------------------- Fertige Geschichten (im Repo mitgeliefert)
// Liegen unter geschichten/<slug>/ mit kanon.json und kapitel/<de|en>/NNN.md – lesbar ohne Schluessel.
const SPRACHEN = { de: 'Deutsch', en: 'English' };
const posKeyS = (slug, lang) => `erzaehlwerk.pos.s.${slug}.${lang}`;
const leseSprache = () => einstellungen().lesesprache || 'de';
let indexCache;
async function statischeListe() {
  if (!indexCache) {
    try {
      const r = await fetch('geschichten/index.json', { cache: 'no-cache' });
      indexCache = r.ok ? await r.json() : [];
    } catch {
      indexCache = [];
    }
  }
  return indexCache;
}
const kanonCache = {};
async function statischerKanon(slug) {
  if (!kanonCache[slug]) {
    const r = await fetch(`geschichten/${slug}/kanon.json`, { cache: 'no-cache' });
    if (!r.ok) throw new Error('Geschichte nicht gefunden.');
    kanonCache[slug] = await r.json();
  }
  return kanonCache[slug];
}
const tr = (wert, lang) => (wert && typeof wert === 'object' ? wert[lang] || wert.de || wert.en : wert);

function sprachUmschalter(aktiv) {
  return `<div class="reihe" style="margin:.4rem 0">${Object.entries(SPRACHEN)
    .map(([l, t]) => `<button class="knopf ${l === aktiv ? '' : 'zweit'}" data-lang="${l}">${t}</button>`)
    .join('')}</div>`;
}
function bindeSprache(ziel) {
  $$('[data-lang]').forEach(
    (b) =>
      (b.onclick = () => {
        speichereEinstellungen({ lesesprache: b.dataset.lang });
        const h = ziel(b.dataset.lang);
        if (location.hash === h) route();
        else location.hash = h;
      })
  );
}

async function statischeAnsicht(slug, tab) {
  const n = routeNr;
  const lang = leseSprache();
  const liste = await statischeListe();
  const info = liste.find((x) => x.slug === slug) || {};
  const kanon = await statischerKanon(slug);
  if (veraltet(n)) return;
  const pos = +(localStorage.getItem(posKeyS(slug, lang)) || 0);
  const anzahl = info.kapitel || kanon.kapitel.length;
  const en = lang === 'en';
  const weiter = Math.min(anzahl, pos + 1) || 1;
  app.innerHTML = `
    <h1>${esc(tr(info.titel, lang) || kanon.meta.titel)}</h1>
    <p class="leise">${esc(tr(info.logline, lang) || kanon.meta.logline)}</p>
    ${sprachUmschalter(lang)}
    <div class="reihe"><a class="knopf" href="#/s/${slug}/${lang}/${weiter}">${pos ? (en ? `Continue (chapter ${weiter})` : `Weiterlesen (Kapitel ${weiter})`) : en ? 'Start reading' : 'Lesen beginnen'}</a></div>
    <div class="tabs">${Object.entries(TABS)
      .filter(([id]) => !['stimmen', 'daten'].includes(id))
      .map(([id, t]) => `<button data-tab="${id}" class="${id === tab ? 'aktiv' : ''}">${t}</button>`)
      .join('')}</div>
    <div id="tab"></div>`;
  bindeSprache(() => `#/s/${slug}`);
  $$('[data-tab]').forEach((b) => (b.onclick = () => (location.hash = `#/s/${slug}/${b.dataset.tab}`)));
  const g = { slug, kanon, kapitel: [] };
  const tabEl = $('#tab');
  if (tab === 'kapitel') {
    const titel = info.kapiteltitel?.[lang] || [];
    tabEl.innerHTML = Array.from({ length: anzahl }, (_, i) => i + 1)
      .map(
        (nr) => `<div class="karte"><a class="titel" href="#/s/${slug}/${lang}/${nr}">${nr}. ${esc(titel[nr - 1] || (en ? 'Chapter ' : 'Kapitel ') + nr)}</a> ${nr <= pos ? '<span class="leise klein">✓</span>' : ''}</div>`
      )
      .join('');
  } else ({ figuren: tabFiguren, welt: tabWelt, zeit: tabZeit, faeden: tabFaeden }[tab] || tabFiguren)(g, tabEl);
}

async function statischerLeser(slug, lang, nr) {
  const n = routeNr;
  const liste = await statischeListe();
  const info = liste.find((x) => x.slug === slug) || {};
  const kanon = await statischerKanon(slug);
  const r = await fetch(`geschichten/${slug}/kapitel/${lang}/${String(nr).padStart(3, '0')}.md`, { cache: 'no-cache' });
  if (veraltet(n)) return;
  if (!r.ok) throw new Error('Kapitel nicht gefunden.');
  const text = await r.text();
  const nnn = String(nr).padStart(3, '0');
  let zeiten = null;
  try {
    const rz = await fetch(`geschichten/${slug}/audio/${lang}/${nnn}.json`, { cache: 'no-cache' });
    if (rz.ok) zeiten = (await rz.json()).zeiten;
  } catch {}
  if (veraltet(n)) return;
  if (nr > +(localStorage.getItem(posKeyS(slug, lang)) || 0)) localStorage.setItem(posKeyS(slug, lang), String(nr));
  speichereEinstellungen({ lesesprache: lang });
  const anzahl = info.kapitel || kanon.kapitel.length;
  const k = { ...kanon, meta: { ...kanon.meta, sprache: SPRACHEN[lang] } };
  zeigeKapitel({
    slug,
    kanon: k,
    text,
    titel: text.split('\n')[0].replace(/^#+\s*/, ''),
    nr,
    zurueck: `#/s/${slug}`,
    vorHref: nr > 1 ? `#/s/${slug}/${lang}/${nr - 1}` : '',
    nachHref: nr < anzahl ? `#/s/${slug}/${lang}/${nr + 1}` : '',
    endeHref: `#/s/${slug}`,
    endeText: lang === 'en' ? 'More chapters coming soon' : 'Weitere Kapitel folgen',
    lang,
    titelGeschichte: tr(info.titel, lang),
    audio: zeiten ? { url: `geschichten/${slug}/audio/${lang}/${nnn}.mp3`, zeiten } : null,
  });
  bindeSprache((l) => `#/s/${slug}/${l}/${nr}`);
}

function zeigeKapitel(c) {
  stimmenZuweisen(c.kanon);
  const seg = zerlege(c.text);
  const e = einstellungen();
  const en = c.lang === 'en';
  app.innerHTML = `
    <div class="leise klein"><a href="${c.zurueck}">← ${esc(c.titelGeschichte || c.kanon.meta.titel)}</a></div>
    ${c.lang ? sprachUmschalter(c.lang) : ''}
    <div class="leseleiste" style="margin-top:.6rem">
      <button data-a="-">A−</button><button data-a="+">A+</button>
      <button data-t="dunkel">${en ? 'Dark' : 'Dunkel'}</button><button data-t="nacht">${en ? 'Black' : 'Schwarz'}</button><button data-t="sepia">Sepia</button><button data-t="hell">${en ? 'Light' : 'Hell'}</button>
      ${e.tts === 'openai' ? '<button id="mp3">⬇ MP3</button>' : ''}
      <button id="tontest">🔊 ${en ? 'Sound test' : 'Ton testen'}</button>
    </div>
    <div id="tontest-aus" class="klein leise"></div>
    <article class="lesen">${seg
      .map((s, i) => {
        if (s.typ === 'rede' || s.typ === 'gedanke')
          return `<p class="seg ${s.typ}" data-i="${i}" style="--farbe:${farbe(s.name)}"><span class="wer">${esc(s.name)} <span class="regie">· ${esc(s.regie)}</span></span>${esc(s.text)}</p>`;
        if (s.typ === 'trenner') return `<p class="seg trenner" data-i="${i}">· · ·</p>`;
        return `<p class="seg ${s.typ}" data-i="${i}">${esc(s.text)}</p>`;
      })
      .join('')}</article>
    <div class="kapnav">
      ${c.vorHref ? `<a class="knopf zweit" href="${c.vorHref}">← ${en ? 'Chapter' : 'Kapitel'} ${c.nr - 1}</a>` : '<span></span>'}
      ${c.nachHref ? `<a class="knopf" href="${c.nachHref}">${en ? 'Chapter' : 'Kapitel'} ${c.nr + 1} →</a>` : `<a class="knopf" href="${c.endeHref}">${c.endeText}</a>`}
    </div>
    <div id="auftrag"></div>`;
  window.scrollTo(0, 0);
  $$('[data-a]').forEach(
    (b) =>
      (b.onclick = () => {
        const s = Math.min(2, Math.max(0.9, (einstellungen().schrift || 1.15) + (b.dataset.a === '+' ? 0.1 : -0.1)));
        speichereEinstellungen({ schrift: +s.toFixed(2) });
        wendeLeseEinstellungenAn();
      })
  );
  $$('[data-t]').forEach((b) => (b.onclick = () => (speichereEinstellungen({ thema: b.dataset.t }), wendeLeseEinstellungenAn())));
  $('#tontest').onclick = () => tonTest($('#tontest-aus'));
  playerEl.hidden = false;
  player.naechstesHref = c.nachHref;
  player.lade(c.kanon, seg, `${c.kanon.meta.titel} – ${c.titel}`);
  if (c.audio && c.audio.zeiten.length === seg.length) player.ladeDatei(c.audio.url, c.audio.zeiten);
  $('#pl-play').textContent = '▶';
  $('#pl-sprecher').textContent = `${en ? 'Chapter' : 'Kapitel'} ${c.nr}`;
  $('#pl-status').textContent = en ? 'Tap ▶ or a paragraph' : 'Tippe auf ▶ oder einen Absatz';
  $$('.seg').forEach((p) => (p.onclick = () => player.spiele(+p.dataset.i)));
  const mp3 = $('#mp3');
  if (mp3)
    mp3.onclick = async () => {
      mp3.disabled = true;
      try {
        const blob = await kapitelAlsMp3(c.kanon, seg, (i, n) => (mp3.textContent = `⬇ ${i}/${n}`));
        const a = document.createElement('a');
        a.href = URL.createObjectURL(blob);
        a.download = `${c.slug}-${c.lang ? c.lang + '-' : ''}${String(c.nr).padStart(3, '0')}.mp3`;
        a.click();
        mp3.textContent = '⬇ MP3 ✓';
      } catch (err) {
        alert(err.message);
        mp3.textContent = '⬇ MP3';
      }
      mp3.disabled = false;
    };
  if (sessionStorage.getItem('autoplay')) {
    sessionStorage.removeItem('autoplay');
    player.spiele(0);
  }
}

// ---------------------------------------------------------------- Tontest
// Prueft Schritt fuer Schritt, ob das Geraet ueberhaupt Ton und Sprachausgabe abspielt.
function tonTest(ausgabe) {
  const zeilen = [];
  const zeige = (t) => {
    zeilen.push(t);
    ausgabe.innerHTML = zeilen.map((z) => `<div>${esc(z)}</div>`).join('');
  };
  // 1. Piepton ueber Web Audio – zeigt, ob der Browser ueberhaupt Ton ausgibt.
  try {
    const AC = window.AudioContext || window.webkitAudioContext;
    const ctx = new AC();
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    gain.gain.value = 0.15;
    osc.frequency.value = 660;
    osc.connect(gain).connect(ctx.destination);
    osc.start();
    osc.stop(ctx.currentTime + 0.4);
    zeige('1. Piepton gesendet. Hörst du einen kurzen Piep? Wenn nicht: Lautstärke, Stummschalter (iPhone: Schalter an der Seite) oder Bluetooth prüfen.');
  } catch (e) {
    zeige('1. Piepton nicht möglich: ' + e.message);
  }
  // 2. Sprachausgabe
  if (!('speechSynthesis' in window)) {
    zeige('2. Dieser Browser hat keine Sprachausgabe. Bitte Chrome, Safari oder Edge verwenden.');
    return;
  }
  const stimmen = speechSynthesis.getVoices();
  const de = stimmen.filter((v) => v.lang.toLowerCase().startsWith('de'));
  const en = stimmen.filter((v) => v.lang.toLowerCase().startsWith('en'));
  zeige(`2. Stimmen gefunden: ${stimmen.length} insgesamt, ${de.length} deutsche, ${en.length} englische.${de.length ? ' Deutsch: ' + de.slice(0, 4).map((v) => v.name).join(', ') : ''}`);
  if (speechSynthesis.speaking || speechSynthesis.pending) speechSynthesis.cancel();
  const u = new SpeechSynthesisUtterance('Hallo. Das ist ein Test der Sprachausgabe. Wenn du mich hörst, funktioniert alles.');
  u.lang = 'de-DE';
  if (de[0]) u.voice = de[0];
  let gestartet = false;
  u.onstart = () => {
    gestartet = true;
    zeige('3. Die Sprachausgabe hat gestartet. Du solltest jetzt eine Stimme hören.');
  };
  u.onend = () => zeige('4. Fertig gesprochen.' + (gestartet ? '' : ' (ohne Start-Meldung)'));
  u.onerror = (e) => zeige('Fehler der Sprachausgabe: ' + e.error);
  setTimeout(() => {
    if (!gestartet) zeige('3. Nach 4 Sekunden noch kein Start. Der Browser blockiert die Sprachausgabe. Tipp: Seite neu laden und den Test noch einmal drücken; auf Android in Chrome öffnen (nicht in einer App-Vorschau); auf dem iPhone Stummschalter aus.');
  }, 4000);
  speechSynthesis.resume();
  speechSynthesis.speak(u);
}

// ---------------------------------------------------------------- Einstellungen
function einstellungsAnsicht() {
  const e = einstellungen();
  const opt = (werte, aktuell) => Object.entries(werte).map(([k, v]) => `<option value="${k}" ${k === aktuell ? 'selected' : ''}>${esc(v)}</option>`).join('');
  app.innerHTML = `
    <h1>Einstellungen</h1>
    <div class="karte"><b>Kein Ton?</b> <button class="knopf zweit" id="tontest" type="button">🔊 Ton testen</button><div id="tontest-aus" class="klein" style="margin-top:.5rem"></div></div>
    <form id="f">
      <h2>Claude (Geschichten)</h2>
      <label>Anthropic-API-Schlüssel</label>
      <input name="anthropicKey" type="password" autocomplete="off" value="${esc(e.anthropicKey)}" placeholder="sk-ant-…">
      <div class="hinweis">Von console.anthropic.com. Wird nur auf diesem Gerät gespeichert und direkt an Anthropic gesendet.</div>
      <label>Modell</label>
      <select name="modell">${opt(MODELLE, e.modell || 'claude-opus-5-5')}</select>

      <h2>GitHub (Speicher für Kanon & Kapitel)</h2>
      <label>Repository (besitzer/name)</label>
      <input name="ghRepo" value="${esc(e.ghRepo)}" placeholder="z. B. leoz111/bauplan">
      <label>Branch</label>
      <input name="ghBranch" value="${esc(e.ghBranch || 'main')}">
      <label>Ordner im Repository</label>
      <input name="ghPfad" value="${esc(e.ghPfad || 'geschichten')}">
      <label>Persönlicher Zugriffstoken</label>
      <input name="ghToken" type="password" autocomplete="off" value="${esc(e.ghToken)}" placeholder="github_pat_…">
      <div class="hinweis">Fine-grained Token mit Zugriff nur auf dieses Repository, Berechtigung „Contents: Read and write“. Jedes Kapitel wird als ein Commit gespeichert.</div>

      <h2>Hörbuch</h2>
      <label>Sprachausgabe</label>
      <select name="tts">${opt({ browser: 'Gerätestimmen (kostenlos, offline)', openai: 'OpenAI-Stimmen (natürlich, mit Emotionen, kostenpflichtig)' }, e.tts || 'browser')}</select>
      <label>OpenAI-API-Schlüssel (nur für OpenAI-Stimmen)</label>
      <input name="openaiKey" type="password" autocomplete="off" value="${esc(e.openaiKey)}" placeholder="sk-…">
      <label>OpenAI-Sprachmodell</label>
      <input name="ttsModell" value="${esc(e.ttsModell || 'gpt-4o-mini-tts')}">
      <label><input type="checkbox" name="autoWeiter" style="width:auto" ${e.autoWeiter !== false ? 'checked' : ''}> Am Kapitelende automatisch das nächste Kapitel abspielen</label>

      <p><button class="knopf">Speichern</button> <span id="ok" class="leise"></span></p>
    </form>`;
  $('#tontest').onclick = () => tonTest($('#tontest-aus'));
  const f = $('#f');
  f.onsubmit = (ev) => {
    ev.preventDefault();
    const d = Object.fromEntries(new FormData(f));
    d.autoWeiter = f.autoWeiter.checked;
    for (const k of ['anthropicKey', 'ghToken', 'openaiKey', 'ghRepo', 'ghBranch', 'ghPfad']) d[k] = (d[k] || '').trim();
    speichereEinstellungen(d);
    $('#ok').textContent = 'Gespeichert ✓';
  };
}

if ('speechSynthesis' in window) {
  speechSynthesis.getVoices();
  speechSynthesis.onvoiceschanged = () => speechSynthesis.getVoices();
}
route();
