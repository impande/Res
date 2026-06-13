// Chat interview journey controller.

(function(){
  const S = window.PortfolioState;

  let messages = [];      // [{role:'user'|'assistant', content:string}]
  let sending = false;
  let done = false;

  function init(){
    document.body.innerHTML = `
      <div class="app chat-mode">
        <aside class="sidebar">
          <div class="sidebar-header">
            <div class="brand">
              <div class="brand-mark">P</div>
              <div>
                <div class="brand-text">Portfolio AI</div>
                <div class="brand-sub">Chat Interview</div>
              </div>
            </div>
            <a href="/portfolio.html" class="back">← Switch journey</a>
          </div>
          <div class="chat-progress" id="chat-progress"></div>
          <div class="sidebar-footer">
            <span>Autosaving</span>
            <button onclick="PortfolioChat.confirmReset()">Reset</button>
          </div>
        </aside>
        <main class="main chat-main">
          <div class="chat-stream" id="chat-stream"></div>
          <form class="chat-form" id="chat-form" onsubmit="event.preventDefault(); PortfolioChat.send()">
            <textarea id="chat-input" rows="2" placeholder="Type your answer..." onkeydown="PortfolioChat.handleKey(event)"></textarea>
            <button type="submit" class="btn btn-primary" id="chat-send">Send</button>
          </form>
        </main>
        <aside class="preview-col">
          <div class="preview-head">
            <span class="label">Live Preview</span>
            <span class="label" id="preview-template-name">Minimal</span>
          </div>
          <div class="preview-frame" id="preview-frame"></div>
        </aside>
      </div>
    `;
    window.PortfolioPreview.mount(document.getElementById('preview-frame'));
    S.subscribe(() => {
      renderProgress();
      const tpl = window.PortfolioTemplates.get(S.get().theme?.templateId);
      const nameEl = document.getElementById('preview-template-name');
      if (nameEl && tpl) nameEl.textContent = tpl.name;
    });
    renderProgress();
    // Kick off the conversation
    sendTurn('');
  }

  function renderStream(){
    const el = document.getElementById('chat-stream');
    el.innerHTML = messages.map(m => `
      <div class="msg msg-${m.role}">
        <div class="msg-bubble">${formatContent(m.content)}</div>
      </div>
    `).join('') + (sending ? `
      <div class="msg msg-assistant">
        <div class="msg-bubble">
          <div class="ai-loading"><div class="dot"></div><div class="dot"></div><div class="dot"></div></div>
        </div>
      </div>
    ` : '') + (done ? `
      <div class="msg msg-system">
        <div class="chat-done">
          <div class="ai-spark">✦</div>
          <div>
            <strong>Great — we've covered the essentials.</strong><br>
            <span style="color:var(--muted);font-size:13px">Switch over to the wizard to pick a template, tweak colors, and publish.</span>
          </div>
          <a href="/portfolio.html?mode=wizard#style" class="btn btn-primary">Style & Publish →</a>
        </div>
      </div>
    ` : '');
    el.scrollTop = el.scrollHeight;
  }

  function renderProgress(){
    const s = S.get();
    const items = [
      { label: 'Name',         got: !!(s.identity.firstName || s.identity.lastName) },
      { label: 'Headline',     got: !!s.identity.headline },
      { label: 'About',        got: !!(s.about.bio || s.about.tagline) },
      { label: 'Experience',   got: (s.experience || []).some(e => e.role || e.company) },
      { label: 'Projects',     got: (s.projects || []).some(p => p.title) },
      { label: 'Skills',       got: (s.skills?.groups || []).some(g => g.items?.length) },
      { label: 'Education',    got: (s.education || []).some(e => e.school || e.degree) }
    ];
    const el = document.getElementById('chat-progress');
    if (!el) return;
    el.innerHTML = `
      <div class="progress-label">Gathered so far</div>
      <ul class="progress-list">
        ${items.map(it => `
          <li class="${it.got ? 'got' : ''}">
            <span class="pdot">${it.got ? '✓' : '○'}</span>
            <span>${it.label}</span>
          </li>
        `).join('')}
      </ul>
    `;
  }

  function formatContent(text){
    return String(text || '').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]))
      .replace(/\n/g, '<br>');
  }

  async function send(){
    const inp = document.getElementById('chat-input');
    const text = inp.value.trim();
    if (!text || sending) return;
    inp.value = '';
    await sendTurn(text);
  }

  async function sendTurn(userText){
    if (sending) return;
    if (userText){
      messages.push({ role: 'user', content: userText });
    }
    sending = true;
    document.getElementById('chat-send').disabled = true;
    renderStream();
    try {
      const res = await fetch('/api/portfolio-chat', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          messages: messages,
          stateSnapshot: S.get()
        })
      });
      const data = await res.json();
      if (data.error) throw new Error(data.error);
      // Apply patch (with id-stamping for list items missing ids)
      if (data.patch) applyPatch(data.patch);
      const reply = data.reply || '...';
      messages.push({ role: 'assistant', content: reply });
      if (data.done) done = true;
    } catch(e){
      messages.push({ role: 'assistant', content: 'Sorry — I hit a snag reaching the AI: ' + (e.message || e) + '. Try again, or use the Guided Wizard instead.' });
    } finally {
      sending = false;
      const sendBtn = document.getElementById('chat-send');
      if (sendBtn) sendBtn.disabled = false;
      renderStream();
    }
  }

  function applyPatch(patch){
    // Stamp ids for any list items that arrived without them so future patches can target them.
    const factories = window.PortfolioFactory;
    const stamp = (list, kind) => Array.isArray(list)
      ? list.map(item => item.id ? item : { ...factories[kind](), ...item })
      : list;
    if (patch.experience) patch.experience = stamp(patch.experience, 'experience');
    if (patch.projects) patch.projects = stamp(patch.projects, 'project');
    if (patch.education) patch.education = stamp(patch.education, 'education');
    if (patch.skills?.groups) patch.skills.groups = stamp(patch.skills.groups, 'skillGroup');
    S.set(patch);
  }

  function handleKey(e){
    if (e.key === 'Enter' && !e.shiftKey){
      e.preventDefault();
      send();
    }
  }

  function confirmReset(){
    if (confirm('Reset the conversation and your draft?')){
      messages = [];
      done = false;
      S.reset();
      renderStream();
      sendTurn('');
    }
  }

  window.PortfolioChat = { init, send, handleKey, confirmReset };
})();
