// Executive template — two-column CV layout. Sidebar holds identity, contact,
// skills, education; main column leads with experience as a dated timeline.
// Aimed at senior ICs and exec/leadership profiles — conservative, hireable.

(function(){
  const H = window.PortfolioTemplateHelpers;

  function render(state){
    const id = state.identity || {};
    const about = state.about || {};
    const theme = state.theme || {};
    const fonts = H.fontStack(theme.fontPair);
    const colors = H.modeColors(theme.mode);
    const accent = theme.accent || '#c4a96b';
    const name = H.fullName(id) || 'Your Name';
    const links = H.socialLinks(id);

    const sidebarBg = theme.mode === 'dark' ? '#16140f' : '#f5f1e8';
    const sidebarBorder = theme.mode === 'dark' ? '#2a2620' : '#e8dfc8';

    const css = `
      ${H.fontImport(theme.fontPair)}
      *{box-sizing:border-box;margin:0;padding:0}
      html,body{background:${colors.bg};color:${colors.text};font-family:${fonts.body};font-size:15px;line-height:1.6;-webkit-font-smoothing:antialiased}
      a{color:${accent};text-decoration:none}
      a:hover{text-decoration:underline}
      h1,h2,h3,h4{font-family:${fonts.heading};font-weight:600;letter-spacing:-0.01em;color:${colors.text}}
      .page{max-width:1100px;margin:0 auto;display:grid;grid-template-columns:320px 1fr;gap:0;min-height:100vh}
      aside{background:${sidebarBg};border-right:1px solid ${sidebarBorder};padding:56px 36px;position:sticky;top:0;align-self:start;height:100vh;overflow-y:auto}
      main{padding:56px 56px 80px}
      .avatar{width:120px;height:120px;border-radius:50%;background:${colors.surface};margin-bottom:20px;object-fit:cover;display:block;border:3px solid ${colors.bg}}
      .a-name{font-size:28px;line-height:1.15;margin-bottom:6px}
      .a-headline{font-size:14px;color:${colors.muted};margin-bottom:24px;line-height:1.45}
      .a-rule{height:2px;background:${accent};width:40px;margin-bottom:22px}
      .a-section{margin-bottom:28px}
      .a-label{font-size:10px;letter-spacing:0.18em;text-transform:uppercase;color:${accent};font-weight:600;margin-bottom:10px;font-family:${fonts.body}}
      .a-list{font-size:13px;line-height:1.7;color:${colors.text}}
      .a-list a{color:${colors.text};border-bottom:1px dotted ${colors.border};padding-bottom:1px}
      .a-list a:hover{color:${accent};border-bottom-color:${accent};text-decoration:none}
      .a-list div{margin-bottom:4px}
      .a-skill-group{margin-bottom:14px}
      .a-skill-group .name{font-size:12px;color:${colors.text};font-weight:600;margin-bottom:4px}
      .a-skill-group .items{font-size:12px;color:${colors.muted};line-height:1.55}
      .a-edu{margin-bottom:12px}
      .a-edu .deg{font-size:13px;color:${colors.text};font-weight:600;margin-bottom:2px}
      .a-edu .school{font-size:12px;color:${colors.muted}}
      .a-edu .dates{font-size:11px;color:${colors.muted};margin-top:2px}
      main section{margin-bottom:48px}
      main section > h2{font-size:11px;letter-spacing:0.2em;text-transform:uppercase;color:${accent};margin-bottom:18px;font-family:${fonts.body};font-weight:600;padding-bottom:10px;border-bottom:1px solid ${colors.border}}
      .lead .tagline{font-size:22px;line-height:1.4;color:${colors.text};font-family:${fonts.heading};font-weight:500;margin-bottom:14px;letter-spacing:-0.01em}
      .lead p{font-size:15px;line-height:1.7;color:${colors.text};max-width:640px}
      .lead p + p{margin-top:10px}
      .timeline{position:relative;padding-left:20px;border-left:1px solid ${colors.border}}
      .t-entry{position:relative;padding-bottom:32px}
      .t-entry:last-child{padding-bottom:0}
      .t-entry::before{content:'';position:absolute;left:-25px;top:6px;width:9px;height:9px;border-radius:50%;background:${accent};box-shadow:0 0 0 4px ${colors.bg}}
      .t-dates{font-size:11px;letter-spacing:0.1em;text-transform:uppercase;color:${colors.muted};margin-bottom:4px;font-weight:500}
      .t-role{font-size:17px;color:${colors.text};margin-bottom:2px}
      .t-company{font-size:14px;color:${accent};font-weight:500;margin-bottom:10px}
      .t-highlights{margin-left:18px}
      .t-highlights li{font-size:14px;color:${colors.text};margin-bottom:5px;line-height:1.55}
      .t-highlights li::marker{color:${accent}}
      .projects{display:grid;grid-template-columns:1fr;gap:20px}
      .proj{padding:20px;border:1px solid ${colors.border};border-radius:8px;background:${colors.surface}}
      .proj-head{display:flex;justify-content:space-between;align-items:baseline;gap:16px;margin-bottom:6px;flex-wrap:wrap}
      .proj h3{font-size:16px}
      .proj .role{font-size:12px;color:${colors.muted};font-style:italic}
      .proj p{font-size:14px;color:${colors.text};margin-bottom:10px;line-height:1.6}
      .proj img{width:100%;border-radius:4px;margin-bottom:12px;display:block;background:${colors.bg};max-height:200px;object-fit:cover}
      .proj-links{display:flex;gap:14px;font-size:12px;margin-bottom:8px}
      .proj-tech{display:flex;flex-wrap:wrap;gap:6px}
      .proj-tech span{font-size:10px;letter-spacing:0.06em;text-transform:uppercase;color:${colors.muted};border:1px solid ${colors.border};padding:3px 8px;border-radius:3px;font-weight:500}
      footer{margin-top:48px;padding-top:24px;border-top:1px solid ${colors.border};font-size:12px;color:${colors.muted};display:flex;justify-content:space-between;flex-wrap:wrap;gap:8px}
      @media(max-width:880px){
        .page{grid-template-columns:1fr}
        aside{position:static;height:auto;border-right:none;border-bottom:1px solid ${sidebarBorder};padding:40px 28px 32px}
        main{padding:36px 28px 60px}
        .avatar{width:96px;height:96px}
      }
    `;

    let html = '<div class="page">';

    // ===== Sidebar =====
    html += '<aside>';
    if (id.avatar) html += `<img class="avatar" src="${H.escapeHTML(id.avatar)}" alt="">`;
    html += `<h1 class="a-name">${H.escapeHTML(name)}</h1>`;
    if (id.headline) html += `<div class="a-headline">${H.escapeHTML(id.headline)}</div>`;
    html += '<div class="a-rule"></div>';

    const contactBits = [];
    if (id.location) contactBits.push(`<div>${H.escapeHTML(id.location)}</div>`);
    if (id.email) contactBits.push(`<div><a href="mailto:${H.escapeHTML(id.email)}">${H.escapeHTML(id.email)}</a></div>`);
    if (contactBits.length){
      html += '<div class="a-section"><div class="a-label">Contact</div><div class="a-list">' + contactBits.join('') + '</div></div>';
    }

    if (links.length){
      html += '<div class="a-section"><div class="a-label">Connect</div><div class="a-list">';
      links.forEach(l => {
        html += `<div><a href="${H.escapeHTML(l.href)}" target="_blank" rel="noopener">${H.escapeHTML(l.label)}</a></div>`;
      });
      html += '</div></div>';
    }

    const groups = (state.skills?.groups || []).filter(g => g.items?.length);
    if (groups.length){
      html += '<div class="a-section"><div class="a-label">Capabilities</div>';
      groups.forEach(g => {
        html += '<div class="a-skill-group">';
        if (g.name) html += `<div class="name">${H.escapeHTML(g.name)}</div>`;
        html += `<div class="items">${g.items.map(H.escapeHTML).join(' · ')}</div>`;
        html += '</div>';
      });
      html += '</div>';
    }

    const education = (state.education || []).filter(e => e.school || e.degree);
    if (education.length){
      html += '<div class="a-section"><div class="a-label">Education</div>';
      education.forEach(e => {
        html += '<div class="a-edu">';
        html += `<div class="deg">${H.escapeHTML(e.degree || 'Degree')}</div>`;
        if (e.school) html += `<div class="school">${H.escapeHTML(e.school)}</div>`;
        if (e.dates || e.gpa){
          const bits = [e.dates, e.gpa].filter(Boolean).map(H.escapeHTML).join(' · ');
          html += `<div class="dates">${bits}</div>`;
        }
        html += '</div>';
      });
      html += '</div>';
    }

    html += '</aside>';

    // ===== Main =====
    html += '<main>';

    if (about.tagline || about.bio){
      html += '<section class="lead"><h2>Profile</h2>';
      if (about.tagline) html += `<div class="tagline">${H.escapeHTML(about.tagline)}</div>`;
      if (about.bio) html += `<p>${H.escapeHTML(about.bio).replace(/\n+/g, '</p><p>')}</p>`;
      html += '</section>';
    }

    const experiences = (state.experience || []).filter(e => e.role || e.company);
    if (experiences.length){
      html += '<section><h2>Experience</h2><div class="timeline">';
      experiences.forEach(e => {
        html += '<div class="t-entry">';
        if (e.dates) html += `<div class="t-dates">${H.escapeHTML(e.dates)}</div>`;
        html += `<h3 class="t-role">${H.escapeHTML(e.role || 'Role')}</h3>`;
        if (e.company) html += `<div class="t-company">${H.escapeHTML(e.company)}</div>`;
        if (Array.isArray(e.highlights) && e.highlights.length){
          html += '<ul class="t-highlights">' + e.highlights.filter(Boolean).map(h => `<li>${H.escapeHTML(h)}</li>`).join('') + '</ul>';
        }
        html += '</div>';
      });
      html += '</div></section>';
    }

    const projects = (state.projects || []).filter(p => p.title);
    if (projects.length){
      html += '<section><h2>Selected Projects</h2><div class="projects">';
      projects.forEach(p => {
        html += '<div class="proj">';
        if (p.image) html += `<img src="${H.escapeHTML(p.image)}" alt="${H.escapeHTML(p.title)}">`;
        html += '<div class="proj-head">';
        html += `<h3>${H.escapeHTML(p.title)}</h3>`;
        if (p.role) html += `<div class="role">${H.escapeHTML(p.role)}</div>`;
        html += '</div>';
        if (p.summary) html += `<p>${H.escapeHTML(p.summary)}</p>`;
        const linkBits = [];
        if (p.links?.live) linkBits.push(`<a href="${H.escapeHTML(H.ensureUrl(p.links.live))}" target="_blank" rel="noopener">Live →</a>`);
        if (p.links?.repo) linkBits.push(`<a href="${H.escapeHTML(H.ensureUrl(p.links.repo))}" target="_blank" rel="noopener">Code →</a>`);
        if (linkBits.length) html += `<div class="proj-links">${linkBits.join('')}</div>`;
        if (Array.isArray(p.tech) && p.tech.length){
          html += `<div class="proj-tech">${p.tech.map(t => `<span>${H.escapeHTML(t)}</span>`).join('')}</div>`;
        }
        html += '</div>';
      });
      html += '</div></section>';
    }

    html += '<footer>';
    html += `<span>© ${new Date().getFullYear()} ${H.escapeHTML(name)}</span>`;
    if (id.email) html += `<a href="mailto:${H.escapeHTML(id.email)}">${H.escapeHTML(id.email)}</a>`;
    html += '</footer>';

    html += '</main></div>';

    return { html, css };
  }

  window.PortfolioTemplates.register({
    id: 'executive',
    name: 'Executive',
    description: 'Two-column CV. Sidebar identity, experience-led timeline. Senior, hireable.',
    render
  });
})();
