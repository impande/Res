// Designer template — image-led, magazine grid, editorial typography.

(function(){
  const H = window.PortfolioTemplateHelpers;

  function render(state){
    const id = state.identity || {};
    const about = state.about || {};
    const theme = state.theme || {};
    const fonts = H.fontStack(theme.fontPair === 'serif-modern' ? 'editorial' : theme.fontPair);
    const colors = H.modeColors(theme.mode);
    const accent = theme.accent || '#c4a96b';
    const name = H.fullName(id) || 'Your Name';
    const links = H.socialLinks(id);

    const css = `
      ${H.fontImport(theme.fontPair === 'serif-modern' ? 'editorial' : theme.fontPair)}
      *{box-sizing:border-box;margin:0;padding:0}
      html,body{background:${colors.bg};color:${colors.text};font-family:${fonts.body};font-size:17px;line-height:1.6;-webkit-font-smoothing:antialiased}
      a{color:${colors.text};text-decoration:none;border-bottom:1px solid ${accent}}
      a:hover{color:${accent}}
      h1,h2,h3{font-family:${fonts.heading};font-weight:600}
      .wrap{max-width:1200px;margin:0 auto;padding:48px 32px 96px}

      .topbar{display:flex;justify-content:space-between;align-items:baseline;margin-bottom:96px;padding-bottom:18px;border-bottom:1px solid ${colors.border}}
      .topbar .mark{font-family:${fonts.heading};font-size:22px;font-style:italic}
      .topbar .links{display:flex;gap:18px;font-size:13px}
      .topbar .links a{color:${colors.muted};border:none}
      .topbar .links a:hover{color:${accent}}

      .hero{display:grid;grid-template-columns:1fr 1fr;gap:56px;align-items:end;margin-bottom:96px}
      .hero .lead h1{font-size:68px;line-height:1;letter-spacing:-0.02em;margin-bottom:24px}
      .hero .lead h1 em{font-style:italic;color:${accent};font-weight:500}
      .hero .lead .headline{font-size:22px;color:${colors.muted};line-height:1.4;margin-bottom:28px;max-width:540px}
      .hero .lead .meta{display:flex;flex-wrap:wrap;gap:18px;font-size:13px;color:${colors.muted}}
      .hero .lead .meta span,.hero .lead .meta a{color:${colors.muted};border:none}
      .hero .lead .meta a:hover{color:${accent}}
      .hero .visual{height:480px;background:${colors.surface};border-radius:4px;background-size:cover;background-position:center}

      section{margin-bottom:96px}
      .sec-head{display:flex;justify-content:space-between;align-items:baseline;margin-bottom:36px;border-bottom:1px solid ${colors.border};padding-bottom:14px}
      .sec-head h2{font-size:32px;font-style:italic}
      .sec-head .count{font-family:${fonts.body};font-size:13px;color:${colors.muted};letter-spacing:0.1em;text-transform:uppercase}

      .about{display:grid;grid-template-columns:1fr 2fr;gap:48px;align-items:start}
      .about .label{font-family:${fonts.body};font-size:12px;color:${accent};letter-spacing:0.14em;text-transform:uppercase}
      .about .body{font-size:20px;line-height:1.55}
      .about .body p{margin-bottom:14px}
      .about .body .tagline{font-style:italic;color:${accent};margin-bottom:18px;font-family:${fonts.heading};font-size:24px}

      .work-grid{display:grid;grid-template-columns:repeat(2,1fr);gap:56px 40px}
      .work{display:flex;flex-direction:column}
      .work .img{width:100%;aspect-ratio:4/3;background:${colors.surface};margin-bottom:18px;border-radius:4px;background-size:cover;background-position:center}
      .work .num{font-family:${fonts.body};font-size:12px;color:${colors.muted};letter-spacing:0.12em;margin-bottom:6px}
      .work h3{font-size:26px;margin-bottom:6px;font-style:italic}
      .work .role{font-size:13px;color:${accent};margin-bottom:10px;letter-spacing:0.08em;text-transform:uppercase}
      .work .summary{font-size:16px;line-height:1.55;color:${colors.text};margin-bottom:12px}
      .work .links{display:flex;gap:14px;font-size:13px;margin-bottom:10px}
      .work .links a{border-bottom:1px solid ${accent}}
      .work .tech{display:flex;flex-wrap:wrap;gap:6px}
      .work .tech span{font-size:11px;color:${colors.muted};font-family:${fonts.body};text-transform:uppercase;letter-spacing:0.08em}
      .work .tech span:not(:last-child)::after{content:' ·';color:${colors.muted}}

      .timeline{display:grid;grid-template-columns:160px 1fr;gap:32px}
      .timeline .col-head{font-family:${fonts.body};font-size:12px;color:${colors.muted};letter-spacing:0.12em;text-transform:uppercase}
      .timeline .row{display:contents}
      .timeline .row .when{padding-top:18px;font-size:13px;color:${colors.muted}}
      .timeline .row .what{padding:14px 0 22px;border-top:1px solid ${colors.border}}
      .timeline .row .what h3{font-size:20px;font-style:italic;margin-bottom:4px}
      .timeline .row .what .where{font-size:13px;color:${accent};margin-bottom:8px;letter-spacing:0.06em;text-transform:uppercase}
      .timeline .row .what ul{margin-left:18px;font-size:15px}
      .timeline .row .what li{margin-bottom:4px}

      .skills-row{display:grid;grid-template-columns:repeat(auto-fit,minmax(220px,1fr));gap:32px}
      .skill-group .name{font-family:${fonts.body};font-size:12px;color:${accent};letter-spacing:0.12em;text-transform:uppercase;margin-bottom:8px}
      .skill-group .items{font-size:16px;line-height:1.6}

      footer{margin-top:96px;padding-top:36px;border-top:1px solid ${colors.border};display:flex;justify-content:space-between;font-size:13px;color:${colors.muted};flex-wrap:wrap;gap:12px}
      footer .right{font-style:italic}

      @media(max-width:820px){
        .hero{grid-template-columns:1fr}
        .hero .visual{height:280px;order:-1}
        .hero .lead h1{font-size:48px}
        .work-grid{grid-template-columns:1fr}
        .about{grid-template-columns:1fr}
        .timeline{grid-template-columns:1fr;gap:8px}
        .timeline .col-head{display:none}
      }
    `;

    const initials = name.split(' ').map(s => s[0]).join('').slice(0, 2).toUpperCase();

    let html = '<div class="wrap">';

    html += `<div class="topbar"><div class="mark">${H.escapeHTML(initials || '—')}</div><div class="links">`;
    if (id.email) html += `<a href="mailto:${H.escapeHTML(id.email)}">Email</a>`;
    links.forEach(l => html += `<a href="${H.escapeHTML(l.href)}" target="_blank" rel="noopener">${H.escapeHTML(l.label)}</a>`);
    html += '</div></div>';

    html += '<header class="hero">';
    html += '<div class="lead">';
    html += `<h1>${H.escapeHTML(name.split(' ')[0])} <em>${H.escapeHTML(name.split(' ').slice(1).join(' ') || '')}</em></h1>`;
    if (id.headline) html += `<div class="headline">${H.escapeHTML(id.headline)}</div>`;
    const metaBits = [];
    if (id.location) metaBits.push(`<span>${H.escapeHTML(id.location)}</span>`);
    metaBits.push(`<span>Available for select work</span>`);
    if (metaBits.length) html += `<div class="meta">${metaBits.join('')}</div>`;
    html += '</div>';
    const heroBg = id.avatar ? `background-image:url(${id.avatar})` : '';
    html += `<div class="visual" style="${heroBg}"></div>`;
    html += '</header>';

    if (about.tagline || about.bio){
      html += '<section><div class="sec-head"><h2>About</h2><span class="count">— 01</span></div>';
      html += '<div class="about"><div class="label">A few words</div><div class="body">';
      if (about.tagline) html += `<div class="tagline">${H.escapeHTML(about.tagline)}</div>`;
      if (about.bio) html += `<p>${H.escapeHTML(about.bio).replace(/\n+/g, '</p><p>')}</p>`;
      html += '</div></div></section>';
    }

    const projects = (state.projects || []).filter(p => p.title);
    if (projects.length){
      html += `<section><div class="sec-head"><h2>Selected Work</h2><span class="count">— ${String(projects.length).padStart(2,'0')}</span></div>`;
      html += '<div class="work-grid">';
      projects.forEach((p, i) => {
        html += '<div class="work">';
        const bg = p.image ? `background-image:url(${p.image})` : '';
        html += `<div class="img" style="${bg}"></div>`;
        html += `<div class="num">— ${String(i + 1).padStart(2,'0')} / ${String(projects.length).padStart(2,'0')}</div>`;
        html += `<h3>${H.escapeHTML(p.title)}</h3>`;
        if (p.role) html += `<div class="role">${H.escapeHTML(p.role)}</div>`;
        if (p.summary) html += `<div class="summary">${H.escapeHTML(p.summary)}</div>`;
        const linkBits = [];
        if (p.links?.live) linkBits.push(`<a href="${H.escapeHTML(H.ensureUrl(p.links.live))}" target="_blank" rel="noopener">View live</a>`);
        if (p.links?.repo) linkBits.push(`<a href="${H.escapeHTML(H.ensureUrl(p.links.repo))}" target="_blank" rel="noopener">Source</a>`);
        if (linkBits.length) html += `<div class="links">${linkBits.join('')}</div>`;
        if (Array.isArray(p.tech) && p.tech.length){
          html += `<div class="tech">${p.tech.map(t => `<span>${H.escapeHTML(t)}</span>`).join('')}</div>`;
        }
        html += '</div>';
      });
      html += '</div></section>';
    }

    const experiences = (state.experience || []).filter(e => e.role || e.company);
    if (experiences.length){
      html += '<section><div class="sec-head"><h2>Experience</h2><span class="count">— ' + String(experiences.length).padStart(2,'0') + '</span></div>';
      html += '<div class="timeline"><div class="col-head">When</div><div class="col-head">Where</div>';
      experiences.forEach(e => {
        html += '<div class="row">';
        html += `<div class="when">${H.escapeHTML(e.dates || '')}</div>`;
        html += '<div class="what">';
        html += `<h3>${H.escapeHTML(e.role || 'Role')}</h3>`;
        html += `<div class="where">${H.escapeHTML(e.company || '')}</div>`;
        if (Array.isArray(e.highlights) && e.highlights.length){
          html += '<ul>' + e.highlights.filter(Boolean).map(h => `<li>${H.escapeHTML(h)}</li>`).join('') + '</ul>';
        }
        html += '</div></div>';
      });
      html += '</div></section>';
    }

    const groups = (state.skills?.groups || []).filter(g => g.items?.length);
    if (groups.length){
      html += '<section><div class="sec-head"><h2>Skills</h2><span class="count">— ' + String(groups.length).padStart(2,'0') + '</span></div>';
      html += '<div class="skills-row">';
      groups.forEach(g => {
        html += '<div class="skill-group">';
        if (g.name) html += `<div class="name">${H.escapeHTML(g.name)}</div>`;
        html += `<div class="items">${g.items.map(H.escapeHTML).join(', ')}</div>`;
        html += '</div>';
      });
      html += '</div></section>';
    }

    const education = (state.education || []).filter(e => e.school || e.degree);
    if (education.length){
      html += '<section><div class="sec-head"><h2>Education</h2><span class="count">— ' + String(education.length).padStart(2,'0') + '</span></div>';
      html += '<div class="timeline"><div class="col-head">When</div><div class="col-head">Where</div>';
      education.forEach(e => {
        html += '<div class="row">';
        html += `<div class="when">${H.escapeHTML(e.dates || '')}</div>`;
        html += '<div class="what">';
        html += `<h3>${H.escapeHTML(e.degree || 'Degree')}</h3>`;
        html += `<div class="where">${H.escapeHTML(e.school || '')}</div>`;
        html += '</div></div>';
      });
      html += '</div></section>';
    }

    html += '<footer>';
    html += `<span>© ${new Date().getFullYear()} ${H.escapeHTML(name)}</span>`;
    html += '<span class="right">Designed in the open.</span>';
    html += '</footer>';

    html += '</div>';

    return { html, css };
  }

  window.PortfolioTemplates.register({
    id: 'designer',
    name: 'Designer',
    description: 'Magazine grid, editorial serif, image-led.',
    render
  });
})();
