// Cross-fill: hand data between the résumé builder and the portfolio builder.
// Each side stores its own working state; this module is the translator + courier.
//
//   resume.js  state shape  →   resume side: { name, title, email, phone, location, website, yoe, experiences, educations, skills, tone }
//   portfolio state.js shape →  portfolio side: { identity, about, experience, projects, skills.groups, education, theme }
//
// Handoff lives in localStorage under two well-known keys. The receiving page
// picks it up, hydrates its own state, and clears the handoff so reloads don't
// re-import.

(function(){
  const RESUME_KEY    = 'crossfill.resume.v1';
  const PORTFOLIO_KEY = 'crossfill.portfolio.v1';

  // ---- localStorage handoff ----
  function safeSet(key, val){
    try { localStorage.setItem(key, JSON.stringify(val)); return true; }
    catch { return false; }
  }
  function safeGet(key){
    try {
      const raw = localStorage.getItem(key);
      return raw ? JSON.parse(raw) : null;
    } catch { return null; }
  }
  function clear(key){ try { localStorage.removeItem(key); } catch {} }

  function exportResume(resumeData){ return safeSet(RESUME_KEY, resumeData); }
  function readResume(){ return safeGet(RESUME_KEY); }
  function clearResume(){ clear(RESUME_KEY); }
  function hasResume(){ return !!safeGet(RESUME_KEY); }

  function exportPortfolio(portfolioState){ return safeSet(PORTFOLIO_KEY, portfolioState); }
  function readPortfolio(){ return safeGet(PORTFOLIO_KEY); }
  function clearPortfolio(){ clear(PORTFOLIO_KEY); }
  function hasPortfolio(){ return !!safeGet(PORTFOLIO_KEY); }

  // ---- Translators ----
  //
  // résumé → portfolio
  // name "Alex Chen" → identity.firstName/lastName
  // title → identity.headline
  // website → identity.social.linkedin or .website (best-guess by URL)
  // bullets text blob → highlights array (split on newlines)
  // skills flat array → one "Skills" group on the portfolio side
  function resumeToPortfolio(r){
    if (!r || typeof r !== 'object') return null;

    const [firstName, ...rest] = (r.name || '').trim().split(/\s+/);
    const lastName = rest.join(' ');

    const website = (r.website || '').trim();
    const social = {};
    if (/linkedin/i.test(website))     social.linkedin = website;
    else if (/github/i.test(website))  social.github = website;
    else if (/twitter|x\.com/i.test(website)) social.twitter = website;
    else if (website)                  social.website = website;

    const experience = (r.experiences || []).map((e, i) => ({
      id: 'exp-' + (i + 1),
      role: e.role || '',
      company: e.company || '',
      dates: e.dates || '',
      highlights: splitBullets(e.bullets)
    }));

    const education = (r.educations || []).map((e, i) => ({
      id: 'edu-' + (i + 1),
      school: e.school || '',
      degree: e.degree || '',
      dates: e.year || '',
      gpa: e.gpa || ''
    }));

    const skillGroups = (r.skills && r.skills.length)
      ? [{ id: 'sg-1', name: 'Skills', items: r.skills.slice() }]
      : [];

    return {
      identity: {
        firstName: firstName || '',
        lastName,
        headline: r.title || '',
        location: r.location || '',
        email: r.email || '',
        avatar: '',
        social: Object.assign({ linkedin: '', github: '', twitter: '', website: '' }, social)
      },
      about: { tagline: '', bio: '' },
      experience,
      projects: [],
      skills: { groups: skillGroups },
      education,
      contact: { ctaText: 'Get in touch', formEnabled: false },
      theme: { templateId: 'executive', accent: '#c4a96b', fontPair: 'serif-modern', mode: 'light' }
    };
  }

  // portfolio → résumé
  // identity.firstName + lastName → name
  // identity.headline → title
  // social → website (linkedin first, then website)
  // experience[].highlights[] → bullets joined with newlines
  // education[].dates → year
  // skills.groups[] → flat array
  function portfolioToResume(p){
    if (!p || typeof p !== 'object') return null;
    const id = p.identity || {};
    const social = id.social || {};
    const website = social.linkedin || social.website || social.github || social.twitter || '';

    const experiences = (p.experience || []).map((e, i) => ({
      id: 'exp-' + (i + 1),
      role: e.role || '',
      company: e.company || '',
      dates: e.dates || '',
      bullets: (e.highlights || []).filter(Boolean).join('\n')
    }));

    const educations = (p.education || []).map((e, i) => ({
      id: 'edu-' + (i + 1),
      degree: e.degree || '',
      school: e.school || '',
      year: e.dates || '',
      gpa: e.gpa || ''
    }));

    const skills = ((p.skills && p.skills.groups) || []).flatMap(g => g.items || []);

    return {
      name: [id.firstName, id.lastName].filter(Boolean).join(' '),
      title: id.headline || '',
      email: id.email || '',
      phone: '',                  // portfolio doesn't store phone
      location: id.location || '',
      website,
      yoe: '',                    // not modeled on portfolio side
      experiences,
      educations,
      skills,
      tone: 'professional'
    };
  }

  function splitBullets(blob){
    if (!blob) return [];
    return String(blob)
      .split(/\r?\n+/)
      .map(s => s.replace(/^\s*[-•*]\s*/, '').trim())
      .filter(Boolean);
  }

  window.CrossFill = {
    RESUME_KEY, PORTFOLIO_KEY,
    exportResume, readResume, clearResume, hasResume,
    exportPortfolio, readPortfolio, clearPortfolio, hasPortfolio,
    resumeToPortfolio, portfolioToResume
  };
})();
