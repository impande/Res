#!/usr/bin/env python3
# Generates role-specific "Resume Example" landing pages under deploy-site/examples/<slug>/
# Each page: hero + real sample resume + "what to include" + "top skills" + features + steps
# + FAQ (with FAQPage JSON-LD) + internal cross-links + CTA. Rich, unique content per role.
import os, html, json

ROOT = os.path.join(os.path.dirname(__file__), '..', 'deploy-site')
EXAMPLES = os.path.join(ROOT, 'examples')

# Roles already present (link to them, don't overwrite)
ALL_SLUGS = [
    ('software-engineer', 'Software Engineer'),
    ('data-analyst', 'Data Analyst'),
    ('business-analyst', 'Business Analyst'),
    ('accountant', 'Accountant'),
    ('digital-marketing', 'Digital Marketing'),
    ('sales-executive', 'Sales Executive'),
    ('human-resources', 'HR Manager'),
    ('mechanical-engineer', 'Mechanical Engineer'),
    ('graphic-designer', 'Graphic Designer'),
]

def esc(s): return html.escape(s, quote=True)

def page(role):
    slug = role['slug']; title = role['title']; badge = role['badge']
    person = role['person']
    # related links: 3 other examples + 2 core landing pages
    others = [(s,t) for s,t in ALL_SLUGS if s != slug][:5]
    related = ''.join(
        f'<a class="rel-link" href="/examples/{s}">{esc(t)} Resume Example</a>' for s,t in others[:4]
    )
    related += '<a class="rel-link" href="/ats-resume-builder-india/">ATS Resume Builder</a>'
    related += '<a class="rel-link" href="/resume-templates/">Resume Templates</a>'

    jobs_html = ''
    for j in person['jobs']:
        bl = ''.join(f'<li>{esc(b)}</li>' for b in j['bullets'])
        jobs_html += (
            f'<div class="rc-job"><div><span class="rc-job-title">{esc(j["title"])}</span>'
            f'<span class="rc-job-date">{esc(j["date"])}</span></div>'
            f'<div class="rc-job-co">{esc(j["co"])}</div>'
            f'<ul class="rc-bullets">{bl}</ul></div>'
        )
    skills_html = ''.join(f'<span class="rc-skill">{esc(s)}</span>' for s in person['skills'])

    include_html = ''.join(
        f'<li><strong>{esc(k)}</strong> — {esc(v)}</li>' for k,v in role['include']
    )
    topskills_chips = ''.join(f'<span class="ts-chip">{esc(s)}</span>' for s in role['topskills'])

    faq_html = ''
    faq_ld = []
    for q,a in role['faq']:
        faq_html += f'<div class="faq-item"><h3>{esc(q)}</h3><p>{esc(a)}</p></div>'
        faq_ld.append({"@type":"Question","name":q,
                       "acceptedAnswer":{"@type":"Answer","text":a}})

    ld = {
        "@context":"https://schema.org",
        "@graph":[
            {"@type":"WebPage","name":f"{title} Resume Example",
             "url":f"https://resume4u.help/examples/{slug}",
             "description":role['meta'],
             "isPartOf":{"@type":"WebSite","name":"Resume For You","url":"https://resume4u.help"}},
            {"@type":"FAQPage","mainEntity":faq_ld},
        ]
    }
    ld_json = json.dumps(ld, ensure_ascii=False)

    return f'''<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>{esc(title)} Resume Example (2026) | Free AI Builder – resume4u.help</title>
  <meta name="description" content="{esc(role['meta'])}">
  <meta name="robots" content="index, follow">
  <link rel="canonical" href="https://resume4u.help/examples/{slug}">
  <meta property="og:type" content="website">
  <meta property="og:url" content="https://resume4u.help/examples/{slug}">
  <meta property="og:title" content="{esc(title)} Resume Example – Free AI Builder">
  <meta property="og:description" content="{esc(role['og'])}">
  <meta property="og:image" content="https://resume4u.help/og-image.png">
  <meta name="twitter:card" content="summary_large_image">
  <meta name="twitter:title" content="{esc(title)} Resume Example – Free AI Builder">
  <meta name="twitter:description" content="{esc(role['og'])}">
  <meta name="twitter:image" content="https://resume4u.help/og-image.png">
  <script type="application/ld+json">{ld_json}</script>
  <style>
    *{{box-sizing:border-box;margin:0;padding:0}}
    body{{font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;background:#0f0f1a;color:#e8e8ff;min-height:100vh;line-height:1.6}}
    a{{color:#f59e0b;text-decoration:none}} a:hover{{text-decoration:underline}}
    nav{{background:#12121e;border-bottom:1px solid #1e1e3a;padding:0 24px;display:flex;align-items:center;justify-content:space-between;height:56px}}
    .logo{{font-weight:700;font-size:1.1rem;color:#f59e0b}}
    .nav-cta{{background:#f59e0b;color:#0f0f1a;padding:8px 18px;border-radius:8px;font-weight:600;font-size:.9rem}}
    .nav-cta:hover{{background:#d97706;text-decoration:none}}
    .hero{{text-align:center;padding:60px 24px 20px;max-width:780px;margin:0 auto}}
    .badge{{display:inline-block;background:#1e1e3a;color:#f59e0b;padding:4px 14px;border-radius:20px;font-size:.8rem;font-weight:600;letter-spacing:.05em;margin-bottom:20px}}
    h1{{font-size:clamp(1.9rem,5vw,2.8rem);font-weight:800;line-height:1.15;margin-bottom:16px}}
    h1 span{{color:#f59e0b}}
    .hero p{{font-size:1.08rem;color:#a0a0c0;max-width:600px;margin:0 auto 28px}}
    .cta-btn{{display:inline-block;background:#22c55e;color:#fff;padding:14px 32px;border-radius:10px;font-weight:700;font-size:1.05rem;transition:background .2s}}
    .cta-btn:hover{{background:#16a34a;text-decoration:none}}
    .intro{{max-width:720px;margin:0 auto 40px;padding:0 24px;color:#b6b6d4;font-size:1rem}}
    .intro p{{margin-bottom:12px}}
    .preview-wrap{{max-width:680px;margin:0 auto 56px;padding:0 24px}}
    .resume-card{{background:#fff;color:#111;border-radius:12px;padding:32px;box-shadow:0 8px 48px rgba(0,0,0,.4);font-size:.82rem;line-height:1.55}}
    .rc-name{{font-size:1.4rem;font-weight:800;color:#1a1a2e;margin-bottom:2px}}
    .rc-title{{font-size:.9rem;color:#f59e0b;font-weight:600;text-transform:uppercase;letter-spacing:.06em;margin-bottom:6px}}
    .rc-contact{{color:#555;font-size:.78rem;margin-bottom:18px}}
    .rc-section{{margin-bottom:18px}}
    .rc-section-title{{font-size:.7rem;font-weight:700;text-transform:uppercase;letter-spacing:.1em;color:#888;border-bottom:1px solid #e5e7eb;padding-bottom:4px;margin-bottom:10px}}
    .rc-summary{{color:#333;margin-bottom:0}}
    .rc-job{{margin-bottom:12px}}
    .rc-job-title{{font-weight:700;color:#1a1a2e}}
    .rc-job-co{{color:#f59e0b;font-weight:600;font-size:.8rem}}
    .rc-job-date{{color:#888;float:right;font-size:.75rem}}
    .rc-bullets{{padding-left:16px;color:#333;margin-top:4px}} .rc-bullets li{{margin-bottom:3px}}
    .rc-skills{{display:flex;flex-wrap:wrap;gap:6px}}
    .rc-skill{{background:#f3f4f6;border-radius:4px;padding:2px 8px;font-size:.75rem;color:#374151}}
    .ats-badge{{display:inline-flex;align-items:center;gap:6px;background:#f0fdf4;border:1px solid #bbf7d0;border-radius:6px;padding:6px 12px;font-size:.78rem;color:#15803d;font-weight:600;margin-top:14px}}
    .sec{{max-width:820px;margin:0 auto 56px;padding:0 24px}}
    .sec h2{{font-size:1.5rem;margin-bottom:18px;text-align:center}}
    .inc-list{{list-style:none;display:grid;gap:12px}}
    .inc-list li{{background:#12121e;border:1px solid #1e1e3a;border-radius:10px;padding:14px 18px;font-size:.92rem;color:#c7c7e0}}
    .inc-list strong{{color:#fff}}
    .ts-wrap{{display:flex;flex-wrap:wrap;gap:8px;justify-content:center;margin-top:14px}}
    .ts-chip{{background:#1e1e3a;color:#e8e8ff;border-radius:20px;padding:6px 14px;font-size:.85rem}}
    .features{{max-width:900px;margin:0 auto 56px;padding:0 24px}}
    .features h2{{text-align:center;font-size:1.5rem;margin-bottom:28px}}
    .feat-grid{{display:grid;grid-template-columns:repeat(auto-fit,minmax(240px,1fr));gap:20px}}
    .feat-card{{background:#12121e;border:1px solid #1e1e3a;border-radius:12px;padding:24px}}
    .feat-icon{{font-size:1.6rem;margin-bottom:10px}}
    .feat-card h3{{font-size:1rem;font-weight:700;margin-bottom:6px}}
    .feat-card p{{font-size:.85rem;color:#a0a0c0;line-height:1.5}}
    .steps{{max-width:700px;margin:0 auto 56px;padding:0 24px;text-align:center}}
    .steps h2{{font-size:1.5rem;margin-bottom:28px}}
    .step-list{{display:flex;flex-direction:column;gap:14px;text-align:left}}
    .step{{display:flex;gap:16px;align-items:flex-start;background:#12121e;border:1px solid #1e1e3a;border-radius:10px;padding:18px}}
    .step-num{{background:#f59e0b;color:#0f0f1a;width:28px;height:28px;border-radius:50%;display:flex;align-items:center;justify-content:center;font-weight:800;font-size:.85rem;flex-shrink:0;margin-top:1px}}
    .step h3{{font-size:.95rem;font-weight:700;margin-bottom:3px}}
    .step p{{font-size:.83rem;color:#a0a0c0}}
    .faq-item{{background:#12121e;border:1px solid #1e1e3a;border-radius:10px;padding:16px 18px;margin-bottom:12px}}
    .faq-item h3{{font-size:.98rem;font-weight:700;margin-bottom:6px;color:#fff}}
    .faq-item p{{font-size:.88rem;color:#a0a0c0}}
    .rel-wrap{{display:flex;flex-wrap:wrap;gap:10px;justify-content:center;margin-top:10px}}
    .rel-link{{background:#12121e;border:1px solid #1e1e3a;border-radius:8px;padding:9px 15px;font-size:.85rem;color:#e8e8ff;font-weight:600}}
    .rel-link:hover{{border-color:#f59e0b;text-decoration:none}}
    .bottom-cta{{text-align:center;padding:48px 24px 72px;background:#12121e;border-top:1px solid #1e1e3a}}
    .bottom-cta h2{{font-size:1.7rem;margin-bottom:12px}}
    .bottom-cta p{{color:#a0a0c0;margin-bottom:26px}}
    .r4u-lfoot{{background:#0a0a14;color:#cfcfe0;padding:34px 24px;text-align:center;border-top:1px solid #1e1e3a}}
    .r4u-lfoot .r4u-lfoot-links{{display:flex;flex-wrap:wrap;gap:10px 22px;justify-content:center;margin:0 0 12px}}
    .r4u-lfoot .r4u-lfoot-links a{{color:#c7c7e0;text-decoration:none;font-size:.85rem;font-weight:600}}
    .r4u-lfoot .r4u-lfoot-links a:hover{{color:#fbbf24}}
    .r4u-lfoot .r4u-lfoot-copy{{font-size:.8rem;color:#6b6b8a;margin:0}}
  </style>
</head>
<body>
<nav>
  <a class="logo" href="/">resume4u.help</a>
  <a class="nav-cta" href="/">Build My Resume Free →</a>
</nav>

<section class="hero">
  <div class="badge">{esc(badge)} RESUME EXAMPLE</div>
  <h1>{esc(role['h1a'])}<br><span>{esc(role['h1b'])}</span></h1>
  <p>{esc(role['hero'])}</p>
  <a class="cta-btn" href="/">Create My Resume Free →</a>
</section>

<div class="intro">
  <p>{esc(role['intro1'])}</p>
  <p>{esc(role['intro2'])}</p>
</div>

<div class="preview-wrap">
  <div class="resume-card">
    <div class="rc-name">{esc(person['name'])}</div>
    <div class="rc-title">{esc(person['title'])}</div>
    <div class="rc-contact">{esc(person['contact'])}</div>
    <div class="rc-section">
      <div class="rc-section-title">Professional Summary</div>
      <p class="rc-summary">{esc(person['summary'])}</p>
    </div>
    <div class="rc-section">
      <div class="rc-section-title">Experience</div>
      {jobs_html}
    </div>
    <div class="rc-section">
      <div class="rc-section-title">Skills</div>
      <div class="rc-skills">{skills_html}</div>
    </div>
    <div class="rc-section">
      <div class="rc-section-title">Education</div>
      <div><span class="rc-job-title">{esc(person['edu'])}</span> <span style="float:right;color:#888;font-size:.75rem">{esc(person['eduyear'])}</span></div>
      <div class="rc-job-co">{esc(person['eduschool'])}</div>
    </div>
    <div class="ats-badge">✅ ATS Score: {person['ats']}/100 — Optimised for applicant tracking systems</div>
  </div>
</div>

<section class="sec">
  <h2>What to include in a {esc(title.lower())} resume</h2>
  <ul class="inc-list">{include_html}</ul>
</section>

<section class="sec">
  <h2>Top skills for a {esc(title.lower())} resume</h2>
  <p style="text-align:center;color:#a0a0c0">{esc(role['skills_intro'])}</p>
  <div class="ts-wrap">{topskills_chips}</div>
</section>

<section class="features">
  <h2>Why {esc(role['plural'])} choose resume4u.help</h2>
  <div class="feat-grid">
    <div class="feat-card"><div class="feat-icon">🤖</div><h3>AI writes the content</h3><p>Paste your experience and AI generates ATS-optimised, quantified bullet points tailored to {esc(title.lower())} roles.</p></div>
    <div class="feat-card"><div class="feat-icon">📄</div><h3>Import your old resume</h3><p>Drop a PDF, DOCX, or a photo of your existing resume — AI extracts everything instantly.</p></div>
    <div class="feat-card"><div class="feat-icon">🎯</div><h3>Live ATS score</h3><p>See your ATS score in real time with specific fixes so your resume passes Naukri, LinkedIn and company screening.</p></div>
    <div class="feat-card"><div class="feat-icon">🎨</div><h3>50+ templates</h3><p>Modern, classic and creative templates built to pass ATS and impress recruiters.</p></div>
  </div>
</section>

<section class="steps">
  <h2>Build yours in 3 steps</h2>
  <div class="step-list">
    <div class="step"><div class="step-num">1</div><div><h3>Upload or paste your details</h3><p>Any format works — PDF, DOCX, TXT or a photo. AI reads and imports everything.</p></div></div>
    <div class="step"><div class="step-num">2</div><div><h3>Let AI enhance the content</h3><p>One click rewrites your bullets into action-oriented, quantified achievements that beat ATS filters.</p></div></div>
    <div class="step"><div class="step-num">3</div><div><h3>Pick a template and download</h3><p>Choose from 50+ templates, preview instantly, and download a clean PDF.</p></div></div>
  </div>
</section>

<section class="sec">
  <h2>Frequently asked questions</h2>
  {faq_html}
</section>

<section class="sec">
  <h2>Related resume examples &amp; tools</h2>
  <div class="rel-wrap">{related}</div>
</section>

<section class="bottom-cta">
  <h2>Your {esc(title.lower())} resume, ready in minutes</h2>
  <p>Free to build. No sign-up required. PDF download from ₹9.</p>
  <a class="cta-btn" href="/">Start Building for Free →</a>
</section>

<footer class="r4u-lfoot">
  <nav class="r4u-lfoot-links" aria-label="Footer">
    <a href="/">Home</a>
    <a href="/resume-templates/">Templates</a>
    <a href="/ats-resume-builder-india/">ATS Builder</a>
    <a href="/privacy/">Privacy</a>
    <a href="/terms/">Terms</a>
    <a href="/refund/">Refund</a>
    <a href="https://wa.me/919309014196" target="_blank" rel="noopener">Contact</a>
  </nav>
  <p class="r4u-lfoot-copy">&copy; 2026 Resume For You &middot; resume4u.help &middot; Made in India</p>
</footer>
</body>
</html>
'''

# ---- role data is loaded from gen_examples_data.py ----
if __name__ == '__main__':
    import gen_examples_data as D
    written = []
    for role in D.ROLES:
        d = os.path.join(EXAMPLES, role['slug'])
        os.makedirs(d, exist_ok=True)
        with open(os.path.join(d, 'index.html'), 'w', encoding='utf-8') as f:
            f.write(page(role))
        written.append(role['slug'])
    print('wrote', len(written), 'pages:', ', '.join(written))
