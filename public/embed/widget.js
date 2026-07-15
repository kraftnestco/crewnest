/*!
 * CrewNest embeddable chat widget — Phase 1.
 *
 * Self-contained, dependency-free. A client embeds:
 *   <script src="https://<app>/embed/widget.js" data-crewnest-key="pk_live_xxx" defer></script>
 *
 * Ships NO secrets — only the tenant's public key. Talks to POST /api/chat on the
 * origin that served this script. Renders inside a Shadow DOM so the host page's
 * CSS can neither leak in nor be clobbered. See docs/06-INTEGRATIONS.md §2.2.
 *
 * Optional data-* attributes on the script tag:
 *   data-crewnest-key       (required) tenant public key
 *   data-crewnest-api       override API origin (defaults to this script's origin)
 *   data-crewnest-title     panel header text        (default "Chat with us")
 *   data-crewnest-accent    accent colour            (default "#4f46e5")
 *   data-crewnest-greeting  first assistant bubble   (default a friendly hello)
 */
(function () {
  'use strict';

  if (window.__crewnestWidgetLoaded) return;
  window.__crewnestWidgetLoaded = true;

  // --- locate our own <script> tag (currentScript is null for defer'd scripts) ---
  var script =
    document.currentScript ||
    (function () {
      var all = document.querySelectorAll('script[data-crewnest-key]');
      return all[all.length - 1] || null;
    })();
  if (!script) return;

  var PUBLIC_KEY = script.getAttribute('data-crewnest-key');
  if (!PUBLIC_KEY) {
    console.error('[CrewNest] missing data-crewnest-key on the embed script tag.');
    return;
  }

  var API_BASE =
    script.getAttribute('data-crewnest-api') ||
    (function () {
      try {
        return new URL(script.src, location.href).origin;
      } catch (e) {
        return '';
      }
    })();
  var TITLE = script.getAttribute('data-crewnest-title') || 'Chat with us';
  var ACCENT = script.getAttribute('data-crewnest-accent') || '#4f46e5';
  var GREETING =
    script.getAttribute('data-crewnest-greeting') || 'Hi! 👋 How can we help you today?';

  // --- durable session key (survives reloads; the server keeps the transcript) ---
  var SESSION_STORE_KEY = 'crewnest:session:' + PUBLIC_KEY;
  var sessionKey = '';
  try {
    sessionKey = localStorage.getItem(SESSION_STORE_KEY) || '';
  } catch (e) {}
  if (!sessionKey) {
    sessionKey =
      typeof crypto !== 'undefined' && crypto.randomUUID
        ? crypto.randomUUID()
        : 's_' + Date.now() + '_' + Math.random().toString(36).slice(2);
    try {
      localStorage.setItem(SESSION_STORE_KEY, sessionKey);
    } catch (e) {}
  }

  // --- mount host + Shadow DOM (full style isolation) ---
  var host = document.createElement('div');
  host.setAttribute('data-crewnest-widget', '');
  host.style.cssText = 'all:initial;position:fixed;z-index:2147483000;';
  document.body.appendChild(host);
  var root = host.attachShadow({ mode: 'open' });

  var style = document.createElement('style');
  style.textContent = [
    ':host{ all: initial; }',
    '*{ box-sizing:border-box; font-family:-apple-system,BlinkMacSystemFont,"Segoe UI",Roboto,Helvetica,Arial,sans-serif; }',
    '.launcher{ position:fixed; bottom:20px; right:20px; width:60px; height:60px; border-radius:50%;',
    '  border:none; cursor:pointer; background:' + ACCENT + '; color:#fff; box-shadow:0 6px 20px rgba(0,0,0,.25);',
    '  display:flex; align-items:center; justify-content:center; transition:transform .15s ease, box-shadow .15s ease; }',
    '.launcher:hover{ transform:scale(1.06); box-shadow:0 8px 26px rgba(0,0,0,.3); }',
    '.launcher svg{ width:28px; height:28px; }',
    '.panel{ position:fixed; bottom:92px; right:20px; width:370px; max-width:calc(100vw - 32px);',
    '  height:560px; max-height:calc(100vh - 120px); background:#fff; border-radius:16px; overflow:hidden;',
    '  box-shadow:0 12px 48px rgba(0,0,0,.24); display:none; flex-direction:column; opacity:0;',
    '  transform:translateY(12px) scale(.98); transition:opacity .16s ease, transform .16s ease; }',
    '.panel.open{ display:flex; opacity:1; transform:translateY(0) scale(1); }',
    '.header{ background:' + ACCENT + '; color:#fff; padding:16px 18px; display:flex; align-items:center;',
    '  justify-content:space-between; flex:0 0 auto; }',
    '.header h3{ margin:0; font-size:16px; font-weight:600; }',
    '.header .status{ margin:2px 0 0; font-size:12px; opacity:.85; font-weight:400; }',
    '.header button{ background:transparent; border:none; color:#fff; cursor:pointer; padding:4px; opacity:.85; }',
    '.header button:hover{ opacity:1; }',
    '.messages{ flex:1 1 auto; overflow-y:auto; padding:16px; background:#f7f7f9; display:flex; flex-direction:column; gap:10px; }',
    '.row{ display:flex; }',
    '.row.user{ justify-content:flex-end; }',
    '.bubble{ max-width:80%; padding:10px 13px; border-radius:14px; font-size:14px; line-height:1.45; white-space:pre-wrap; word-wrap:break-word; }',
    '.row.bot .bubble{ background:#fff; color:#1f2330; border:1px solid #e6e6ec; border-bottom-left-radius:4px; }',
    '.row.user .bubble{ background:' + ACCENT + '; color:#fff; border-bottom-right-radius:4px; }',
    '.row.system{ justify-content:center; }',
    '.row.system .bubble{ background:#eef0f5; color:#5b6072; font-size:12px; border-radius:10px; }',
    '.typing .bubble{ background:#fff; border:1px solid #e6e6ec; display:inline-flex; gap:4px; align-items:center; }',
    '.dot{ width:6px; height:6px; border-radius:50%; background:#b3b7c2; animation:cn-blink 1.2s infinite ease-in-out; }',
    '.dot:nth-child(2){ animation-delay:.2s; } .dot:nth-child(3){ animation-delay:.4s; }',
    '@keyframes cn-blink{ 0%,80%,100%{ opacity:.3; } 40%{ opacity:1; } }',
    '.footer{ flex:0 0 auto; border-top:1px solid #ececf1; padding:10px; display:flex; gap:8px; background:#fff; }',
    '.footer textarea{ flex:1 1 auto; resize:none; border:1px solid #d9dae2; border-radius:10px; padding:10px 12px;',
    '  font-size:14px; line-height:1.4; max-height:96px; outline:none; }',
    '.footer textarea:focus{ border-color:' + ACCENT + '; }',
    '.footer button{ flex:0 0 auto; border:none; background:' + ACCENT + '; color:#fff; border-radius:10px;',
    '  width:44px; cursor:pointer; display:flex; align-items:center; justify-content:center; }',
    '.footer button:disabled{ opacity:.5; cursor:default; }',
    '.footer button svg{ width:18px; height:18px; }',
    '.branding{ text-align:center; font-size:11px; color:#a7abb8; padding:0 0 8px; background:#fff; }',
  ].join('\n');
  root.appendChild(style);

  var CHAT_ICON =
    '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M21 11.5a8.38 8.38 0 0 1-.9 3.8 8.5 8.5 0 0 1-7.6 4.7 8.38 8.38 0 0 1-3.8-.9L3 21l1.9-5.7a8.38 8.38 0 0 1-.9-3.8 8.5 8.5 0 0 1 4.7-7.6 8.38 8.38 0 0 1 3.8-.9h.5a8.48 8.48 0 0 1 8 8v.5z"/></svg>';
  var CLOSE_ICON =
    '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>';
  var SEND_ICON =
    '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><line x1="22" y1="2" x2="11" y2="13"/><polygon points="22 2 15 22 11 13 2 9 22 2"/></svg>';

  var launcher = document.createElement('button');
  launcher.className = 'launcher';
  launcher.setAttribute('aria-label', 'Open chat');
  launcher.innerHTML = CHAT_ICON;
  root.appendChild(launcher);

  var panel = document.createElement('div');
  panel.className = 'panel';
  panel.setAttribute('role', 'dialog');
  panel.setAttribute('aria-label', TITLE);
  panel.innerHTML =
    '<div class="header">' +
    '<div><h3></h3><p class="status">We typically reply in a few minutes</p></div>' +
    '<button class="close" aria-label="Close chat">' + CLOSE_ICON + '</button>' +
    '</div>' +
    '<div class="messages" aria-live="polite"></div>' +
    '<div class="branding">Powered by CrewNest</div>' +
    '<div class="footer">' +
    '<textarea rows="1" placeholder="Type a message…" aria-label="Message"></textarea>' +
    '<button class="send" aria-label="Send">' + SEND_ICON + '</button>' +
    '</div>';
  root.appendChild(panel);

  // header title via textContent (never innerHTML) to stay XSS-safe.
  panel.querySelector('h3').textContent = TITLE;

  var messagesEl = panel.querySelector('.messages');
  var textarea = panel.querySelector('textarea');
  var sendBtn = panel.querySelector('.send');
  var closeBtn = panel.querySelector('.close');

  var greeted = false;
  var sending = false;

  function addMessage(kind, text) {
    var row = document.createElement('div');
    row.className = 'row ' + kind;
    var bubble = document.createElement('div');
    bubble.className = 'bubble';
    bubble.textContent = text; // XSS-safe: user + model text as plain text.
    row.appendChild(bubble);
    messagesEl.appendChild(row);
    messagesEl.scrollTop = messagesEl.scrollHeight;
    return row;
  }

  function showTyping() {
    var row = document.createElement('div');
    row.className = 'row bot typing';
    row.innerHTML = '<div class="bubble"><span class="dot"></span><span class="dot"></span><span class="dot"></span></div>';
    messagesEl.appendChild(row);
    messagesEl.scrollTop = messagesEl.scrollHeight;
    return row;
  }

  function openPanel() {
    panel.classList.add('open');
    launcher.setAttribute('aria-label', 'Close chat');
    if (!greeted) {
      greeted = true;
      addMessage('bot', GREETING);
    }
    setTimeout(function () {
      textarea.focus();
    }, 60);
  }

  function closePanel() {
    panel.classList.remove('open');
    launcher.setAttribute('aria-label', 'Open chat');
  }

  function togglePanel() {
    if (panel.classList.contains('open')) closePanel();
    else openPanel();
  }

  function send() {
    var text = textarea.value.trim();
    if (!text || sending) return;

    sending = true;
    sendBtn.disabled = true;
    textarea.value = '';
    textarea.style.height = 'auto';
    addMessage('user', text);
    var typing = showTyping();

    fetch(API_BASE + '/api/chat', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ key: PUBLIC_KEY, sessionKey: sessionKey, text: text }),
    })
      .then(function (r) {
        return r
          .json()
          .catch(function () {
            return {};
          })
          .then(function (data) {
            return { status: r.status, data: data };
          });
      })
      .then(function (res) {
        typing.remove();
        var d = res.data || {};
        if (res.status === 429) {
          addMessage('system', 'You are sending messages too quickly — please wait a moment.');
        } else if (res.status >= 400) {
          addMessage('bot', 'Sorry, something went wrong. Please try again.');
        } else if (d.reply) {
          addMessage('bot', d.reply);
        } else if (d.handoff) {
          addMessage('system', 'Connecting you with a team member — they will reply here shortly.');
        } else {
          addMessage('bot', 'Thanks! Someone will follow up with you shortly.');
        }
      })
      .catch(function () {
        typing.remove();
        addMessage('bot', 'Network error — please try again.');
      })
      .then(function () {
        sending = false;
        sendBtn.disabled = false;
        textarea.focus();
      });
  }

  // --- events ---
  launcher.addEventListener('click', togglePanel);
  closeBtn.addEventListener('click', closePanel);
  sendBtn.addEventListener('click', send);
  textarea.addEventListener('keydown', function (e) {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      send();
    }
  });
  textarea.addEventListener('input', function () {
    textarea.style.height = 'auto';
    textarea.style.height = Math.min(textarea.scrollHeight, 96) + 'px';
  });
})();
