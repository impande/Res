'use strict';
/* Test personas and files. Every run uses a date-stamped name so a published
 * /r/ page from the audit is easy to spot (and to tell apart from real users). */
const fs = require('fs');
const path = require('path');
const zlib = require('zlib');

const stamp = new Date().toISOString().slice(0, 10).replace(/-/g, '');

const persona = {
  firstName: 'Qa',
  lastName: 'Audit' + stamp,          // unique per day, easy to find in Firestore
  jobTitle: 'Senior Software Engineer',
  email: 'qa.audit@example.com',
  phone: '+91 98765 43210',
  location: 'Pune, India',
  linkedin: 'linkedin.com/in/qa-audit',
  github: 'github.com/qa-audit',
  experience: [
    { title: 'Senior Software Engineer', co: 'Infosys', start: 'Jan 2021', end: 'Present',
      notes: 'Led a team of 6 engineers building payment APIs used by 2M users; cut latency 35%' },
    { title: 'Software Engineer', co: 'Tata Consultancy Services', start: 'Jul 2018', end: 'Dec 2020',
      notes: '' },  // blank on purpose: AI should write the bullets
  ],
  award: { name: 'AWS Certified Solutions Architect', year: '2023', org: 'Amazon Web Services', desc: 'Associate level certification' },
  keyAchievement: { title: 'Payments platform launch', desc: 'Shipped a UPI payments platform handling 1M transactions/day in 4 months.' },
  education: [
    { deg: 'B.Tech Computer Science', sch: 'COEP Pune', yr: '2018', gpa: '8.4/10' },
    { deg: 'Higher Secondary (XII)', sch: 'Fergusson College', yr: '2014', gpa: '' },
  ],
  skills: ['Python', 'React', 'AWS', 'Kubernetes'],
  customSection: { title: 'Languages', body: 'English, Hindi, Marathi' },
};

// Résumé as a user would paste it from LinkedIn / Google Docs.
const pastedResume = `Rohan Mehta
Data Analyst | rohan.mehta@example.com | +91 91234 56789 | Bengaluru, India
linkedin.com/in/rohan-mehta

SUMMARY
Data analyst with 3 years of experience turning messy data into business decisions.

EXPERIENCE
Data Analyst — Flipkart (Mar 2022 – Present)
- Built SQL + Python dashboards used by 40 category managers
- Reduced weekly reporting time by 60% by automating Excel pipelines

Junior Analyst — Mu Sigma (Jun 2020 – Feb 2022)
- Cleaned and modelled retail sales data for Fortune 500 clients

EDUCATION
B.Sc. Statistics, Christ University, 2020

SKILLS
SQL, Python, Tableau, Excel, Statistics`;

// Résumé for the upload test, rendered to a real PDF by the browser itself.
const uploadResumeHtml = `<!doctype html><html><body style="font-family:Arial;padding:40px">
<h1>Ananya Iyer</h1><p>Product Manager · ananya.iyer@example.com · +91 99887 76655 · Chennai, India</p>
<h2>Experience</h2>
<p><b>Product Manager</b>, Zoho — Apr 2021 to Present</p>
<ul><li>Owned the CRM mobile app roadmap for 500k monthly users</li><li>Grew activation 22% through onboarding redesign</li></ul>
<p><b>Associate Product Manager</b>, Freshworks — Jul 2019 to Mar 2021</p>
<h2>Education</h2><p>MBA, IIM Kozhikode, 2019</p><p>B.E. Electronics, Anna University, 2017</p>
<h2>Skills</h2><p>Product strategy, SQL, A/B testing, Figma, Jira</p>
</body></html>`;

async function makeResumePdf(browser, dir) {
  const file = path.join(dir, 'upload-resume.pdf');
  const ctx = await browser.newContext();
  const p = await ctx.newPage();
  await p.setContent(uploadResumeHtml);
  await p.pdf({ path: file, format: 'A4' });
  await ctx.close();
  return file;
}

// A real 64x64 PNG (solid orange) for the photo-upload steps, built without deps.
function makePhotoPng(dir) {
  const file = path.join(dir, 'photo.png');
  const w = 64, h = 64;
  const raw = Buffer.alloc((w * 3 + 1) * h);
  for (let y = 0; y < h; y++) {
    raw[y * (w * 3 + 1)] = 0;
    for (let x = 0; x < w; x++) { const o = y * (w * 3 + 1) + 1 + x * 3; raw[o] = 217; raw[o + 1] = 119; raw[o + 2] = 6; }
  }
  const crcTable = Array.from({ length: 256 }, (_, n) => { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1; return c >>> 0; });
  const crc = b => { let c = 0xffffffff; for (const x of b) c = crcTable[(c ^ x) & 255] ^ (c >>> 8); return (c ^ 0xffffffff) >>> 0; };
  const chunk = (type, data) => {
    const len = Buffer.alloc(4); len.writeUInt32BE(data.length);
    const td = Buffer.concat([Buffer.from(type), data]);
    const c = Buffer.alloc(4); c.writeUInt32BE(crc(td));
    return Buffer.concat([len, td, c]);
  };
  const ihdr = Buffer.alloc(13); ihdr.writeUInt32BE(w, 0); ihdr.writeUInt32BE(h, 4); ihdr[8] = 8; ihdr[9] = 2;
  fs.writeFileSync(file, Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', ihdr), chunk('IDAT', zlib.deflateSync(raw)), chunk('IEND', Buffer.alloc(0)),
  ]));
  return file;
}

const jobDescription = `We are hiring a Senior Software Engineer to build scalable payment systems.
Requirements: 5+ years with Python, React, AWS, Kubernetes, microservices, CI/CD, REST APIs, PostgreSQL.
You will mentor engineers, own system design, and improve reliability and observability.`;

module.exports = { persona, pastedResume, makeResumePdf, makePhotoPng, jobDescription, stamp };
