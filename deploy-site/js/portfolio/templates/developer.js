// Developer template — monospace accents, terminal aesthetic, projects-first.

(function(){
  const H = window.PortfolioTemplateHelpers;

  function render(state){
    const id = state.identity || {};
    const about = state.about || {};
    const theme = state.theme || {};
    // Developer template prefers mono pairing; respect user choice if not the default
    const fonts = H.fontStack(theme.fontPair === 'serif-modern' ? 'mono-tech' : theme.fontPair);
    const colors = H.modeColors(theme.mode);
    const accent = theme.accent || '#c4a96b';
    const name = H.fullName(id) || 'Your Name';
    const links = H.socialLinks(id);
    const username = (id.social?.github?.split('/').pop() || name.toLowerCase().replace(/\s+/g, '')) || 'you';

    const css = `
      ${H.fontImport(theme.fontPair === 'serif-modern' ? 'mono-tech' : theme.fontPair)}
      *{box-sizing:border-box;margin:0;padding:0}
      html,body{background:${colors.bg};color:${colors.text};font-family:${fonts.body};font-size:15px;line-height:1.65;-webkit-font-smoothing:antialiased}
      a{color:${accent};text-decoration:none}
      a:hover{text-decoration:underline}
      .wrap{max-width:820px;margin:0 auto;padding:64px 28px 96px}
      .prompt{font-family:${fonts.heading};font-size:14px;color:${colors.muted};margin-bottom:24px}
      .prompt .dollar{color:${accent}}
      .hero{margin-bottom:64px}
      .hero h1{font-family:${fonts.heading};font-size:42px;line-height:1.1;margin-bottom:10px}
      .hero h1 .at{color:${accent}}
      .hero .headline{font-size:18px;color:${colors.muted};margin-bottom:20px}
      .hero .meta{display:flex;flex-wrap:wrap;gap:14px;font-size:13px;font-family:${fonts.heading}}
      .hero .meta a,.hero .meta span{color:${colors.muted};border:1px solid ${colors.border};padding:4px 10px;border-radius:4px}
      .hero .meta a:hover{border-color:${accent};color:${accent};text-decoration:none}
      section{margin-bottom:56px}
      .section-head{display:flex;align-items:center;gap:10px;margin-bottom:20px;font-family:${fonts.heading}}
      .section-head .label{font-size:12px;color:${accent};text-transform:uppercase;letter-spacing:0.12em}
      .section-head .rule{flex:1;height:1px;background:${colors.border}}
      .about p{font-size:16px;line-height:1.7}
      .tagline{color:${accent};font-style:italic;margin-bottom:14px}
      .repo{background:${colors.surface};border:1px solid ${colors.border};border-radius:8px;padding:20px;margin-bottom:14px;font-family:${fonts.body}}
      .repo .head{display:flex;justify-content:space-between;align-items:flex-start;gap:14px;margin-bottom:8px;flex-wrap:wrap}
      .repo .head h3{font-family:${fonts.heading};font-size:18px;font-weight:700;color:${colors.text}}
      .repo .head h3 .slash{color:${accent}}
      .repo .role{font-family:${fonts.heading};font-size:12px;color:${colors.muted}}
      .repo p{font-size:14px;color:${colors.text};margin-bottom:12px}
      .repo .links{display:flex;gap:14px;font-family:${fonts.heading};font-size:12px}
      .repo .tech{display:flex;flex-wrap:wrap;gap:6px;margin-top:12px}
      .repo .tech span{font-family:${fonts.heading};font-size:11px;background:${colors.bg};border:1px solid ${colors.border};padding:3px 9px;border-radius:4px;color:${colors.muted}}
      .exp{margin-bottom:24px;padding-left:16px;border-left:2px solid ${colors.border}}
      .exp h3{font-family:${fonts.heading};font-size:16px;font-weight:700;margin-bottom:2px}
      .exp .sub{font-size:13px;color:${colors.muted};margin-bottom:8px;font-family:${fonts.heading}}
      .exp ul{margin-left:16px}
      .exp li{font-size:14px;margin-bottom:4px}
      .skills{display:flex;flex-direction:column;gap:14px}
      .skill-group .name{font-family:${fonts.heading};font-size:12px;color:${accent};margin-bottom:6px}
      .skill-group .items{font-family:${fonts.heading};font-size:14px;color:${colors.text}}
      .skill-group .items span{display:inline-block;margin-right:6px;margin-bottom:6px;padding:3px 9px;background:${colors.surface};border:1px solid ${colors.border};border-radius:4px;font-size:12px}
      footer{margin-top:80px;font-family:${fonts.heading};font-size:12px;color:${colors.muted};padding-top:24px;border-top:1px dashed ${colors.border}}
    `;

    let html = '<div class="wrap">';
    html += `<div class="prompt"><span class="dollar">$</span> whoami</div>`;

    html += '<header class="hero">';
    html += `<h1><span class="at">@</span>${H.escapeHTML(username)}</h1>`;
    if (id.headline) html += `<div class="headline">${H.escapeHTML(id.headline)}</div>`;
    const metaBits = [];
    if (id.location) metaBits.push(`<span>${H.escapeHTML(id.location)}</span>`);
    if (id.email) metaBits.push(`<a href="mailto:${H.escapeHTML(id.email)}">${H.escapeHTML(id.email)}</a>`);
    links.forEach(l => metaBits.push(`<a href="${H.escapeHTML(l.href)}" target="_blank" rel="noopener">${H.escapeHTML(l.label.toLowerCase())}</a>`));
    if (metaBits.length) html += `<div class="meta">${metaBits.join('')}</div>`;
    html += '</header>';

    if (about.tagline || about.bio){
      html += '<section><div class="section-head"><span class="label">## about</span><span class="rule"></span></div>';
      html += '<div class="about">';
      if (about.tagline) html += `<div class="tagline">${H.escapeHTML(about.tagline)}</div>`;
      if (about.bio) html += `<p>${H.escapeHTML(about.bio).replace(/\n+/g, '</p><p>')}</p>`;
      html += '</div></section>';
    }

    const projects = (state.projects || []).filter(p => p.title);
    if (projects.length){
      html += '<section><div class="section-head"><span class="label">## projects</span><span class="rule"></span></div>';
      projects.forEach(p => {
        html += '<div class="repo">';
        html += '<div class="head">';
        html += `<h3><span class="slash">/</span>${H.escapeHTML(p.title)}</h3>`;
        if (p.role) html += `<div class="role">${H.escapeHTML(p.role)}</div>`;
        html += '</div>';
        if (p.summary) html += `<p>${H.escapeHTML(p.summary)}</p>`;
        const linkBits = [];
        if (p.links?.live) linkBits.push(`<a href="${H.escapeHTML(H.ensureUrl(p.links.live))}" target="_blank" rel="noopener">live →</a>`);
        if (p.links?.repo) linkBits.push(`<a href="${H.escapeHTML(H.ensureUrl(p.links.repo))}" target="_blank" rel="noopener">source →</a>`);
        if (linkBits.length) html += `<div class="links">${linkBits.join('')}</div>`;
        if (Array.isArray(p.tech) && p.tech.length){
          html += `<div class="tech">${p.tech.map(t => `<span>${H.escapeHTML(t)}</span>`).join('')}</div>`;
        }
        html += '</div>';
      });
      html += '</section>';
    }

    const experiences = (state.experience || []).filter(e => e.role || e.company);
    if (experiences.length){
      html += '<section><div class="section-head"><span class="label">## experience</span><span class="rule"></span></div>';
      experiences.forEach(e => {
        html += '<div class="exp">';
        html += `<h3>${H.escapeHTML(e.role || 'Role')}</h3>`;
        html += `<div class="sub">${H.escapeHTML(e.company || '')}${e.dates ? ' · ' + H.escapeHTML(e.dates) : ''}</div>`;
        if (Array.isArray(e.highlights) && e.highlights.length){
          html += '<ul>' + e.highlights.filter(Boolean).map(h => `<li>${H.escapeHTML(h)}</li>`).join('') + '</ul>';
        }
        html += '</div>';
      });
      html += '</section>';
    }

    const groups = (state.skills?.groups || []).filter(g => g.items?.length);
    if (groups.length){
      html += '<section><div class="section-head"><span class="label">## stack</span><span class="rule"></span></div><div class="skills">';
      groups.forEach(g => {
        html += '<div class="skill-group">';
        if (g.name) html += `<div class="name">${H.escapeHTML(g.name)}</div>`;
        html += `<div class="items">${g.items.map(it => `<span>${H.escapeHTML(it)}</span>`).join('')}</div>`;
        html += '</div>';
      });
      html += '</div></section>';
    }

    const education = (state.education || []).filter(e => e.school || e.degree);
    if (education.length){
      html += '<section><div class="section-head"><span class="label">## education</span><span class="rule"></span></div>';
      education.forEach(e => {
        html += '<div class="exp">';
        html += `<h3>${H.escapeHTML(e.degree || 'Degree')}</h3>`;
        html += `<div class="sub">${H.escapeHTML(e.school || '')}${e.dates ? ' · ' + H.escapeHTML(e.dates) : ''}</div>`;
        html += '</div>';
      });
      html += '</section>';
    }

    html += `<footer>$ exit · © ${new Date().getFullYear()} ${H.escapeHTML(name)}</footer>`;
    html += '</div>';

    return { html, css };
  }

  window.PortfolioTemplates.register({
    id: 'developer',
    name: 'Developer',
    description: 'Monospace, terminal aesthetic, projects-first.',
    render
  });
})();
