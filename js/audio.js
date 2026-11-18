// Hoerbuch: zerlegt ein Kapitel in Sprecher-Abschnitte und liest sie mit
// passenden Stimmen vor – entweder mit den Stimmen des Geraets (kostenlos)
// oder mit OpenAI-Sprachausgabe (natuerlicher, mit Regieanweisungen).
import { einstellungen } from './store.js';

// ------------------------------------------------------------ Zerlegen
const REDE = /^\[([^\]|]+)\|([^\]]*)\]\s*(.*)$/;

export function zerlege(text) {
  const seg = [];
  for (const zeile of text.split('\n')) {
    const z = zeile.trim();
    if (!z) continue;
    if (z.startsWith('#')) seg.push({ typ: 'titel', text: z.replace(/^#+\s*/, '') });
    else if (/^(\*\s*){3}$|^-{3,}$/.test(z)) seg.push({ typ: 'trenner', text: '' });
    else {
      const m = z.match(REDE);
      if (m) {
        const regie = m[2].trim();
        seg.push({
          typ: /gedank/i.test(regie) ? 'gedanke' : 'rede',
          name: m[1].trim(),
          regie,
          text: m[3].replace(/^["„“»«]+|["„“»«]+$/g, '').trim(),
        });
      } else seg.push({ typ: 'erzaehler', text: z });
    }
  }
  return seg;
}

// ------------------------------------------------------------ Stimmen
export const OPENAI_STIMMEN = {
  m: ['onyx', 'ash', 'echo', 'verse', 'ballad', 'cedar'],
  w: ['nova', 'shimmer', 'coral', 'sage', 'marin', 'alloy'],
  d: ['fable', 'alloy', 'sage', 'ballad'],
};

function hash(s) {
  let h = 0;
  for (const c of s) h = (h * 31 + c.charCodeAt(0)) >>> 0;
  return h;
}

function altersZahl(alter) {
  const m = String(alter || '').match(/\d+/);
  return m ? parseInt(m[0], 10) : 30;
}

// Weist jeder Figur eine eigene Stimme zu (bleibt danach stabil im Kanon gespeichert).
export function stimmenZuweisen(kanon) {
  kanon.stimmen ||= { erzaehler: {}, figuren: {} };
  const st = kanon.stimmen;
  st.erzaehler = { openai: 'onyx', tonhoehe: 1, tempo: 1, ...st.erzaehler };
  st.figuren ||= {};
  const benutzt = {};
  for (const s of Object.values(st.figuren)) benutzt[s.openai] = (benutzt[s.openai] || 0) + 1;
  benutzt[st.erzaehler.openai] = (benutzt[st.erzaehler.openai] || 0) + 2;

  const alle = [...(kanon.figuren || []).map((f) => f), { name: 'System', geschlecht: 'd', alter: '', stimme: 'kühl, mechanisch, neutral' }];
  for (const f of alle) {
    if (st.figuren[f.name]) continue;
    const g = OPENAI_STIMMEN[f.geschlecht] ? f.geschlecht : 'd';
    const pool = [...OPENAI_STIMMEN[g]].sort((a, b) => (benutzt[a] || 0) - (benutzt[b] || 0) || hash(f.name + a) - hash(f.name + b));
    const openai = pool[0];
    benutzt[openai] = (benutzt[openai] || 0) + 1;
    const alter = altersZahl(f.alter);
    const basis = g === 'w' ? 1.15 : g === 'm' ? 0.88 : 1;
    const altersFaktor = alter > 55 ? -0.1 : alter < 18 ? 0.12 : 0;
    const streuung = ((hash(f.name) % 9) - 4) / 50;
    st.figuren[f.name] = {
      openai,
      tonhoehe: +Math.min(1.6, Math.max(0.5, basis + altersFaktor + streuung)).toFixed(2),
      tempo: +(1 + (((hash(f.name + 't') % 7) - 3) / 40)).toFixed(2),
      browser: '',
    };
  }
  return st;
}

function stimmeFuer(kanon, seg) {
  const st = kanon.stimmen || {};
  if (seg.typ === 'rede' || seg.typ === 'gedanke') {
    return st.figuren?.[seg.name] || st.figuren?.[Object.keys(st.figuren || {}).find((n) => n.toLowerCase() === seg.name.toLowerCase())] || st.erzaehler;
  }
  return st.erzaehler;
}

function figurZu(kanon, name) {
  return (kanon.figuren || []).find((f) => f.name === name || f.alias === name);
}

function anweisungen(kanon, seg) {
  const sprache = kanon.meta?.sprache || 'Deutsch';
  if (seg.typ === 'erzaehler' || seg.typ === 'titel' || seg.typ === 'trenner')
    return `Du bist der Erzähler eines spannenden Hörbuchs (${kanon.meta?.genre || ''}). Sprich ${sprache}. Atmosphärisch, bildhaft, mit Spannung und guten Pausen, nie hektisch.`;
  const f = figurZu(kanon, seg.name);
  const teile = [`Sprich ${sprache}.`, `Du sprichst die Figur ${seg.name}.`];
  if (f?.stimme) teile.push(`Stimme: ${f.stimme}.`);
  if (f?.sprechweise) teile.push(`Sprechweise: ${f.sprechweise}.`);
  if (seg.name === 'System') teile.push('Klinge wie eine kühle, künstliche Systemansage.');
  if (seg.typ === 'gedanke') teile.push('Das sind innere Gedanken: leise, nah, intim.');
  else if (seg.regie) teile.push(`In diesem Moment: ${seg.regie}.`);
  return teile.join(' ');
}

// Lange Texte in Saetze/Bloecke teilen (Browser-Stimmen brechen bei langen Texten ab).
function bloecke(text, max) {
  if (text.length <= max) return [text];
  const saetze = text.match(/[^.!?…]+[.!?…]+["»“]?\s*|.+$/g) || [text];
  const out = [];
  let cur = '';
  for (const s of saetze) {
    if ((cur + s).length > max && cur) {
      out.push(cur.trim());
      cur = '';
    }
    cur += s;
  }
  if (cur.trim()) out.push(cur.trim());
  return out;
}

// ------------------------------------------------------------ Engines
export function browserStimmen() {
  return 'speechSynthesis' in window ? speechSynthesis.getVoices() : [];
}

const WEIBLICH = /female|frau|anna|katja|hedda|petra|marlene|vicki|helena|sabina|amala|seraphina|elke|gisela|ingrid|katharina|louisa|maja|tanja|yvonne|ingrid|google deutsch$/i;

function browserStimme(kanon, seg, st) {
  const sprache = (kanon.meta?.sprache || 'Deutsch').toLowerCase().startsWith('deu') ? 'de' : 'en';
  const alle = browserStimmen();
  if (st.browser) {
    const v = alle.find((x) => x.voiceURI === st.browser);
    if (v) return v;
  }
  const passend = alle.filter((v) => v.lang.toLowerCase().startsWith(sprache));
  if (!passend.length) return null;
  if (seg.typ === 'rede' || seg.typ === 'gedanke') {
    const f = figurZu(kanon, seg.name);
    const w = passend.filter((v) => WEIBLICH.test(v.name));
    const m = passend.filter((v) => !WEIBLICH.test(v.name));
    const pool = f?.geschlecht === 'w' ? (w.length ? w : passend) : f?.geschlecht === 'm' ? (m.length ? m : passend) : passend;
    return pool[hash(seg.name) % pool.length];
  }
  return passend[0];
}

class BrowserEngine {
  async sprich(kanon, seg, tempo, abbruch) {
    if (!('speechSynthesis' in window)) throw new Error('Dieser Browser hat keine Sprachausgabe.');
    const st = stimmeFuer(kanon, seg);
    const sprache = (kanon.meta?.sprache || 'Deutsch').toLowerCase().startsWith('deu') ? 'de-DE' : 'en-US';
    for (const b of bloecke(seg.text, 220)) {
      if (abbruch.stop) return;
      await new Promise((res, rej) => {
        const u = new SpeechSynthesisUtterance(b);
        const v = browserStimme(kanon, seg, st);
        u.lang = v ? v.lang : sprache;
        if (v) u.voice = v;
        u.pitch = seg.typ === 'erzaehler' ? 1 : st.tonhoehe || 1;
        u.rate = (st.tempo || 1) * tempo * (seg.typ === 'gedanke' ? 0.95 : 1);
        if (seg.typ === 'gedanke') u.volume = 0.8;
        let gestartet = false;
        // Manche Browser verschlucken die Ausgabe still – dann melden statt weiterzurasen.
        const wache = setTimeout(() => {
          if (!gestartet && !abbruch.stop) {
            speechSynthesis.cancel();
            rej(new Error('Die Sprachausgabe startet nicht. Prüfe die Lautstärke oder öffne die Seite direkt im Browser (Chrome, Safari, Edge).'));
          }
        }, 4000);
        u.onstart = () => (gestartet = true);
        u.onend = () => {
          clearTimeout(wache);
          res();
        };
        u.onerror = (e) => {
          clearTimeout(wache);
          if (e.error === 'interrupted' || e.error === 'canceled' || abbruch.stop) res();
          else rej(new Error(`Sprachausgabe-Fehler: ${e.error}`));
        };
        abbruch.abbrechen = () => {
          clearTimeout(wache);
          speechSynthesis.cancel();
          res();
        };
        // Chrome-Eigenheit: nach cancel() und bei pausierter Ausgabe wird speak() sonst still ignoriert.
        speechSynthesis.resume();
        speechSynthesis.speak(u);
      });
    }
  }
  stop() {
    if ('speechSynthesis' in window && (speechSynthesis.speaking || speechSynthesis.pending)) speechSynthesis.cancel();
  }
}

const cache = new Map();

export async function openaiAudio(kanon, seg) {
  const e = einstellungen();
  if (!e.openaiKey) throw new Error('Für OpenAI-Stimmen fehlt der OpenAI-API-Schlüssel in den Einstellungen.');
  const st = stimmeFuer(kanon, seg);
  const teile = bloecke(seg.text, 3500);
  const blobs = [];
  for (const input of teile) {
    const body = {
      model: e.ttsModell || 'gpt-4o-mini-tts',
      voice: st.openai || 'onyx',
      input,
      instructions: anweisungen(kanon, seg),
      response_format: 'mp3',
    };
    const key = JSON.stringify(body);
    if (!cache.has(key)) {
      cache.set(
        key,
        fetch('https://api.openai.com/v1/audio/speech', {
          method: 'POST',
          headers: { Authorization: `Bearer ${e.openaiKey}`, 'Content-Type': 'application/json' },
          body: JSON.stringify(body),
        }).then(async (r) => {
          if (!r.ok) {
            cache.delete(key);
            throw new Error(`OpenAI-Sprachausgabe ${r.status}: ${(await r.text()).slice(0, 200)}`);
          }
          return r.blob();
        })
      );
    }
    blobs.push(await cache.get(key));
  }
  return new Blob(blobs, { type: 'audio/mpeg' });
}

class OpenAIEngine {
  constructor() {
    this.audio = new Audio();
  }
  async sprich(kanon, seg, tempo, abbruch) {
    const blob = await openaiAudio(kanon, seg);
    if (abbruch.stop) return;
    const url = URL.createObjectURL(blob);
    this.audio.src = url;
    this.audio.playbackRate = tempo;
    await new Promise((res, rej) => {
      this.audio.onended = res;
      this.audio.onerror = () => rej(new Error('Audio konnte nicht abgespielt werden.'));
      abbruch.abbrechen = () => {
        this.audio.pause();
        res();
      };
      this.audio.play().catch(rej);
    });
    URL.revokeObjectURL(url);
  }
  vorladen(kanon, seg) {
    if (seg && seg.text) openaiAudio(kanon, seg).catch(() => {});
  }
  stop() {
    this.audio.pause();
  }
}

// ------------------------------------------------------------ Player
export class Player {
  constructor({ onSegment, onStatus, onEnde }) {
    this.onSegment = onSegment;
    this.onStatus = onStatus;
    this.onEnde = onEnde;
    this.segmente = [];
    this.i = 0;
    this.laeuft = false;
    this.abbruch = { stop: false };
  }
  engine() {
    const art = einstellungen().tts || 'browser';
    if (!this._engine || this._art !== art) {
      this._engine?.stop();
      this._engine = art === 'openai' ? new OpenAIEngine() : new BrowserEngine();
      this._art = art;
    }
    return this._engine;
  }
  lade(kanon, segmente, titel) {
    this.stopp();
    this.kanon = kanon;
    this.segmente = segmente;
    this.titel = titel;
    this.i = 0;
  }
  async spiele(ab = this.i) {
    this.stopp();
    this.i = ab;
    this.laeuft = true;
    const abbruch = (this.abbruch = { stop: false });
    this.mediaSession();
    while (this.laeuft && !abbruch.stop && this.i < this.segmente.length) {
      const seg = this.segmente[this.i];
      this.onSegment?.(this.i, seg);
      if (seg.text) {
        const naechstes = this.segmente.slice(this.i + 1).find((s) => s.text);
        if (this.engine().vorladen) this.engine().vorladen(this.kanon, naechstes);
        try {
          await this.engine().sprich(this.kanon, seg, einstellungen().tempo || 1, abbruch);
        } catch (e) {
          this.onStatus?.(e.message);
          this.laeuft = false;
          return;
        }
      } else await new Promise((r) => setTimeout(r, 600));
      if (abbruch.stop) return;
      this.i++;
    }
    if (this.i >= this.segmente.length) {
      this.laeuft = false;
      this.onSegment?.(-1);
      this.onEnde?.();
    }
  }
  stopp() {
    this.abbruch.stop = true;
    this.abbruch.abbrechen?.();
    this._engine?.stop();
    this.laeuft = false;
  }
  pause() {
    this.stopp();
    this.onSegment?.(this.i, this.segmente[this.i], true);
  }
  springe(d) {
    const ziel = Math.max(0, Math.min(this.segmente.length - 1, this.i + d));
    if (this.laeuft) this.spiele(ziel);
    else {
      this.i = ziel;
      this.onSegment?.(ziel, this.segmente[ziel], true);
    }
  }
  mediaSession() {
    if (!('mediaSession' in navigator)) return;
    navigator.mediaSession.metadata = new MediaMetadata({ title: this.titel || 'Kapitel', artist: 'Erzählwerk' });
    navigator.mediaSession.setActionHandler('play', () => this.spiele());
    navigator.mediaSession.setActionHandler('pause', () => this.pause());
    navigator.mediaSession.setActionHandler('nexttrack', () => this.springe(1));
    navigator.mediaSession.setActionHandler('previoustrack', () => this.springe(-1));
  }
}

// Ganzes Kapitel als MP3 (nur mit OpenAI-Stimmen).
export async function kapitelAlsMp3(kanon, segmente, fortschritt) {
  const blobs = [];
  const mitText = segmente.filter((s) => s.text);
  for (let i = 0; i < mitText.length; i++) {
    fortschritt?.(i + 1, mitText.length);
    blobs.push(await openaiAudio(kanon, mitText[i]));
  }
  return new Blob(blobs, { type: 'audio/mpeg' });
}
