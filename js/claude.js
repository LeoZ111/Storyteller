// Verbindung zu Claude ueber das offizielle Anthropic-SDK (im Browser gebuendelt).
import Anthropic from '../vendor/anthropic-sdk.js';
import { einstellungen } from './store.js';

export const MODELLE = {
  'claude-opus-5-5': 'Claude Opus 5.5 (empfohlen)',
  'claude-fable-5-2': 'Claude Fable 5.2 (beste Qualität, teurer)',
  'claude-sonnet-5-5': 'Claude Sonnet 5.5 (günstiger)',
};

function client() {
  const key = einstellungen().anthropicKey;
  if (!key) throw new Error('Bitte zuerst in den Einstellungen deinen Anthropic-API-Schlüssel eintragen.');
  return new Anthropic({ apiKey: key, dangerouslyAllowBrowser: true, maxRetries: 3 });
}

function anfrage({ system, user, effort, maxTokens, format }) {
  const req = {
    model: einstellungen().modell || 'claude-opus-5-5',
    max_tokens: maxTokens || 64000,
    // Faellt das Modell aus Sicherheitsgruenden aus, uebernimmt serverseitig ein Ersatzmodell.
    betas: ['server-side-fallback-2026-07-01'],
    fallbacks: 'default',
    thinking: { type: 'adaptive' },
    output_config: { effort: effort || 'high' },
    system,
    messages: [{ role: 'user', content: user }],
  };
  if (format) req.output_config.format = format;
  return req;
}

function pruefeEnde(msg) {
  if (msg.stop_reason === 'refusal')
    throw new Error('Claude hat diese Anfrage abgelehnt' + (msg.stop_details?.explanation ? `: ${msg.stop_details.explanation}` : '.'));
  if (msg.stop_reason === 'max_tokens')
    throw new Error('Die Antwort wurde abgeschnitten (Token-Limit erreicht).');
}

// Nur der Text nach dem letzten Modellwechsel zaehlt.
function textAus(msg) {
  let teile = [];
  for (const b of msg.content) {
    if (b.type === 'fallback') teile = [];
    else if (b.type === 'text') teile.push(b.text);
  }
  return teile.join('');
}

function kosten(msg) {
  const u = msg.usage || {};
  return {
    ein: (u.input_tokens || 0) + (u.cache_read_input_tokens || 0) + (u.cache_creation_input_tokens || 0),
    aus: u.output_tokens || 0,
    cache: u.cache_read_input_tokens || 0,
  };
}

export async function textAnfrage(opts, onText) {
  const stream = client().beta.messages.stream(anfrage(opts));
  let text = '';
  for await (const ev of stream) {
    if (ev.type === 'content_block_start' && ev.content_block.type === 'fallback') {
      text = '';
      onText?.(text);
    } else if (ev.type === 'content_block_delta' && ev.delta.type === 'text_delta') {
      text += ev.delta.text;
      onText?.(text);
    }
  }
  const msg = await stream.finalMessage();
  pruefeEnde(msg);
  return { text: textAus(msg), usage: kosten(msg) };
}

export async function jsonAnfrage(opts) {
  const stream = client().beta.messages.stream(
    anfrage({ ...opts, format: { type: 'json_schema', schema: opts.schema } })
  );
  const msg = await stream.finalMessage();
  pruefeEnde(msg);
  const raw = textAus(msg);
  try {
    return { daten: JSON.parse(raw), usage: kosten(msg) };
  } catch (e) {
    throw new Error('Claude hat kein gültiges JSON geliefert: ' + raw.slice(0, 200));
  }
}
