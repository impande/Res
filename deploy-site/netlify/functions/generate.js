exports.handler = async function(event) {
  // file:// pages send Origin: null — use * so browsers allow the response
  const reqOrigin = event.headers.origin || event.headers.Origin || '';
  const CORS = {
    'Access-Control-Allow-Origin': (reqOrigin && reqOrigin !== 'null') ? reqOrigin : '*',
    'Access-Control-Allow-Headers': 'Content-Type',
    'Access-Control-Allow-Methods': 'POST, OPTIONS',
  };

  if (event.httpMethod === 'OPTIONS') {
    return { statusCode: 204, headers: CORS, body: '' };
  }
  if (event.httpMethod !== 'POST') {
    return { statusCode: 405, headers: CORS, body: JSON.stringify({ error: 'Method not allowed' }) };
  }
  try {
    const body = JSON.parse(event.body || '{}');

    // ── Razorpay order creation ───────────────────────────────────────────────
    // UPI payments (incl. the desktop QR) only confirm — and only fire the checkout
    // success handler — when the checkout is opened with a server-created order_id.
    // Without this, a UPI/QR payment is taken but the handler never runs, so the PDF
    // never downloads. Card payments work either way; this makes UPI/QR work too.
    if (body.action === 'create-order') {
      const keyId = process.env.RAZORPAY_KEY_ID || 'rzp_live_Sy3fGr4R5rMKtx';
      const secret = process.env.RAZORPAY_KEY_SECRET;
      if (!secret) {
        // No secret configured — signal the client to fall back to the keyless flow
        // (card still works) rather than block the payment.
        return { statusCode: 501, headers: CORS, body: JSON.stringify({ error: 'RAZORPAY_KEY_SECRET not set' }) };
      }
      const amount = parseInt(body.amount, 10);
      const currency = (body.currency || 'INR').toUpperCase();
      if (!amount || amount < 1) {
        return { statusCode: 400, headers: CORS, body: JSON.stringify({ error: 'Invalid amount' }) };
      }
      const orderRes = await fetch('https://api.razorpay.com/v1/orders', {
        method: 'POST',
        headers: {
          'Authorization': 'Basic ' + Buffer.from(keyId + ':' + secret).toString('base64'),
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ amount, currency, payment_capture: 1 }),
      });
      const orderData = await orderRes.json();
      if (!orderRes.ok) {
        return { statusCode: orderRes.status, headers: CORS, body: JSON.stringify({ error: (orderData.error && orderData.error.description) || 'Order creation failed' }) };
      }
      return {
        statusCode: 200,
        headers: { ...CORS, 'Content-Type': 'application/json' },
        body: JSON.stringify({ id: orderData.id, amount: orderData.amount, currency: orderData.currency }),
      };
    }

    // ── PDF generation ────────────────────────────────────────────────────────
    if (body.action === 'generate-pdf') {
      const { html, filename } = body;
      if (!html) return { statusCode: 400, headers: CORS, body: JSON.stringify({ error: 'Missing html' }) };

      const apiKey = process.env.PDFSHIFT_API_KEY;
      if (!apiKey) {
        return {
          statusCode: 500,
          headers: CORS,
          body: JSON.stringify({ error: 'Add PDFSHIFT_API_KEY to your Netlify environment variables, then redeploy' }),
        };
      }

      // NOTE: we deliberately do NOT pass PDFShift's viewport `zoom`. It scales the
      // whole page and anchors top-left, which shrinks the résumé into the corner and
      // leaves lopsided margins (big right/bottom gap) — visibly different from the
      // preview. Text size is instead carried by the CSS `zoom` on the résumé wrapper
      // inside the cloned HTML (exactly what the on-screen preview uses), so the A4
      // page stays full and the side margins stay balanced and identical to the preview.

      const pdfRes = await fetch('https://api.pdfshift.io/v3/convert/pdf', {
        method: 'POST',
        headers: {
          'Authorization': 'Basic ' + btoa('api:' + apiKey),
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          source: html,
          format: 'A4',
          margin: { top: '0mm', right: '0mm', bottom: '0mm', left: '0mm' },
          use_print: false,
          sandbox: false,
          // Wait for the bundled @font-face webfonts to fetch + apply before PDFShift
          // captures, so server-side pagination matches the on-screen preview (Bug 2).
          // Without this, font-display:swap can capture the fallback and spill a page.
          delay: 2000,
        }),
      });

      if (!pdfRes.ok) {
        const errText = await pdfRes.text();
        throw new Error('PDFShift ' + pdfRes.status + ': ' + errText);
      }

      const pdfBuffer = await pdfRes.arrayBuffer();
      const safe = (filename || 'resume').replace(/[^\w\s\-]/g, '').trim() || 'resume';

      return {
        statusCode: 200,
        headers: {
          ...CORS,
          'Content-Type': 'application/pdf',
          'Content-Disposition': 'attachment; filename="' + safe + '.pdf"',
        },
        body: Buffer.from(pdfBuffer).toString('base64'),
        isBase64Encoded: true,
      };
    }

    // ── Portfolio customization (chat-driven) ─────────────────────────────────
    // Uses Sonnet (better reasoning + correct CSS) and returns a strict JSON config
    // the client applies to the live portfolio. The system prompt encodes the exact
    // DOM/variables + CSS recipes so even structural asks (two-column, recolour a
    // section) produce CSS that actually takes effect.
    if (body.action === 'customize') {
      const apiKey = process.env.ANTHROPIC_API_KEY;
      if (!apiKey) return { statusCode: 500, headers: CORS, body: JSON.stringify({ text: '', error: 'ANTHROPIC_API_KEY not set' }) };
      const current = body.current || {};
      const message = String(body.message || '').slice(0, 1000);
      const sys = [
        'You are a portfolio-website customization engine. You receive the current customization JSON and a plain-language request, and you return ONLY a JSON object that fully implements the request.',
        '',
        'The portfolio is ONE self-contained HTML page. It exposes these CSS variables you can override:',
        '--bg (page background), --card (card background), --ink (main text), --mut (muted text), --mut2 (faint text), --line (borders), --acc (accent/links/buttons), --acc-h (accent hover).',
        'Section container ids: #about, #links, #experience, #education, #projects, #certs, #skills, #awards, #contact.',
        'Key selectors: .col (the centered column; default max-width:720px; it is a vertical flex of cards), .pcard (profile header card), .banner (cover strip), .avatar, .pmain h1 (the name), .headline (job title), .card (every section card), .card-h h2 (a section heading), .sk (skill pill), .ent (an entry row), .btn-p (primary button), .link-row.',
        '',
        'Return a JSON object with keys:',
        '- accent: hex string (or null to clear) — sets the main accent colour.',
        '- dark: true/false — dark or light base.',
        '- template: "atelier" | "studio" | "nova" | "sidebar" | "minimal" | "bold" — the base page design. atelier = premium editorial: an elegant serif display face, huge type, very airy whitespace, refined borderless sections and smooth motion (the most upscale/designer look). studio = flagship: a huge statement hero, very large display type, generous whitespace, full-width cover image and smooth scroll animations (most premium/agency); nova = clean cards with a profile banner; sidebar = a sticky left profile rail with content on the right; minimal = a big centered name with borderless, editorial sections; bold = a full-width dark hero with very large type. Only set this if the user asks to change the overall template/layout style.',
        '- fonts: object {heading, body} — Google Font family names for headings and body text, chosen as a tasteful PAIRING that matches the requested vibe. Use ONLY these families (all load reliably): Sans — "Inter","DM Sans","Manrope","Work Sans","Poppins","Montserrat","Sora","Space Grotesk","Plus Jakarta Sans","Outfit","Figtree","Rubik","Karla","IBM Plex Sans","Albert Sans"; Serif/Display — "Playfair Display","Fraunces","Lora","Cormorant Garamond","Spectral","Source Serif 4","Bricolage Grotesque". A strong default is a characterful serif/display heading over a clean sans body (e.g. {"heading":"Fraunces","body":"Inter"}). Prefer this field over any @import in css. Omit or null to keep current fonts.',
        '- density: "compact" | "cozy" | "spacious" — overall spacing/whitespace.',
        '- width: "narrow" | "default" | "wide" — width of the centered content column.',
        '- radius: "sharp" | "soft" | "round" — corner roundness of cards/pills/images.',
        '- order: an array that reorders the page sections, using these keys: "about","links","experience","education","projects","certs","skills","awards","custom" (custom = all added blocks like hero/case studies). Include each key once; omit to keep the current order.',
        '- headings: object mapping a section id (without #) to a new title, e.g. {"experience":"Where I worked"}.',
        '- hide: array of section ids to hide, e.g. ["awards"].',
        '- css: a string of raw CSS that implements everything not covered by the fields above.',
        '- cta: object {text, target, position, bg, color} — adds ONE clickable call-to-action button that scrolls to a section. text = button label; target = a section id WITHOUT the # (e.g. "projects"); position = "top" (a full-width fixed bar at the top), "float" (a rounded button fixed at the bottom-right), or "hero" (a button just under the profile header); bg/color = optional CSS colours. The button is rendered by the app with a guaranteed-correct in-page link, so use THIS for any scroll CTA. Set cta to null to remove it. Honour the user\'s wishes for placement (top/float/hero) and colour.',
        '- injectHTML: a string of real HTML added at the top of the content column — only for custom NON-CTA markup. Do NOT include <script> or on* handlers (stripped). Any <a> must use href="#sectionId" or a full https:// URL — never "#", "/", "" or a relative path.',
        '- addBlocks: an array of NEW content blocks to append to the page. Each item is ONE of:',
        '    {"type":"hero","title":"Big headline","subtitle":"One punchy positioning line","align":"center","ctaText":"See my work","ctaLink":"projects"}   (a full-width hero banner; ctaLink is a URL or a section key like "projects"; the user adds a background image afterwards)',
        '    {"type":"project","title":"Project name","subtitle":"Role · Company · Year","body":"The problem, what you did, the result (use - for bullets)","tags":["Product","UX"],"link":"https://…","embed":"optional YouTube/Vimeo URL","layout":"split or stacked"}   (an image-led case study — the signature portfolio block; the user adds the images afterwards, never invent images or fake results)',
        '    {"type":"stats","title":"By the numbers","items":[{"value":"9+","label":"Years"}]}',
        '    {"type":"testimonials","title":"Testimonials","items":[{"quote":"…","author":"…","role":"…"}]}',
        '    {"type":"text","title":"…","body":"a paragraph, or lines starting with - for bullets"}',
        '    {"type":"gallery","title":"…"}   (the user uploads the images afterwards — never invent images)',
        '    {"type":"contact","title":"Get in touch","body":"optional intro line"}',
        '  Only add blocks the user asked for; omit addBlocks entirely otherwise.',
        '  NEVER invent fake testimonials, stats, names, or facts. Only include content the user actually provided in their message. If they ask for a testimonials or stats block but give no real content, add the block with an EMPTY items array (items: []) so they can fill it in themselves.',
        '- reply: ONE short, past-tense sentence describing what you changed.',
        '',
        'IMPORTANT — interactive elements:',
        '- CSS cannot create clickable elements or scrolling; never use a ::before/::after pseudo-element for a CTA (not clickable).',
        '- For ANY call-to-action / button / banner that scrolls to a section, ALWAYS use the cta field (never css or injectHTML). It is the only reliable, safe way.',
        '',
        'CRITICAL rules for the css field so changes actually take effect:',
        '1. Add !important to EVERY property (the base stylesheet is specific).',
        '2. To recolour a whole section use: #ID, #ID *{color:VALUE!important} (target descendants too).',
        '3. To change a section background use: #ID{background:VALUE!important}.',
        '4. To recolour only a heading: #ID .card-h h2{color:VALUE!important}.',
        '5. Two-column / side-by-side layout: @media(min-width:760px){.col{max-width:1060px!important;display:grid!important;grid-template-columns:1fr 1fr!important;gap:14px!important;align-items:start!important}.pcard{grid-column:1/-1!important}} then, to place specific sections, add #about{grid-column:1!important} #projects{grid-column:2!important} etc.',
        '6. Fonts: prefer the structured "fonts" field above; only fall back to css @import url(...) for a font not in the curated list.',
        '7. Bigger name: .pmain h1{font-size:2.4rem!important}.',
        '',
        'ALWAYS merge with the current customization: keep prior changes unless this request overrides them, and return the FULL cumulative css every time (re-emit previous css plus the new rules). Output valid JSON only — no markdown, no prose outside the JSON.'
      ].join('\n');
      const reqBody = {
        model: 'claude-sonnet-4-6',
        max_tokens: 4096,
        system: sys,
        messages: [{ role: 'user', content: 'Current customization JSON:\n' + JSON.stringify(current) + '\n\nRequest: ' + message }]
      };
      const cr = await fetch('https://api.anthropic.com/v1/messages', {
        method: 'POST',
        headers: { 'x-api-key': apiKey, 'anthropic-version': '2023-06-01', 'content-type': 'application/json' },
        body: JSON.stringify(reqBody)
      });
      const cd = await cr.json();
      if (!cr.ok) return { statusCode: cr.status, headers: CORS, body: JSON.stringify({ text: '', error: cd.error?.message || 'API error' }) };
      return { statusCode: 200, headers: { ...CORS, 'Content-Type': 'application/json' }, body: JSON.stringify({ text: cd.content?.[0]?.text || '' }) };
    }

    // ── Claude AI (resume generation / parsing) ───────────────────────────────
    const { prompt, imageBase64, imageBase64Array, imageMimeType } = body;
    // imageBase64Array: array of pages (multi-page scanned PDF)
    // imageBase64: single image (backward compat)
    const images = imageBase64Array || (imageBase64 ? [imageBase64] : []);
    if (!prompt && !images.length) {
      return { statusCode: 400, headers: CORS, body: JSON.stringify({ text: '', error: 'Missing prompt' }) };
    }

    const apiKey = process.env.ANTHROPIC_API_KEY;
    if (!apiKey) {
      return { statusCode: 500, headers: CORS, body: JSON.stringify({ text: '', error: 'Add ANTHROPIC_API_KEY to your Netlify environment variables, then redeploy' }) };
    }

    // Vision path: use Sonnet for better image reading accuracy
    // Text path:   use Haiku for speed and cost efficiency
    const model = images.length ? 'claude-sonnet-4-6' : 'claude-haiku-4-5-20251001';

    const requestBody = { model, max_tokens: 8192 };

    if (images.length) {
      const mimeType = imageMimeType || 'image/jpeg';
      requestBody.messages = [{
        role: 'user',
        content: [
          // All pages as separate image blocks
          ...images.map(b64 => ({
            type: 'image',
            source: { type: 'base64', media_type: mimeType, data: b64 }
          })),
          {
            type: 'text',
            text: prompt || 'Extract all resume data from this image as JSON.'
          }
        ]
      }];
    } else {
      const isParseTask = prompt && (prompt.includes('Parse resume') || prompt.includes('Extract') || prompt.includes('JSON object'));
      requestBody.system = isParseTask
        ? 'You are a precise data extraction assistant. When given a resume, extract all information faithfully into the requested JSON structure. Never invent or omit data. Output valid JSON only.'
        : 'You are an expert resume writer who creates ATS-optimised, professional resumes. Write in clear, action-oriented language with quantified achievements where possible. Output plain text without markdown formatting.';
      requestBody.messages = [{ role: 'user', content: prompt }];
    }

    const response = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'x-api-key': apiKey,
        'anthropic-version': '2023-06-01',
        'content-type': 'application/json'
      },
      body: JSON.stringify(requestBody)
    });

    const data = await response.json();
    if (!response.ok) {
      return { statusCode: response.status, headers: CORS, body: JSON.stringify({ text: '', error: data.error?.message || 'API error' }) };
    }

    const text = data.content?.[0]?.text;
    // Return only `text` (a plain string). Every client reader falls back to `text`,
    // so this one shape works for all of them. Do NOT also return a `content` field:
    // some callers read `(content || text).trim()` / `_extractJSON(content || text)`
    // (which throw on a non-string) while others read `content[0].text` (which needs an
    // array) — no single `content` shape satisfies both, so we omit it entirely and let
    // every caller use `text`.
    return { statusCode: 200, headers: { ...CORS, 'Content-Type': 'application/json' }, body: JSON.stringify({ text }) };
  } catch (err) {
    return { statusCode: 500, headers: CORS, body: JSON.stringify({ text: '', error: err.message }) };
  }
}
