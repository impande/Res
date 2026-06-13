// Minimal template — single column, lots of whitespace, serif headings.

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

    const css = `
      ${H.fontImport(theme.fontPair)}
      *{box-sizing:border-box;margin:0;padding:0}
      html,body{background:${colors.bg};color:${colors.text};font-family:${fonts.body};font-size:16px;line-height:1.65;-webkit-font-smoothing:antialiased}
      a{color:${accent};text-decoration:none;border-bottom:1px solid transparent;transition:border-color .15s}
      a:hover{border-bottom-color:${accent}}
      h1,h2,h3{font-family:${fonts.heading};font-weight:600;letter-spacing:-0.01em;color:${colors.text}}
      .container{max-width:680px;margin:0 auto;padding:96px 28px 120px}
      header{margin-bottom:64px}
      header h1{font-size:48px;line-height:1.05;margin-bottom:12px}
      header .headline{font-size:18px;color:${colors.muted};margin-bottom:18px}
      header .meta{display:flex;flex-wrap:wrap;gap:18px;font-size:14px;color:${colors.muted}}
      .avatar{width:88px;height:88px;border-radius:50%;background:${colors.surface};margin-bottom:24px;object-fit:cover;display:block}
      section{margin-bottom:56px}
      section > h2{font-size:13px;letter-spacing:0.14em;text-transform:uppercase;color:${accent};margin-bottom:18px;font-family:${fonts.body};font-weight:500}
      .about p{font-size:17px;line-height:1.65}
      .tagline{font-style:italic;color:${colors.muted};margin-bottom:14px;font-size:16px}
      .entry{margin-bottom:28px;padding-bottom:28px;border-bottom:1px solid ${colors.border}}
      .entry:last-child{border-bottom:none;padding-bottom:0}
      .entry-head{display:flex;justify-content:space-between;align-items:baseline;gap:16px;margin-bottom:6px;flex-wrap:wrap}
      .entry-head h3{font-size:18px}
      .entry-head .sub{font-size:14px;color:${colors.muted}}
      .entry-head .dates{font-size:13px;color:${colors.muted};white-space:nowrap}
      .entry-body{font-size:15px;color:${colors.text}}
      .entry-body ul{margin-left:18px;margin-top:8px}
      .entry-body li{margin-bottom:4px}
      .project-grid{display:grid;grid-template-columns:1fr;gap:32px}
      .project img{width:100%;border-radius:6px;margin-bottom:12px;display:block;background:${colors.surface}}
      .project h3{font-size:18px;margin-bottom:6px}
      .project .role{font-size:13px;color:${colors.muted};margin-bottom:8px}
      .project .summary{font-size:15px;color:${colors.text};margin-bottom:8px}
      .project .tech{display:flex;flex-wrap:wrap;gap:6px;margin-top:8px}
      .project .tech span{font-size:11px;color:${colors.muted};border:1px solid ${colors.border};padding:2px 8px;border-radius:10px}
      .project-links{display:flex;gap:14px;font-size:13px;margin-top:6px}
      .skill-groups{display:grid;grid-template-columns:1fr;gap:18px}
      .skill-group .name{font-size:13px;color:${colors.muted};margin-bottom:6px}
      .skill-group .items{font-size:15px;color:${colors.text}}
      footer{margin-top:80px;padding-top:32px;border-top:1px solid ${colors.border};font-size:13px;color:${colors.muted};display:flex;justify-content:space-between;flex-wrap:wrap;gap:12px}
      footer a{color:${colors.muted}}
      footer a:hover{color:${accent}}
      @media(max-width:520px){
        .container{padding:64px 20px 80px}
        header h1{font-size:36px}
      }
    `;

    let html = '<div class="container">';

    // Header
    html += '<header>';
    if (id.avatar) html += `<img class="avatar" src="${H.escapeHTML(id.avatar)}" alt="">`;
    html += `<h1>${H.escapeHTML(name)}</h1>`;
    if (id.headline) html += `<div class="headline">${H.escapeHTML(id.headline)}</div>`;
    const metaBits = [];
    if (id.location) metaBits.push(H.escapeHTML(id.location));
    if (id.email) metaBits.push(`<a href="mailto:${H.escapeHTML(id.email)}">${H.escapeHTML(id.email)}</a>`);
    links.forEach(l => metaBits.push(`<a href="${H.escapeHTML(l.href)}" target="_blank" rel="noopener">${H.escapeHTML(l.label)}</a>`));
    if (metaBits.length) html += `<div class="meta">${metaBits.join('')}</div>`;
    html += '</header>';

    // About
    if (about.tagline || about.bio){
      html += '<section class="about"><h2>About</h2>';
      if (about.tagline) html += `<p class="tagline">${H.escapeHTML(about.tagline)}</p>`;
      if (about.bio) html += `<p>${H.escapeHTML(about.bio).replace(/\n+/g, '</p><p>')}</p>`;
      html += '</section>';
    }

    // Experience
    if (Array.isArray(state.experience) && state.experience.length){
      html += '<section><h2>Experience</h2>';
      state.experience.forEach(e => {
        if (!e.role && !e.company) return;
        html += '<div class="entry"><div class="entry-head">';
        html += `<div><h3>${H.escapeHTML(e.role || 'Role')}</h3><div class="sub">${H.escapeHTML(e.company || '')}</div></div>`;
        if (e.dates) html += `<div class="dates">${H.escapeHTML(e.dates)}</div>`;
        html += '</div>';
        if (Array.isArray(e.highlights) && e.highlights.length){
          html += '<div class="entry-body"><ul>' + e.highlights.filter(Boolean).map(h => `<li>${H.escapeHTML(h)}</li>`).join('') + '</ul></div>';
        }
        html += '</div>';
      });
      html += '</section>';
    }

    // Projects
    if (Array.isArray(state.projects) && state.projects.length){
      html += '<section><h2>Selected Work</h2><div class="project-grid">';
      state.projects.forEach(p => {
        if (!p.title) return;
        html += '<div class="project">';
        if (p.image) html += `<img src="${H.escapeHTML(p.image)}" alt="${H.escapeHTML(p.title)}">`;
        html += `<h3>${H.escapeHTML(p.title)}</h3>`;
        if (p.role) html += `<div class="role">${H.escapeHTML(p.role)}</div>`;
        if (p.summary) html += `<div class="summary">${H.escapeHTML(p.summary)}</div>`;
        const linkBits = [];
        if (p.links?.live) linkBits.push(`<a href="${H.escapeHTML(H.ensureUrl(p.links.live))}" target="_blank" rel="noopener">Live →</a>`);
        if (p.links?.repo) linkBits.push(`<a href="${H.escapeHTML(H.ensureUrl(p.links.repo))}" target="_blank" rel="noopener">Code →</a>`);
        if (linkBits.length) html += `<div class="project-links">${linkBits.join('')}</div>`;
        if (Array.isArray(p.tech) && p.tech.length){
          html += `<div class="tech">${p.tech.map(t => `<span>${H.escapeHTML(t)}</span>`).join('')}</div>`;
        }
        html += '</div>';
      });
      html += '</div></section>';
    }

    // Skills
    const groups = (state.skills?.groups || []).filter(g => g.items?.length);
    if (groups.length){
      html += '<section><h2>Skills</h2><div class="skill-groups">';
      groups.forEach(g => {
        html += '<div class="skill-group">';
        if (g.name) html += `<div class="name">${H.escapeHTML(g.name)}</div>`;
        html += `<div class="items">${g.items.map(H.escapeHTML).join(' · ')}</div>`;
        html += '</div>';
      });
      html += '</div></section>';
    }

    // Education
    if (Array.isArray(state.education) && state.education.length){
      html += '<section><h2>Education</h2>';
      state.education.forEach(e => {
        if (!e.school && !e.degree) return;
        html += '<div class="entry"><div class="entry-head">';
        html += `<div><h3>${H.escapeHTML(e.degree || 'Degree')}</h3><div class="sub">${H.escapeHTML(e.school || '')}</div></div>`;
        if (e.dates) html += `<div class="dates">${H.escapeHTML(e.dates)}</div>`;
        html += '</div></div>';
      });
      html += '</section>';
    }

    // Footer
    html += '<footer>';
    html += `<span>© ${new Date().getFullYear()} ${H.escapeHTML(name)}</span>`;
    if (id.email) html += `<a href="mailto:${H.escapeHTML(id.email)}">${H.escapeHTML(id.email)}</a>`;
    html += '</footer>';

    html += '</div>';

    return { html, css };
  }

  window.PortfolioTemplates.register({
    id: 'minimal',
    name: 'Minimal',
    description: 'Single column, generous whitespace, serif headings.',
    render
  });
})();
