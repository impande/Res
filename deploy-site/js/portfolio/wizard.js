// Wizard journey controller. Renders form steps that mutate PortfolioState.

(function(){
  const S = window.PortfolioState;
  const F = window.PortfolioFactory;

  const STEPS = [
    { id: 'basics',     label: 'Basics',       title: 'Who are you?',         desc: 'Name, role, contact details.' },
    { id: 'about',      label: 'About',        title: 'Tell your story',      desc: 'A tagline and short bio.' },
    { id: 'experience', label: 'Experience',   title: 'Where have you been?', desc: 'Roles, companies, key highlights.' },
    { id: 'projects',   label: 'Projects',     title: 'What have you built?', desc: 'Selected work to showcase.' },
    { id: 'skills',     label: 'Skills',       title: 'What can you do?',     desc: 'Group your strengths so they read clearly.' },
    { id: 'education',  label: 'Education',    title: 'How did you learn?',   desc: 'Degrees, programs, bootcamps.' },
    { id: 'style',      label: 'Style',        title: 'Make it yours',        desc: 'Template, accent color, fonts, light or dark.' },
    { id: 'review',     label: 'Review',       title: 'Ready to launch',      desc: 'Look over everything, then publish or download.' }
  ];

  let currentStep = 0;

  // ===== Boot =====
  function init(){
    document.body.classList.add('wizard-mode');
    document.body.innerHTML = `
      <div class="app">
        <aside class="sidebar">
          <div class="sidebar-header">
            <div class="brand">
              <div class="brand-mark">P</div>
              <div>
                <div class="brand-text">Portfolio AI</div>
                <div class="brand-sub">Guided Wizard</div>
              </div>
            </div>
            <a href="/portfolio.html" class="back">← Switch journey</a>
          </div>
          <div class="steps" id="step-nav"></div>
          <div class="sidebar-footer">
            <span id="autosave-tag">Autosaving</span>
            <button onclick="PortfolioWizard.confirmReset()">Reset draft</button>
          </div>
        </aside>
        <main class="main">
          <div id="panels"></div>
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
    renderStepNav();
    renderPanels();
    goStep(0);
    window.PortfolioPreview.mount(document.getElementById('preview-frame'));
    // Wizard subscriber only updates the small preview header label — full panel
    // re-renders happen only on add/remove/navigate to preserve input focus.
    S.subscribe(() => {
      const tpl = window.PortfolioTemplates.get(S.get().theme?.templateId);
      const nameEl = document.getElementById('preview-template-name');
      if (nameEl && tpl) nameEl.textContent = tpl.name;
    });
  }

  function renderStepNav(){
    const nav = document.getElementById('step-nav');
    nav.innerHTML = STEPS.map((s, i) => `
      <button class="step-btn" data-step="${i}" onclick="PortfolioWizard.goStep(${i})">
        <div class="step-num">${i+1}</div>
        <div class="step-label">${s.label}</div>
      </button>
    `).join('');
    updateStepNav();
  }

  function updateStepNav(){
    document.querySelectorAll('.step-btn').forEach((b, i) => {
      b.classList.toggle('active', i === currentStep);
      b.classList.toggle('done', i < currentStep);
    });
  }

  function renderPanels(){
    document.getElementById('panels').innerHTML = STEPS.map((s, i) => `
      <div class="panel" id="panel-${i}">
        <div class="panel-header">
          <div class="panel-title">${s.title}</div>
          <div class="panel-desc">${s.desc}</div>
        </div>
        <div class="panel-body" id="body-${i}"></div>
        <div class="panel-footer">
          ${i > 0 ? `<button class="btn btn-ghost" onclick="PortfolioWizard.goStep(${i-1})">← Back</button>` : '<div></div>'}
          ${i < STEPS.length - 1 ? `<button class="btn btn-primary" onclick="PortfolioWizard.goStep(${i+1})">Next →</button>` : '<button class="btn btn-primary" onclick="PortfolioWizard.handleFinish()">Continue →</button>'}
        </div>
      </div>
    `).join('');
  }

  function goStep(n){
    if (n < 0 || n >= STEPS.length) return;
    currentStep = n;
    document.querySelectorAll('.panel').forEach((p, i) => p.classList.toggle('active', i === n));
    updateStepNav();
    renderCurrentPanel();
  }

  function renderCurrentPanel(){
    const body = document.getElementById('body-' + currentStep);
    if (!body) return;
    const renderer = RENDERERS[STEPS[currentStep].id];
    if (renderer) body.innerHTML = renderer(S.get());
  }

  // ===== Step renderers =====
  // Each renderer returns HTML; inputs invoke PortfolioWizard.bind(...) to write into state.

  const RENDERERS = {};

  RENDERERS.basics = (s) => {
    const id = s.identity;
    return `
      <div class="field-row">
        <div class="field-group"><div class="field-label">First name</div><input type="text" value="${esc(id.firstName)}" placeholder="Alexandra" oninput="PortfolioWizard.bind('identity.firstName', this.value)"></div>
        <div class="field-group"><div class="field-label">Last name</div><input type="text" value="${esc(id.lastName)}" placeholder="Chen" oninput="PortfolioWizard.bind('identity.lastName', this.value)"></div>
      </div>
      <div class="field-group">
        <div class="field-label">Headline / role</div>
        <input type="text" value="${esc(id.headline)}" placeholder="Senior Product Designer" oninput="PortfolioWizard.bind('identity.headline', this.value)">
        <div class="chip-row">
          ${['Software Engineer','Product Manager','Data Scientist','UX Designer','Marketing Manager','Founder']
            .map(r => `<button class="chip" onclick="PortfolioWizard.bind('identity.headline', '${r}'); PortfolioWizard.refresh()">${r}</button>`).join('')}
        </div>
      </div>
      <div class="field-row">
        <div class="field-group"><div class="field-label">Email</div><input type="email" value="${esc(id.email)}" placeholder="alex@example.com" oninput="PortfolioWizard.bind('identity.email', this.value)"></div>
        <div class="field-group"><div class="field-label">Location</div><input type="text" value="${esc(id.location)}" placeholder="San Francisco, CA" oninput="PortfolioWizard.bind('identity.location', this.value)"></div>
      </div>
      <div class="field-group">
        <div class="field-label">Profile photo</div>
        ${window.PortfolioUpload.widget({
          currentUrl: id.avatar,
          onSuccess: `PortfolioWizard.bind('identity.avatar', '%URL%')`
        })}
      </div>
      <div class="field-label" style="margin-top:6px">Social links</div>
      <div class="field-row">
        <div class="field-group"><input type="text" value="${esc(id.social.linkedin)}" placeholder="linkedin.com/in/you" oninput="PortfolioWizard.bind('identity.social.linkedin', this.value)"></div>
        <div class="field-group"><input type="text" value="${esc(id.social.github)}" placeholder="github.com/you" oninput="PortfolioWizard.bind('identity.social.github', this.value)"></div>
      </div>
      <div class="field-row">
        <div class="field-group"><input type="text" value="${esc(id.social.twitter)}" placeholder="twitter.com/you" oninput="PortfolioWizard.bind('identity.social.twitter', this.value)"></div>
        <div class="field-group"><input type="text" value="${esc(id.social.website)}" placeholder="yourdomain.com" oninput="PortfolioWizard.bind('identity.social.website', this.value)"></div>
      </div>
    `;
  };

  RENDERERS.about = (s) => `
    <div class="field-group">
      <div class="field-label">Tagline</div>
      <input type="text" value="${esc(s.about.tagline)}" placeholder="Designing tools that make work feel like craft." oninput="PortfolioWizard.bind('about.tagline', this.value)">
    </div>
    <div class="field-group">
      <div class="field-label">Bio</div>
      <textarea rows="6" placeholder="A short paragraph about who you are and what you care about..." oninput="PortfolioWizard.bind('about.bio', this.value)">${esc(s.about.bio)}</textarea>
      <button class="btn btn-ai" style="margin-top:8px" onclick="PortfolioWizard.aiImproveBio()"><span>✦</span> Improve with AI</button>
      <div id="ai-bio-out"></div>
    </div>
  `;

  RENDERERS.experience = (s) => {
    const list = s.experience || [];
    return list.map((e, i) => `
      <div class="entry-card">
        <div class="entry-card-head">
          <div>
            <div class="entry-card-title">${esc(e.role || 'New role')}</div>
            <div class="entry-card-sub">${esc(e.company || 'Company')}</div>
          </div>
          <button class="remove-btn" onclick="PortfolioWizard.removeExp(${i})">×</button>
        </div>
        <div class="field-row">
          <div class="field-group"><div class="field-label">Role</div><input type="text" value="${esc(e.role)}" placeholder="Senior Engineer" oninput="PortfolioWizard.updateExp(${i}, 'role', this.value)"></div>
          <div class="field-group"><div class="field-label">Company</div><input type="text" value="${esc(e.company)}" placeholder="Acme" oninput="PortfolioWizard.updateExp(${i}, 'company', this.value)"></div>
        </div>
        <div class="field-group"><div class="field-label">Dates</div><input type="text" value="${esc(e.dates)}" placeholder="Jan 2022 – Present" oninput="PortfolioWizard.updateExp(${i}, 'dates', this.value)"></div>
        <div class="field-group"><div class="field-label">Highlights (one per line)</div>
          <textarea rows="4" placeholder="Shipped X to N users...\nLed migration of...\nGrew Y from A to B" oninput="PortfolioWizard.updateExpHighlights(${i}, this.value)">${esc((e.highlights || []).join('\n'))}</textarea>
          <button class="btn btn-ai" style="margin-top:8px" onclick="PortfolioWizard.aiImproveHighlights(${i})"><span>✦</span> Sharpen highlights</button>
          <div id="ai-exp-${i}-out"></div>
        </div>
      </div>
    `).join('') + `<button class="add-btn" onclick="PortfolioWizard.addExp()">+ Add experience</button>`;
  };

  RENDERERS.projects = (s) => {
    const list = s.projects || [];
    return list.map((p, i) => `
      <div class="entry-card">
        <div class="entry-card-head">
          <div>
            <div class="entry-card-title">${esc(p.title || 'Project')}</div>
            <div class="entry-card-sub">${esc(p.role || '')}</div>
          </div>
          <button class="remove-btn" onclick="PortfolioWizard.removeProject(${i})">×</button>
        </div>
        <div class="field-row">
          <div class="field-group"><div class="field-label">Title</div><input type="text" value="${esc(p.title)}" placeholder="Project name" oninput="PortfolioWizard.updateProject(${i}, 'title', this.value)"></div>
          <div class="field-group"><div class="field-label">Your role</div><input type="text" value="${esc(p.role)}" placeholder="Designer & engineer" oninput="PortfolioWizard.updateProject(${i}, 'role', this.value)"></div>
        </div>
        <div class="field-group"><div class="field-label">Summary</div>
          <textarea rows="3" placeholder="One short paragraph: what it is, what you did, why it mattered." oninput="PortfolioWizard.updateProject(${i}, 'summary', this.value)">${esc(p.summary)}</textarea>
          <button class="btn btn-ai" style="margin-top:8px" onclick="PortfolioWizard.aiImproveProject(${i})"><span>✦</span> Polish summary</button>
          <div id="ai-proj-${i}-out"></div>
        </div>
        <div class="field-row">
          <div class="field-group"><div class="field-label">Live URL</div><input type="url" value="${esc(p.links?.live)}" placeholder="https://..." oninput="PortfolioWizard.updateProjectLink(${i}, 'live', this.value)"></div>
          <div class="field-group"><div class="field-label">Repo URL</div><input type="url" value="${esc(p.links?.repo)}" placeholder="https://github.com/..." oninput="PortfolioWizard.updateProjectLink(${i}, 'repo', this.value)"></div>
        </div>
        <div class="field-group"><div class="field-label">Project image</div>${window.PortfolioUpload.widget({
          currentUrl: p.image,
          onSuccess: `PortfolioWizard.updateProject(${i}, 'image', '%URL%')`
        })}</div>
        <div class="field-group"><div class="field-label">Tech (comma-separated)</div><input type="text" value="${esc((p.tech || []).join(', '))}" placeholder="React, TypeScript, Postgres" oninput="PortfolioWizard.updateProjectTech(${i}, this.value)"></div>
      </div>
    `).join('') + `<button class="add-btn" onclick="PortfolioWizard.addProject()">+ Add project</button>`;
  };

  RENDERERS.skills = (s) => {
    const groups = s.skills.groups || [];
    return groups.map((g, i) => `
      <div class="entry-card">
        <div class="entry-card-head">
          <div>
            <div class="entry-card-title">${esc(g.name || 'New group')}</div>
            <div class="entry-card-sub">${(g.items || []).length} item${(g.items || []).length === 1 ? '' : 's'}</div>
          </div>
          <button class="remove-btn" onclick="PortfolioWizard.removeSkillGroup(${i})">×</button>
        </div>
        <div class="field-group"><div class="field-label">Group name</div><input type="text" value="${esc(g.name)}" placeholder="Languages, Tools, Skills..." oninput="PortfolioWizard.updateSkillGroup(${i}, 'name', this.value)"></div>
        <div class="field-group"><div class="field-label">Items (comma-separated)</div><input type="text" value="${esc((g.items || []).join(', '))}" placeholder="JavaScript, TypeScript, Go" oninput="PortfolioWizard.updateSkillGroupItems(${i}, this.value)"></div>
      </div>
    `).join('') + `
      <button class="add-btn" onclick="PortfolioWizard.addSkillGroup()">+ Add skill group</button>
      <div class="field-group" style="margin-top:18px">
        <div class="field-label">Need ideas?</div>
        <button class="btn btn-ai" onclick="PortfolioWizard.aiSuggestSkills()"><span>✦</span> Suggest groups for my role</button>
        <div id="ai-skills-out" style="margin-top:8px"></div>
      </div>
    `;
  };

  RENDERERS.education = (s) => {
    const list = s.education || [];
    return list.map((e, i) => `
      <div class="entry-card">
        <div class="entry-card-head">
          <div>
            <div class="entry-card-title">${esc(e.degree || 'Degree')}</div>
            <div class="entry-card-sub">${esc(e.school || 'Institution')}</div>
          </div>
          <button class="remove-btn" onclick="PortfolioWizard.removeEdu(${i})">×</button>
        </div>
        <div class="field-row">
          <div class="field-group"><div class="field-label">Degree</div><input type="text" value="${esc(e.degree)}" placeholder="B.S. Computer Science" oninput="PortfolioWizard.updateEdu(${i}, 'degree', this.value)"></div>
          <div class="field-group"><div class="field-label">School</div><input type="text" value="${esc(e.school)}" placeholder="University name" oninput="PortfolioWizard.updateEdu(${i}, 'school', this.value)"></div>
        </div>
        <div class="field-row">
          <div class="field-group"><div class="field-label">Dates</div><input type="text" value="${esc(e.dates)}" placeholder="2016 – 2020" oninput="PortfolioWizard.updateEdu(${i}, 'dates', this.value)"></div>
          <div class="field-group"><div class="field-label">GPA (optional)</div><input type="text" value="${esc(e.gpa)}" placeholder="3.8/4.0" oninput="PortfolioWizard.updateEdu(${i}, 'gpa', this.value)"></div>
        </div>
      </div>
    `).join('') + `<button class="add-btn" onclick="PortfolioWizard.addEdu()">+ Add education</button>`;
  };

  RENDERERS.style = (s) => {
    const theme = s.theme || {};
    const tpls = window.PortfolioTemplates.list();
    const swatches = ['#c4a96b','#e8d5a3','#a3c4e8','#e88f8f','#86c188','#b48ae8','#1a1a1a','#888888'];
    const pairs = [
      { id: 'serif-modern', name: 'Serif Modern',  heading: "'Playfair Display', serif", body: "'DM Sans', sans-serif" },
      { id: 'sans-clean',   name: 'Sans Clean',    heading: "'Inter', sans-serif",       body: "'Inter', sans-serif" },
      { id: 'mono-tech',    name: 'Mono Tech',     heading: "'JetBrains Mono', monospace", body: "'Inter', sans-serif" },
      { id: 'editorial',    name: 'Editorial',     heading: "'Cormorant Garamond', serif", body: "'Lora', serif" }
    ];
    return `
      <div class="field-group">
        <div class="field-label">Template</div>
        <div class="template-grid">
          ${tpls.map(t => `
            <button class="tpl-card ${theme.templateId === t.id ? 'sel' : ''}" onclick="PortfolioWizard.bind('theme.templateId', '${t.id}'); PortfolioWizard.refresh()">
              <div class="tpl-thumb tpl-thumb-${t.id}"></div>
              <div class="tpl-name">${t.name}</div>
              <div class="tpl-desc">${esc(t.description)}</div>
            </button>
          `).join('')}
        </div>
      </div>

      <div class="field-group">
        <div class="field-label">Accent color</div>
        <div class="swatch-row">
          ${swatches.map(c => `<button class="swatch ${theme.accent && theme.accent.toLowerCase() === c.toLowerCase() ? 'sel' : ''}" style="background:${c}" data-c="${c}" onclick="PortfolioWizard.bind('theme.accent', '${c}'); PortfolioWizard.refresh()" title="${c}"></button>`).join('')}
        </div>
        <input type="text" value="${esc(theme.accent)}" placeholder="#c4a96b" style="margin-top:10px" oninput="PortfolioWizard.bind('theme.accent', this.value)">
      </div>

      <div class="field-group">
        <div class="field-label">Font pair</div>
        <div class="font-grid">
          ${pairs.map(p => `
            <button class="font-card ${theme.fontPair === p.id ? 'sel' : ''}" onclick="PortfolioWizard.bind('theme.fontPair', '${p.id}'); PortfolioWizard.refresh()">
              <div class="font-h" style="font-family:${p.heading}">Aa</div>
              <div class="font-meta">
                <div class="font-name">${p.name}</div>
                <div class="font-sample" style="font-family:${p.body}">The quick brown fox</div>
              </div>
            </button>
          `).join('')}
        </div>
      </div>

      <div class="field-group">
        <div class="field-label">Mode</div>
        <div class="chip-row">
          <button class="chip ${theme.mode === 'light' ? 'sel' : ''}" onclick="PortfolioWizard.bind('theme.mode', 'light'); PortfolioWizard.refresh()">☀ Light</button>
          <button class="chip ${theme.mode === 'dark' ? 'sel' : ''}" onclick="PortfolioWizard.bind('theme.mode', 'dark'); PortfolioWizard.refresh()">☾ Dark</button>
        </div>
      </div>
    `;
  };

  RENDERERS.review = (s) => {
    const id = s.identity;
    const counts = {
      experience: (s.experience || []).filter(e => e.role || e.company).length,
      projects: (s.projects || []).filter(p => p.title).length,
      skills: (s.skills.groups || []).filter(g => g.items?.length).length,
      education: (s.education || []).filter(e => e.school || e.degree).length
    };
    const tpl = window.PortfolioTemplates.get(s.theme.templateId);
    // Defer publish UI render to after innerHTML is set.
    setTimeout(() => {
      const publishMount = document.getElementById('publish-mount');
      if (publishMount) window.PortfolioPublish.render(publishMount);
    }, 0);
    return `
      <div class="review-grid">
        <div class="review-card"><div class="label">Name</div><div class="value">${esc([id.firstName, id.lastName].filter(Boolean).join(' ') || '—')}</div></div>
        <div class="review-card"><div class="label">Headline</div><div class="value">${esc(id.headline || '—')}</div></div>
        <div class="review-card"><div class="label">Experience</div><div class="value">${counts.experience} entries</div></div>
        <div class="review-card"><div class="label">Projects</div><div class="value">${counts.projects} entries</div></div>
        <div class="review-card"><div class="label">Skill groups</div><div class="value">${counts.skills}</div></div>
        <div class="review-card"><div class="label">Education</div><div class="value">${counts.education} entries</div></div>
        <div class="review-card"><div class="label">Template</div><div class="value">${esc(tpl ? tpl.name : '—')}</div></div>
        <div class="review-card"><div class="label">Mode</div><div class="value">${esc(s.theme.mode)}</div></div>
      </div>

      <div id="publish-mount" style="margin-top:24px"></div>

      <div class="export-card" style="margin-top:14px">
        <div class="publish-card-title">Or take it offline</div>
        <div class="publish-card-desc">Download a self-contained folder of HTML + CSS you can host anywhere.</div>
        <button class="btn btn-ghost" style="margin-top:10px" onclick="PortfolioWizard.downloadZip(this)">⬇ Download as ZIP</button>
        <span id="export-status" style="margin-left:10px;color:var(--muted);font-size:12px"></span>
      </div>
    `;
  };

  // ===== Mutators called by inline handlers =====
  function bind(path, value){
    const parts = path.split('.');
    const patch = {};
    let cursor = patch;
    for (let i = 0; i < parts.length - 1; i++){ cursor[parts[i]] = {}; cursor = cursor[parts[i]]; }
    cursor[parts[parts.length - 1]] = value;
    S.set(patch);
  }
  function refresh(){ renderCurrentPanel(); }

  function addExp(){ S.listAdd('experience', F.experience()); refresh(); }
  function removeExp(i){ S.listRemove('experience', i); refresh(); }
  function updateExp(i, field, value){ S.listUpdate('experience', i, { [field]: value }); }
  function updateExpHighlights(i, raw){
    S.listUpdate('experience', i, { highlights: raw.split('\n').map(l => l.trim()).filter(Boolean) });
  }

  function addProject(){ S.listAdd('projects', F.project()); refresh(); }
  function removeProject(i){ S.listRemove('projects', i); refresh(); }
  function updateProject(i, field, value){ S.listUpdate('projects', i, { [field]: value }); }
  function updateProjectLink(i, which, value){
    S.listUpdate('projects', i, { links: { [which]: value } });
  }
  function updateProjectTech(i, raw){
    S.listUpdate('projects', i, { tech: raw.split(',').map(t => t.trim()).filter(Boolean) });
  }

  function addSkillGroup(){ S.listAdd('skills.groups', F.skillGroup()); refresh(); }
  function removeSkillGroup(i){ S.listRemove('skills.groups', i); refresh(); }
  function updateSkillGroup(i, field, value){ S.listUpdate('skills.groups', i, { [field]: value }); }
  function updateSkillGroupItems(i, raw){
    S.listUpdate('skills.groups', i, { items: raw.split(',').map(t => t.trim()).filter(Boolean) });
  }

  function addEdu(){ S.listAdd('education', F.education()); refresh(); }
  function removeEdu(i){ S.listRemove('education', i); refresh(); }
  function updateEdu(i, field, value){ S.listUpdate('education', i, { [field]: value }); }

  function confirmReset(){
    if (confirm('Reset your portfolio draft? This clears all fields.')){
      S.reset();
      goStep(0);
    }
  }

  function handleFinish(){
    // On the Review step the "Continue" button does nothing useful; just stay here.
    // (Kept for footer-button consistency.)
  }

  async function downloadZip(btn){
    const status = document.getElementById('export-status');
    btn.disabled = true;
    if (status) status.textContent = 'Bundling…';
    try {
      await window.PortfolioExport.downloadZip();
      if (status) status.textContent = 'Downloaded ✓';
    } catch (e){
      if (status) status.textContent = 'Failed: ' + (e.message || String(e));
    } finally {
      btn.disabled = false;
    }
  }

  // ===== AI assists =====
  async function aiImproveBio(){
    const out = document.getElementById('ai-bio-out');
    const s = S.get();
    const bio = s.about.bio || '';
    const headline = s.identity.headline || 'professional';
    if (!bio){ out.innerHTML = '<p style="color:var(--muted);font-size:12px;margin-top:8px">Write a draft bio first, then I\'ll polish it.</p>'; return; }
    out.innerHTML = aiLoading('Polishing bio...');
    try {
      const text = await callClaude(400, `Rewrite this short bio for a personal portfolio site. Keep it 3-4 sentences, warm but professional, first person, no clichés. Subject is a ${headline}.\n\nDraft:\n${bio}\n\nReturn ONLY the rewritten bio, no preamble.`);
      out.innerHTML = aiPanel(text.trim(), `PortfolioWizard.applyAi('about.bio', '${encodeURIComponent(text.trim())}')`);
    } catch(e){ out.innerHTML = aiError(e); }
  }

  async function aiImproveHighlights(i){
    const out = document.getElementById('ai-exp-' + i + '-out');
    const s = S.get();
    const e = s.experience[i];
    if (!e){ return; }
    const draft = (e.highlights || []).join('\n') || e.role;
    out.innerHTML = aiLoading('Sharpening highlights...');
    try {
      const text = await callClaude(400, `Rewrite these into 3 strong portfolio highlights for a ${e.role || 'professional'} at ${e.company || 'a company'}. Use action verbs, quantify where possible, one line each, no bullet characters.\n\nDraft:\n${draft}\n\nReturn ONLY the 3 lines.`);
      const lines = text.split('\n').map(l => l.replace(/^[-•*\d.\s]+/, '').trim()).filter(Boolean).slice(0, 3);
      out.innerHTML = aiPanel(lines.join('\n'), `PortfolioWizard.applyExpHighlights(${i}, '${encodeURIComponent(lines.join('\\n'))}')`);
    } catch(e){ out.innerHTML = aiError(e); }
  }

  async function aiImproveProject(i){
    const out = document.getElementById('ai-proj-' + i + '-out');
    const s = S.get();
    const p = s.projects[i];
    if (!p) return;
    const draft = p.summary || p.title || '';
    out.innerHTML = aiLoading('Polishing summary...');
    try {
      const text = await callClaude(300, `Rewrite this project summary for a portfolio site. 2-3 sentences max. Lead with what the project is, then what you did, then why it mattered or who it was for.\n\nProject: ${p.title}\nYour role: ${p.role}\n\nDraft:\n${draft}\n\nReturn ONLY the rewritten summary.`);
      out.innerHTML = aiPanel(text.trim(), `PortfolioWizard.applyProjectSummary(${i}, '${encodeURIComponent(text.trim())}')`);
    } catch(e){ out.innerHTML = aiError(e); }
  }

  async function aiSuggestSkills(){
    const out = document.getElementById('ai-skills-out');
    const s = S.get();
    const role = s.identity.headline || 'professional';
    out.innerHTML = aiLoading('Thinking...');
    try {
      const text = await callClaude(400, `For a portfolio site of a ${role}, suggest 3 skill groups with 4-6 items each. Return ONLY JSON: [{"name":"...","items":["...","..."]}]`);
      const match = text.match(/\[[\s\S]*\]/);
      if (!match) { out.innerHTML = '<p style="color:var(--muted);font-size:12px">Could not parse suggestions.</p>'; return; }
      const groups = JSON.parse(match[0]);
      out.innerHTML = `<div class="ai-panel"><div class="ai-panel-head"><div class="ai-spark">✦</div>Suggested</div>` +
        groups.map((g, j) => `
          <div style="margin-bottom:10px">
            <div style="font-size:12px;color:var(--text);margin-bottom:4px">${esc(g.name)}</div>
            <div style="font-size:12px;color:var(--muted)">${(g.items || []).map(esc).join(' · ')}</div>
            <button class="btn btn-primary" style="margin-top:6px;font-size:11px;padding:6px 12px" onclick="PortfolioWizard.applySuggestedGroup('${encodeURIComponent(JSON.stringify(g))}')">Add this group</button>
          </div>
        `).join('') + `</div>`;
    } catch(e){ out.innerHTML = aiError(e); }
  }

  function applyAi(path, encoded){ bind(path, decodeURIComponent(encoded)); refresh(); }
  function applyExpHighlights(i, encoded){
    const lines = decodeURIComponent(encoded).split('\n').filter(Boolean);
    S.listUpdate('experience', i, { highlights: lines });
  }
  function applyProjectSummary(i, encoded){
    S.listUpdate('projects', i, { summary: decodeURIComponent(encoded) });
  }
  function applySuggestedGroup(encoded){
    const g = JSON.parse(decodeURIComponent(encoded));
    S.listAdd('skills.groups', { ...F.skillGroup(), name: g.name, items: g.items });
  }

  // ===== UI helpers =====
  function esc(s){ return String(s ?? '').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c])); }
  function aiLoading(label){
    return `<div class="ai-loading" style="margin-top:8px"><div class="dot"></div><div class="dot"></div><div class="dot"></div><span style="margin-left:4px">${label}</span></div>`;
  }
  function aiPanel(text, applyExpr){
    return `<div class="ai-panel"><div class="ai-panel-head"><div class="ai-spark">✦</div>Suggestion</div>
      <div class="ai-output">${esc(text)}</div>
      <button class="btn btn-primary" style="margin-top:10px;font-size:11px;padding:6px 12px" onclick="${applyExpr}">Apply</button>
    </div>`;
  }
  function aiError(e){
    return `<p style="color:var(--red);font-size:12px;margin-top:8px">AI request failed: ${esc(e.message || String(e))}</p>`;
  }

  window.PortfolioWizard = {
    init, goStep, bind, refresh, confirmReset, handleFinish, downloadZip,
    addExp, removeExp, updateExp, updateExpHighlights,
    addProject, removeProject, updateProject, updateProjectLink, updateProjectTech,
    addSkillGroup, removeSkillGroup, updateSkillGroup, updateSkillGroupItems,
    addEdu, removeEdu, updateEdu,
    aiImproveBio, aiImproveHighlights, aiImproveProject, aiSuggestSkills,
    applyAi, applyExpHighlights, applyProjectSummary, applySuggestedGroup
  };
})();
