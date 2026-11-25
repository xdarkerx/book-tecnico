/* ═══ Service worker do app instalado (PWA) ═══
 * Não guarda o app em cache: o Book Técnico sempre carrega do servidor (dados e versão sempre atuais).
 * Só mostra uma página amigável quando o servidor não responde (sem rede, VPN desligada…).
 */
const OFFLINE = `<!doctype html><html lang="pt-BR"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>Book Técnico — sem conexão</title>
<style>body{margin:0;min-height:100vh;display:grid;place-items:center;background:#0e1020;color:#e8eaf5;font:15px/1.6 "Segoe UI",system-ui,sans-serif;padding:16px}
.c{max-width:420px;text-align:center}h1{font-size:20px;margin:12px 0 4px}p{color:#b9bdd6}button{margin-top:14px;border:0;border-radius:9px;padding:10px 18px;background:#5E3FE1;color:#fff;font-weight:600;cursor:pointer}</style>
<div class="c"><svg width="48" height="48" viewBox="0 0 32 32"><defs><linearGradient id="g" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="#5E3FE1"/><stop offset="1" stop-color="#86D2EF"/></linearGradient></defs><rect width="32" height="32" rx="8" fill="#171C37"/><path d="M9 8h10a4 4 0 0 1 0 8H9zM9 16h12a4 4 0 0 1 0 8H9z" fill="none" stroke="url(#g)" stroke-width="2.6"/></svg>
<h1>Sem conexão com o servidor</h1><p>Confira a rede ou a VPN da empresa e tente de novo.</p><button onclick="location.reload()">Tentar de novo</button></div></html>`;

self.addEventListener('install', () => self.skipWaiting());
self.addEventListener('activate', (e) => e.waitUntil(self.clients.claim()));
self.addEventListener('fetch', (e) => {
  if (e.request.mode !== 'navigate') return; // API, scripts e imagens: direto ao servidor, sem o service worker
  e.respondWith(fetch(e.request).catch(() => new Response(OFFLINE, { headers: { 'Content-Type': 'text/html; charset=utf-8' } })));
});
