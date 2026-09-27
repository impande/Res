'use strict';
/*
 * MOCK_AI=1 only — lets the agent itself be developed and self-tested against a
 * local copy of the site (no Netlify functions, no API key). Live runs never
 * load this: the whole point of the daily audit is to exercise the real AI.
 *
 * Answers are shaped from the prompt so downstream UI behaves as in production.
 */
function field(prompt, label) {
  const m = prompt.match(new RegExp(label + ':\\s*(.+)'));
  return m ? m[1].trim() : '';
}

function resumeFromPrompt(prompt) {
  const exp = [];
  const re = /Role Title:\s*(.*)\n\s*Company:\s*(.*)\n\s*Period:\s*(.*?)\s*[–-]\s*(.*)\n/g;
  let m;
  while ((m = re.exec(prompt))) {
    exp.push({ title: m[1].trim(), co: m[2].trim(), start: m[3].trim(), end: m[4].trim(), bullets: [
      'Built payment APIs in Python serving 2M users with 99.9% uptime',
      'Reduced checkout latency by 35% through React code-splitting',
      'Mentored 4 engineers and led design reviews across 3 teams',
    ] });
  }
  const edu = [...prompt.matchAll(/^- (.+?) from (.+?) \((.*?)\)/gm)].map(x => ({ deg: x[1], sch: x[2], yr: x[3], gpa: '' }));
  const awards = [...prompt.matchAll(/^- (.+?) \| (.+?) \| (\d{4})/gm)].map(x => ({ name: x[1], org: x[2], year: x[3], desc: '' }));
  const skills = field(prompt, 'Skills').split(/,\s*/).filter(Boolean);
  return {
    summary: 'Senior software engineer with 6+ years building scalable payment platforms in Python, React and AWS. Proven record of cutting latency, raising reliability and mentoring engineers to ship high-impact products for millions of users.',
    experience: exp, awards, education: edu, skills,
  };
}

function answer(prompt, images) {
  const p = prompt || '';
  if (/From the KEYWORDS below/.test(p)) return 'Microservices, PostgreSQL, CI/CD';
  if (/tailoring a résumé to a specific job\. Rewrite the bullet/.test(p)) return 'Architected Python microservices on AWS serving 2M users\nCut API latency 35% with PostgreSQL query tuning\nAutomated CI/CD pipelines on Kubernetes, shipping daily';
  if (/tailoring a candidate.s résumé to a specific job/.test(p)) return 'Senior software engineer building reliable payment microservices with Python, React, AWS and Kubernetes for millions of users.';
  if (/You are an ATS\. Extract/.test(p)) return 'python, react, aws, kubernetes, microservices, ci/cd, rest apis, postgresql, system design, observability';
  if (/cover letter/i.test(p)) return 'Dear Hiring Manager,\n\nI am excited to apply for the Senior Software Engineer role at Razorpay. Over the last six years I have built payment systems in Python and React that serve millions of users, most recently leading a team of six engineers at Infosys where we cut API latency by 35%.\n\nYour focus on reliable, scalable payments matches exactly the work I enjoy most, and I would love to bring my experience with AWS and Kubernetes to your platform team.\n\nThank you for your time and consideration.\n\nSincerely,\nQa Audit';
  if (/interview-winning resume/i.test(p)) return JSON.stringify(resumeFromPrompt(p));
  if (/EXACTLY 5 concise, high-impact "key achievements"/i.test(p)) return JSON.stringify([1, 2, 3, 4, 5].map(i => ({ icon: '🏆', title: 'Achievement ' + i, desc: 'Delivered measurable impact #' + i })));
  if (/extract|parse/i.test(p) && /resume/i.test(p) && /json/i.test(p)) {
    const pdf = (images && images.length) || /Ananya/.test(p);
    return JSON.stringify(pdf ? {
      firstName: 'Ananya', lastName: 'Iyer', jobTitle: 'Product Manager', email: 'ananya.iyer@example.com', phone: '+91 99887 76655', location: 'Chennai, India',
      experience: [{ title: 'Product Manager', co: 'Zoho', start: 'Apr 2021', end: 'Present', desc: 'Owned the CRM mobile app roadmap' }],
      education: [{ deg: 'MBA', sch: 'IIM Kozhikode', yr: '2019', gpa: '' }], skills: ['Product strategy', 'SQL'],
    } : {
      firstName: 'Rohan', lastName: 'Mehta', jobTitle: 'Data Analyst', email: 'rohan.mehta@example.com', phone: '+91 91234 56789', location: 'Bengaluru, India',
      experience: [{ title: 'Data Analyst', co: 'Flipkart', start: 'Mar 2022', end: 'Present', desc: 'Built SQL + Python dashboards' }],
      education: [{ deg: 'B.Sc. Statistics', sch: 'Christ University', yr: '2020', gpa: '' }], skills: ['SQL', 'Python', 'Tableau'],
    });
  }
  if (/bullet/i.test(p) && !/cover letter/i.test(p)) return '• Architected event-driven services handling 1M requests/day\n• Cut infrastructure cost 20% by right-sizing Kubernetes clusters\n• Automated CI/CD, reducing release time from 2 days to 2 hours';
  if (/skills?/i.test(p) && /suggest/i.test(p)) return JSON.stringify(['Docker', 'PostgreSQL', 'CI/CD', 'System Design', 'Microservices']);
  if (/summary/i.test(p)) return 'Results-driven senior engineer who builds reliable, high-scale payment systems.';
  return JSON.stringify({ ok: true, text: 'Mock response' });
}

// In-memory stand-in for the Firestore REST calls behind Share/QR (/r/) and
// portfolio links (/p/), shared across pages so a published doc can be viewed.
const fsDocs = new Map();
async function fakeFirestore(route) {
  const req = route.request();
  const m = req.url().match(/\/documents\/portfolios\/([^?]+)/);
  if (!m) return route.fulfill({ json: {} });
  const slug = decodeURIComponent(m[1]);
  if (req.method() === 'PATCH') {
    const body = JSON.parse(req.postData() || '{}');
    fsDocs.set(slug, { ...(fsDocs.get(slug) || {}), ...(body.fields || {}) });
    return route.fulfill({ json: { name: 'portfolios/' + slug, fields: fsDocs.get(slug) } });
  }
  if (!fsDocs.has(slug)) return route.fulfill({ status: 404, json: { error: { code: 404, status: 'NOT_FOUND' } } });
  return route.fulfill({ json: { name: 'portfolios/' + slug, fields: fsDocs.get(slug) } });
}

async function install(page, log) {
  await page.route('https://firestore.googleapis.com/**', fakeFirestore);
  // Offline stand-ins for third parties the sandboxed dev box can't reach.
  await page.route('https://api.github.com/users/**', route => {
    const login = route.request().url().split('/users/')[1].split(/[/?]/)[0];
    if (/\/repos/.test(route.request().url())) return route.fulfill({ json: [
      { name: 'linux', description: 'Linux kernel source tree', language: 'C', stargazers_count: 180000, html_url: 'https://github.com/' + login + '/linux', fork: false },
      { name: 'subsurface', description: 'Dive log program', language: 'C++', stargazers_count: 2600, html_url: 'https://github.com/' + login + '/subsurface', fork: false },
    ] });
    return route.fulfill({ json: { login, name: 'Linus Torvalds', company: 'Linux Foundation', blog: '', location: 'Portland, OR', email: null, bio: 'Creator of Linux and Git', public_repos: 8, followers: 200000, html_url: 'https://github.com/' + login } });
  });
  if (process.env.MOCK_CDN_DIR) {
    const fs = require('fs'), path = require('path');
    await page.route('https://cdnjs.cloudflare.com/ajax/libs/pdf.js/**', route => {
      const f = path.join(process.env.MOCK_CDN_DIR, path.basename(new URL(route.request().url()).pathname));
      return fs.existsSync(f) ? route.fulfill({ path: f, contentType: 'text/javascript' }) : route.abort();
    });
  }
  await page.route('**/.netlify/functions/**', async route => {
    const req = route.request();
    let body = {};
    try { body = JSON.parse(req.postData() || '{}'); } catch (e) {}
    if (body.action === 'check-paid') return route.fulfill({ json: { paid: false } });
    if (body.action === 'create-order') return route.fulfill({ status: 501, json: { error: 'mock' } });
    const prompt = body.prompt || body.message || '';
    const text = answer(prompt, body.images);
    if (log && !/interview-winning/.test(prompt)) log('      [mock-ai] ' + prompt.replace(/\s+/g, ' ').slice(0, 160));
    await new Promise(r => setTimeout(r, 300));
    await route.fulfill({ json: { text } });
  });
}

module.exports = { install };
