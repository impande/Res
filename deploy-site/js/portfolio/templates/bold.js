// Bold template — big hero, color blocks, sans-serif.

(function(){
  const H = window.PortfolioTemplateHelpers;

  function render(state){
    const id = state.identity || {};
    const about = state.about || {};
    const theme = state.theme || {};
    const fonts = H.fontStack(theme.fontPair === 'serif-modern' ? 'sans-clean' : theme.fontPair);
    const colors = H.modeColors(theme.mode);
    const accent = theme.accent || '#c4a96b';
    const name = H.fullName(id) || 'Your Name';
    const links = H.socialLinks(id);

    const css = `
      ${H.fontImport(theme.fontPair)}
      *{box-sizing:border-box;margin:0;padding:0}
      html,body{background:${colors.bg};color:${colors.text};font-family:${fonts.body};font-size:16px;line-height:1.6;-webkit-font-smoothing:antialiased}
      a{color:${accent};text-decoration:none}
      a:hover{text-decoration:underline}
      h1,h2,h3{font-family:${fonts.heading};font-weight:700;letter-spacing:-0.02em}
      .wrap{max-width:1120px;margin:0 auto;padding:0 36px}
      .hero{padding:96px 0 72px;border-bottom:2px solid ${accent};margin-bottom:64px;position:relative}
      .hero .name{font-size:88px;line-height:1;margin-bottom:18px;color:${colors.text}}
      .hero .name em{font-style:normal;color:${accent}}
      .hero .headline{font-size:24px;color:${colors.muted};max-width:760px;margin-bottom:22px;line-height:1.35}
      .hero .meta{display:flex;flex-wrap:wrap;gap:24px;font-size:14px}
      .hero .meta span,.hero .meta a{color:${colors.muted}}
      .hero .meta a:hover{color:${accent}}
      .badge{display:inline-block;background:${accent};color:${colors.bg};padding:6px 14px;border-radius:4px;font-size:11px;letter-spacing:0.12em;text-transform:uppercase;font-weight:600;margin-bottom:24px}
      section{margin-bottom:72px}
      section h2{font-size:32px;margin-bottom:28px;color:${colors.text}}
      section h2 .marker{display:inline-block;width:36px;height:4px;background:${accent};vertical-align:middle;margin-right:14px;border-radius:2px}
      .about p{font-size:19px;line-height:1.6;max-width:760px}
      .tagline{font-size:21px;color:${accent};margin-bottom:16px;font-weight:500}
      .grid-2{display:grid;grid-template-columns:1fr 1fr;gap:28px}
      .card{background:${colors.surface};border:1px solid ${colors.border};border-radius:12px;padding:24px}
      .card img{width:100%;border-radius:8px;margin-bottom:14px;display:block;background:${colors.bg}}
      .card h3{font-size:20px;margin-bottom:6px}
      .card .role{font-size:13px;color:${accent};text-transform:uppercase;letter-spacing:0.08em;margin-bottom:10px;font-weight:500}
      .card .summary{font-size:14px;color:${colors.text};margin-bottom:12px;line-height:1.6}
      .card .links{display:flex;gap:14px;font-size:13px;margin-bottom:10px;font-weight:500}
      .card .tech{display:flex;flex-wrap:wrap;gap:6px}
      .card .tech span{font-size:11px;background:${colors.bg};border:1px solid ${colors.border};padding:3px 10px;border-radius:12px;color:${colors.muted}}
      .timeline{display:flex;flex-direction:column;gap:32px}
      .tline{display:grid;grid-template-columns:180px 1fr;gap:32px;padding-left:18px;border-left:2px solid ${colors.border};position:relative}
      .tline::before{content:'';position:absolute;left:-7px;top:8px;width:12px;height:12px;background:${accent};border-radius:50%}
      .tline .when{font-size:13px;color:${colors.muted};padding-top:6px}
      .tline h3{font-size:19px;margin-bottom:2px}
      .tline .where{font-size:14px;color:${accent};margin-bottom:8px;font-weight:500}
      .tline ul{margin-left:18px;font-size:14px;color:${colors.text}}
      .tline li{margin-bottom:4px}
      .skills{display:grid;grid-template-columns:repeat(auto-fit,minmax(220px,1fr));gap:24px}
      .skill-group{background:${colors.surface};border:1px solid ${colors.border};border-radius:12px;padding:18px}
      .skill-group .name{font-size:12px;color:${accent};text-transform:uppercase;letter-spacing:0.1em;margin-bottom:8px;font-weight:600}
      .skill-group .items{display:flex;flex-wrap:wrap;gap:6px}
      .skill-group .items span{font-size:13px;color:${colors.text};background:${colors.bg};padding:4px 10px;border-radius:12px;border:1px solid ${colors.border}}
      footer{margin-top:96px;padding:36px 0;border-top:1px solid ${colors.border};color:${colors.muted};font-size:13px;display:flex;justify-content:space-between;flex-wrap:wrap;gap:12px}
      @media(max-width:720px){
        .hero .name{font-size:56px}
        .hero .headline{font-size:18px}
        .grid-2{grid-template-columns:1fr}
        .tline{grid-template-columns:1fr;gap:8px}
      }
    `;

    let html = '<div class="wrap">';

    html += '<header class="hero">';
    html += '<div class="badge">Portfolio</div>';
    html += `<h1 class="name">${H.escapeHTML(name.split(' ')[0])} <em>${H.escapeHTML(name.split(' ').slice(1).join(' ') || '')}</em></h1>`;
    if (id.headline) html += `<div class="headline">${H.escapeHTML(id.headline)}</div>`;
    const metaBits = [];
    if (id.location) metaBits.push(`<span>${H.escapeHTML(id.location)}</span>`);
    if (id.email) metaBits.push(`<a href="mailto:${H.escapeHTML(id.email)}">${H.escapeHTML(id.email)}</a>`);
    links.forEach(l => metaBits.push(`<a href="${H.escapeHTML(l.href)}" target="_blank" rel="noopener">${H.escapeHTML(l.label)}</a>`));
    if (metaBits.length) html += `<div class="meta">${metaBits.join('')}</div>`;
    html += '</header>';

    if (about.tagline || about.bio){
      html += '<section class="about"><h2><span class="marker"></span>About</h2>';
      if (about.tagline) html += `<div class="tagline">${H.escapeHTML(about.tagline)}</div>`;
      if (about.bio) html += `<p>${H.escapeHTML(about.bio).replace(/\n+/g, '</p><p>')}</p>`;
      html += '</section>';
    }

    const projects = (state.projects || []).filter(p => p.title);
    if (projects.length){
      html += '<section><h2><span class="marker"></span>Selected Work</h2><div class="grid-2">';
      projects.forEach(p => {
        html += '<div class="card">';
        if (p.image) html += `<img src="${H.escapeHTML(p.image)}" alt="${H.escapeHTML(p.title)}">`;
        html += `<h3>${H.escapeHTML(p.title)}</h3>`;
        if (p.role) html += `<div class="role">${H.escapeHTML(p.role)}</div>`;
        if (p.summary) html += `<div class="summary">${H.escapeHTML(p.summary)}</div>`;
        const linkBits = [];
        if (p.links?.live) linkBits.push(`<a href="${H.escapeHTML(H.ensureUrl(p.links.live))}" target="_blank" rel="noopener">Live →</a>`);
        if (p.links?.repo) linkBits.push(`<a href="${H.escapeHTML(H.ensureUrl(p.links.repo))}" target="_blank" rel="noopener">Code →</a>`);
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
      html += '<section><h2><span class="marker"></span>Experience</h2><div class="timeline">';
      experiences.forEach(e => {
        html += '<div class="tline">';
        html += `<div class="when">${H.escapeHTML(e.dates || '')}</div>`;
        html += '<div>';
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
      html += '<section><h2><span class="marker"></span>Skills</h2><div class="skills">';
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
      html += '<section><h2><span class="marker"></span>Education</h2><div class="timeline">';
      education.forEach(e => {
        html += '<div class="tline">';
        html += `<div class="when">${H.escapeHTML(e.dates || '')}</div>`;
        html += '<div>';
        html += `<h3>${H.escapeHTML(e.degree || 'Degree')}</h3>`;
        html += `<div class="where">${H.escapeHTML(e.school || '')}</div>`;
        html += '</div></div>';
      });
      html += '</div></section>';
    }

    html += '<footer>';
    html += `<span>© ${new Date().getFullYear()} ${H.escapeHTML(name)}</span>`;
    if (id.email) html += `<a href="mailto:${H.escapeHTML(id.email)}">${H.escapeHTML(id.email)}</a>`;
    html += '</footer>';

    html += '</div>';

    return { html, css };
  }

  window.PortfolioTemplates.register({
    id: 'bold',
    name: 'Bold',
    description: 'Large hero, color-blocked sections, projects-first.',
    render
  });
})();
