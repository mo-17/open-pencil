import { effectPickRuntimeSource } from '@open-pencil/compiler/browser-preview'
import { findEffectPickArtifact, requireEffectPickConfig } from '@open-pencil/core/plugins'

import { EFFECT_PICK_PREVIEW_PROTOCOL, parseEffectPickPreviewMessage } from './protocol'

const scriptJSON = (value: unknown) => JSON.stringify(value).replaceAll('<', '\\u003c')

/** Only pinned local catalog code enters this opaque document. Authored config arrives via a port. */
export function buildEffectPickPreviewDocument(
  config: unknown,
  instanceId: string,
  parentOrigin: string
): string {
  if (
    !parseEffectPickPreviewMessage(
      { protocol: EFFECT_PICK_PREVIEW_PROTOCOL, instanceId, type: 'ready' },
      instanceId
    )
  ) {
    throw new TypeError('Effect preview instance identity is invalid')
  }
  const parsed = requireEffectPickConfig(config)
  const entry = findEffectPickArtifact(parsed)
  if (!entry) throw new TypeError('Unknown reviewed effect artifact')
  const nonce = instanceId.replaceAll('-', '')
  const bootstrap = `
const protocol = ${scriptJSON(EFFECT_PICK_PREVIEW_PROTOCOL)};
const instanceId = ${scriptJSON(instanceId)};
const parentOrigin = ${scriptJSON(parentOrigin)};
let port = null;
let runtime = null;
let closed = false;
const record = (value) => value !== null && typeof value === 'object' && !Array.isArray(value);
const exact = (value, keys) => record(value) && Object.keys(value).length === keys.length && keys.every(key => Object.hasOwn(value, key));
const envelope = (type, extra = {}) => ({ protocol, instanceId, type, ...extra });
const send = (type, extra) => { if (!closed && port) port.postMessage(envelope(type, extra)); };
const receive = (event) => {
  const data = event.data;
  if (!record(data) || data.protocol !== protocol || data.instanceId !== instanceId || closed) return;
  try {
    if (data.type === 'mount' && exact(data, ['protocol','instanceId','type','config','reducedMotion','playing']) && !runtime && typeof data.reducedMotion === 'boolean' && typeof data.playing === 'boolean') {
      runtime = mountEffectPick(document.getElementById('effect-root'), data.config, () => send('click'));
      runtime.setReducedMotion(data.reducedMotion);
      if (!data.playing) runtime.pause();
      send('mounted');
    } else if (data.type === 'config' && exact(data, ['protocol','instanceId','type','config']) && runtime) {
      if (!runtime.setConfig(data.config)) throw new TypeError('Invalid effect configuration');
    } else if (data.type === 'reducedMotion' && exact(data, ['protocol','instanceId','type','value']) && typeof data.value === 'boolean' && runtime) {
      runtime.setReducedMotion(data.value);
    } else if (exact(data, ['protocol','instanceId','type']) && runtime) {
      if (data.type === 'play') runtime.play();
      else if (data.type === 'pause') runtime.pause();
      else if (data.type === 'replay') runtime.replay();
      else if (data.type === 'destroy') dispose();
    }
  } catch { send('error', { message: 'Effect preview configuration was rejected' }); dispose(); }
};
const connect = (event) => {
  if (closed || port || event.source !== window.parent || event.origin !== parentOrigin || event.ports.length !== 1) return;
  if (!exact(event.data, ['protocol','instanceId','type']) || event.data.protocol !== protocol || event.data.instanceId !== instanceId || event.data.type !== 'connect') return;
  port = event.ports[0];
  window.removeEventListener('message', connect);
  port.onmessage = receive;
  port.start();
  if (document.readyState === 'complete') send('loaded');
};
function dispose() {
  if (closed) return;
  closed = true;
  window.removeEventListener('message', connect);
  runtime?.destroy();
  runtime = null;
  if (port) { port.onmessage = null; port.close(); port = null; }
}
window.addEventListener('message', connect);
window.addEventListener('pagehide', dispose, { once: true });
window.addEventListener('load', () => send('loaded'), { once: true });
window.parent.postMessage(envelope('ready'), parentOrigin);
`
  const javascript = `${effectPickRuntimeSource([entry])}\n${bootstrap}`.replace(
    /<\/script/gi,
    '<\\/script'
  )
  const csp = [
    "default-src 'none'",
    "base-uri 'none'",
    "object-src 'none'",
    "frame-src 'none'",
    "child-src 'none'",
    "worker-src 'none'",
    "connect-src 'none'",
    "form-action 'none'",
    "img-src 'none'",
    "font-src 'none'",
    "media-src 'none'",
    "style-src 'unsafe-inline'",
    `script-src 'nonce-${nonce}'`
  ].join('; ')
  return `<!doctype html><html><head><meta charset="utf-8"><meta name="referrer" content="no-referrer"><meta http-equiv="Content-Security-Policy" content="${csp}"><style>html,body{margin:0;width:100%;height:100%;background:#10121b}#effect-root{width:100%;height:100%}</style></head><body><div id="effect-root"></div><script nonce="${nonce}">${javascript}</script></body></html>`
}
