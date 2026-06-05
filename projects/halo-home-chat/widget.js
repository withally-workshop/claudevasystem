(function () {
  'use strict';

  var BACKEND_URL = 'https://halo-home-chat.onrender.com';
  var SESSION_KEY = 'halo_chat_history';
  var EMAIL_KEY = 'halo_chat_email';
  var BADGE_DISMISSED_KEY = 'halo_badge_dismissed';
  var GREETING = "Hi! I'm Mimi, your Halo Home guide. Ask me about our products, filters, or your order.";
  var BADGE_MESSAGES = [
    "Hey! I'm Mimi, your Halo Home guide 👋",
    "Bye bye, chlorine. Hello, healthy skin & hair 🚿",
    "Not sure which filter suits you? Ask me! 💧",
    "Got a question about your order? I'm here 💬",
    "Make your home your heaven 🌿",
    "New to Halo Home? Let me show you around ✨",
    "Ask me anything — I'm here to help!",
    "Sensitive skin? I'll find the right filter for you 🌸",
    "Never run out of filters — ask me about the Refill Plan!",
    "Free to chat anytime. What can I help with? 😊",
  ];
  var LOGO_URL = 'https://cdn.shopify.com/s/files/1/0821/7765/5106/files/HaloHomeFavicon.png?v=1755746071';

  var history = [];
  var customerEmail = null;
  var isOpen = false;
  var isLoading = false;

  // ─── Styles ───────────────────────────────────────────────────────────────

  var css = `
    #halo-chat-bubble {
      position: fixed; bottom: 24px; right: 24px; z-index: 9999;
      width: 56px; height: 56px; border-radius: 50%;
      background: #1a1a1a; color: #fff; border: none; cursor: pointer;
      box-shadow: 0 4px 16px rgba(0,0,0,0.25);
      display: flex; align-items: center; justify-content: center;
      font-size: 24px; transition: transform 0.2s; overflow: hidden; padding: 0;
    }
    #halo-chat-bubble img { width: 100%; height: 100%; object-fit: cover; border-radius: 50%; }
    #halo-chat-bubble:hover { transform: scale(1.08); }
    #halo-chat-badge {
      position: fixed; bottom: 92px; right: 24px; z-index: 9999;
      background: #fff; border-radius: 20px;
      box-shadow: 0 4px 16px rgba(0,0,0,0.12);
      padding: 10px 14px 10px 14px; max-width: calc(100vw - 80px);
      font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif;
      font-size: 13px; line-height: 1; color: #1a1a1a; white-space: nowrap;
      display: flex; align-items: center; gap: 10px; cursor: pointer;
      animation: halo-badge-in 0.3s ease;
    }
    #halo-chat-badge:hover { box-shadow: 0 6px 20px rgba(0,0,0,0.16); }
    #halo-badge-close {
      background: none; border: none; cursor: pointer; color: #999;
      font-size: 14px; line-height: 1; padding: 0; flex-shrink: 0; margin-top: 1px;
    }
    @keyframes halo-badge-in {
      from { opacity: 0; transform: translateY(8px); }
      to   { opacity: 1; transform: translateY(0); }
    }
    #halo-badge-text {
      transition: opacity 0.4s ease;
    }
    #halo-badge-text.fade-out { opacity: 0; }
    #halo-badge-text.fade-in  { opacity: 1; }
    #halo-chat-window {
      position: fixed; bottom: 94px; right: 24px; z-index: 9999;
      width: 360px; max-width: calc(100vw - 32px);
      height: 520px; max-height: calc(100vh - 170px);
      background: #fff; border-radius: 16px;
      box-shadow: 0 8px 32px rgba(0,0,0,0.18);
      display: flex; flex-direction: column; overflow: hidden;
      font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif;
      font-size: 14px;
    }
    #halo-chat-header {
      background: #1a1a1a; color: #fff;
      padding: 14px 16px; display: flex; align-items: center; justify-content: space-between;
      flex-shrink: 0;
    }
    #halo-chat-header span { font-weight: 600; font-size: 15px; }
    #halo-chat-close {
      background: none; border: none; color: #fff; cursor: pointer;
      font-size: 20px; line-height: 1; padding: 0;
    }
    #halo-chat-messages {
      flex: 1; overflow-y: auto; padding: 16px;
      display: flex; flex-direction: column; gap: 10px;
    }
    .halo-msg {
      max-width: 85%; padding: 10px 14px; border-radius: 12px; line-height: 1.45;
      word-break: break-word;
    }
    .halo-msg-bot {
      background: #f2f2f2; color: #1a1a1a; align-self: flex-start;
      border-bottom-left-radius: 4px;
    }
    .halo-msg-user {
      background: #1a1a1a; color: #fff; align-self: flex-end;
      border-bottom-right-radius: 4px;
    }
    .halo-msg-typing {
      background: #f2f2f2; align-self: flex-start;
      border-bottom-left-radius: 4px; padding: 12px 16px;
    }
    .halo-dots span {
      display: inline-block; width: 6px; height: 6px; border-radius: 50%;
      background: #999; margin: 0 2px;
      animation: halo-blink 1.2s infinite both;
    }
    .halo-dots span:nth-child(2) { animation-delay: 0.2s; }
    .halo-dots span:nth-child(3) { animation-delay: 0.4s; }
    @keyframes halo-blink {
      0%, 80%, 100% { opacity: 0.2; } 40% { opacity: 1; }
    }
    #halo-chat-input-row {
      padding: 12px; border-top: 1px solid #eee;
      display: flex; gap: 8px; flex-shrink: 0;
    }
    #halo-chat-input {
      flex: 1; border: 1px solid #ddd; border-radius: 8px;
      padding: 9px 12px; font-size: 14px; outline: none;
      font-family: inherit; resize: none;
    }
    #halo-chat-input:focus { border-color: #1a1a1a; }
    #halo-chat-send {
      background: #1a1a1a; color: #fff; border: none;
      border-radius: 8px; padding: 9px 14px; cursor: pointer;
      font-size: 18px; line-height: 1; flex-shrink: 0;
    }
    #halo-chat-send:disabled { opacity: 0.4; cursor: default; }
    @media (max-width: 400px) {
      #halo-chat-window { right: 8px; width: calc(100vw - 16px); bottom: 148px; }
      #halo-chat-bubble { right: 16px; bottom: 72px; }
      #halo-chat-badge  { right: 16px; bottom: 140px; max-width: calc(100vw - 48px); }
    }
  `;

  // ─── DOM ──────────────────────────────────────────────────────────────────

  function injectStyles() {
    var el = document.createElement('style');
    el.textContent = css;
    document.head.appendChild(el);
  }

  function buildUI() {
    var bubble = document.createElement('button');
    bubble.id = 'halo-chat-bubble';
    bubble.setAttribute('aria-label', 'Open chat');
    if (LOGO_URL) {
      var img = document.createElement('img');
      img.src = LOGO_URL;
      img.alt = 'Halo';
      img.onerror = function() { bubble.innerHTML = '💬'; };
      bubble.appendChild(img);
    } else {
      bubble.innerHTML = '💬';
    }
    bubble.addEventListener('click', toggleWindow);
    document.body.appendChild(bubble);

    // Greeting badge — rotates through messages, shown until dismissed or chat opened
    try {
      var dismissed = sessionStorage.getItem(BADGE_DISMISSED_KEY);
      if (!dismissed) {
        var msgIndex = Math.floor(Math.random() * BADGE_MESSAGES.length);
        var badge = document.createElement('div');
        badge.id = 'halo-chat-badge';
        badge.innerHTML = '<span id="halo-badge-text">' + BADGE_MESSAGES[msgIndex] + '</span><button id="halo-badge-close" aria-label="Dismiss">&times;</button>';
        badge.addEventListener('click', function(e) {
          if (e.target.id === 'halo-badge-close') { dismissBadge(); }
          else { dismissBadge(); toggleWindow(); }
        });
        document.body.appendChild(badge);

        // Rotate message every 4 seconds
        var rotateInterval = setInterval(function() {
          var textEl = document.getElementById('halo-badge-text');
          if (!textEl) { clearInterval(rotateInterval); return; }
          textEl.classList.add('fade-out');
          setTimeout(function() {
            if (!textEl) return;
            msgIndex = (msgIndex + 1) % BADGE_MESSAGES.length;
            textEl.textContent = BADGE_MESSAGES[msgIndex];
            textEl.classList.remove('fade-out');
          }, 400);
        }, 8000);
      }
    } catch(e) {}

    var win = document.createElement('div');
    win.id = 'halo-chat-window';
    win.style.display = 'none';
    win.innerHTML = `
      <div id="halo-chat-header">
        <span>Mimi — Your Halo Home Guide</span>
        <button id="halo-chat-close" aria-label="Close chat">&times;</button>
      </div>
      <div id="halo-chat-messages"></div>
      <div id="halo-chat-input-row">
        <textarea id="halo-chat-input" rows="1" placeholder="Ask about products or your order…"></textarea>
        <button id="halo-chat-send" aria-label="Send">&#8593;</button>
      </div>
    `;
    document.body.appendChild(win);

    document.getElementById('halo-chat-close').addEventListener('click', closeWindow);
    document.getElementById('halo-chat-send').addEventListener('click', handleSend);
    document.getElementById('halo-chat-input').addEventListener('keydown', function (e) {
      if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); handleSend(); }
    });

    // auto-resize textarea
    document.getElementById('halo-chat-input').addEventListener('input', function () {
      this.style.height = 'auto';
      this.style.height = Math.min(this.scrollHeight, 100) + 'px';
    });
  }

  // ─── State ────────────────────────────────────────────────────────────────

  function loadSession() {
    try {
      var raw = sessionStorage.getItem(SESSION_KEY);
      if (raw) history = JSON.parse(raw);
      customerEmail = sessionStorage.getItem(EMAIL_KEY) || null;
    } catch {}
  }

  function saveSession() {
    try {
      sessionStorage.setItem(SESSION_KEY, JSON.stringify(history.slice(-20)));
      if (customerEmail) sessionStorage.setItem(EMAIL_KEY, customerEmail);
    } catch {}
  }

  // ─── UI helpers ───────────────────────────────────────────────────────────

  function appendMessage(text, role) {
    var container = document.getElementById('halo-chat-messages');
    var el = document.createElement('div');
    el.className = 'halo-msg ' + (role === 'user' ? 'halo-msg-user' : 'halo-msg-bot');
    el.textContent = text;
    container.appendChild(el);
    container.scrollTop = container.scrollHeight;
    return el;
  }

  function showTyping() {
    var container = document.getElementById('halo-chat-messages');
    var el = document.createElement('div');
    el.className = 'halo-msg halo-msg-typing';
    el.id = 'halo-typing';
    el.innerHTML = '<div class="halo-dots"><span></span><span></span><span></span></div>';
    container.appendChild(el);
    container.scrollTop = container.scrollHeight;
  }

  function hideTyping() {
    var el = document.getElementById('halo-typing');
    if (el) el.remove();
  }

  function renderHistory() {
    var container = document.getElementById('halo-chat-messages');
    container.innerHTML = '';
    appendMessage(GREETING, 'bot');
    history.forEach(function (m) {
      appendMessage(m.content, m.role === 'user' ? 'user' : 'bot');
    });
  }

  // ─── Window toggle ────────────────────────────────────────────────────────

  function dismissBadge() {
    try { sessionStorage.setItem(BADGE_DISMISSED_KEY, '1'); } catch(e) {}
    var badge = document.getElementById('halo-chat-badge');
    if (badge) badge.remove();
  }

  function toggleWindow() {
    isOpen ? closeWindow() : openWindow();
  }

  function openWindow() {
    isOpen = true;
    dismissBadge();
    var win = document.getElementById('halo-chat-window');
    var bubble = document.getElementById('halo-chat-bubble');
    win.style.display = 'flex';
    bubble.innerHTML = '✕';
    renderHistory();
    document.getElementById('halo-chat-input').focus();
  }

  function closeWindow() {
    isOpen = false;
    var win = document.getElementById('halo-chat-window');
    var bubble = document.getElementById('halo-chat-bubble');
    win.style.display = 'none';
    bubble.innerHTML = '';
    if (LOGO_URL) {
      var img = document.createElement('img');
      img.src = LOGO_URL;
      img.alt = 'Halo';
      img.onerror = function() { bubble.innerHTML = '💬'; };
      bubble.appendChild(img);
    } else {
      bubble.innerHTML = '💬';
    }
  }

  // ─── Chat ─────────────────────────────────────────────────────────────────

  function extractEmail(text) {
    var match = text.match(/[a-zA-Z0-9._%+\-]+@[a-zA-Z0-9.\-]+\.[a-zA-Z]{2,}/);
    return match ? match[0] : null;
  }

  function handleSend() {
    if (isLoading) return;
    var input = document.getElementById('halo-chat-input');
    var text = input.value.trim();
    if (!text) return;

    // Detect email in message
    var detectedEmail = extractEmail(text);
    if (detectedEmail) customerEmail = detectedEmail;

    input.value = '';
    input.style.height = 'auto';

    appendMessage(text, 'user');
    history.push({ role: 'user', content: text });
    saveSession();

    sendToBackend(text);
  }

  function sendToBackend(message) {
    isLoading = true;
    document.getElementById('halo-chat-send').disabled = true;
    showTyping();

    var payload = {
      message: message,
      conversation_history: history.slice(-10, -1), // exclude the just-added message
    };
    if (customerEmail) payload.email = customerEmail;

    fetch(BACKEND_URL + '/chat', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    })
      .then(function (res) { return res.json(); })
      .then(function (data) {
        hideTyping();
        var reply = data.response || data.error || 'Something went wrong — please try again.';
        var parts = reply.split('|||').map(function(s) { return s.trim(); }).filter(Boolean);
        history.push({ role: 'assistant', content: parts.join(' ') });
        saveSession();
        displayParts(parts, 0);
      })
      .catch(function () {
        hideTyping();
        appendMessage('Connection issue — please try again in a moment.', 'bot');
        isLoading = false;
        document.getElementById('halo-chat-send').disabled = false;
        document.getElementById('halo-chat-input').focus();
      });
  }

  function displayParts(parts, index) {
    if (index >= parts.length) {
      isLoading = false;
      document.getElementById('halo-chat-send').disabled = false;
      document.getElementById('halo-chat-input').focus();
      return;
    }
    appendMessage(parts[index], 'bot');
    if (index + 1 < parts.length) {
      setTimeout(function() {
        showTyping();
        var delay = Math.min(600 + parts[index + 1].length * 18, 1800);
        setTimeout(function() {
          hideTyping();
          displayParts(parts, index + 1);
        }, delay);
      }, 300);
    } else {
      displayParts(parts, index + 1);
    }
  }

  // ─── Init ─────────────────────────────────────────────────────────────────

  function init() {
    injectStyles();
    loadSession();
    buildUI();
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
})();
