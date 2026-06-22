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

    // ── Claude AI (resume generation / parsing) ───────────────────────────────
    const { prompt, imageBase64, imageBase64Array, imageMimeType } = body;
    // imageBase64Array: array of pages (multi-page scanned PDF)
    // imageBase64: single image (backward compat)
    const images = imageBase64Array || (imageBase64 ? [imageBase64] : []);
    if (!prompt && !images.length) {
      return { statusCode: 400, headers: CORS, body: JSON.stringify({ error: 'Missing prompt' }) };
    }

    const apiKey = process.env.ANTHROPIC_API_KEY;
    if (!apiKey) {
      return { statusCode: 500, headers: CORS, body: JSON.stringify({ error: 'Add ANTHROPIC_API_KEY to your Netlify environment variables, then redeploy' }) };
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
      return { statusCode: response.status, headers: CORS, body: JSON.stringify({ error: data.error?.message || 'API error' }) };
    }

    const text = data.content?.[0]?.text;
    return { statusCode: 200, headers: { ...CORS, 'Content-Type': 'application/json' }, body: JSON.stringify({ text }) };
  } catch (err) {
    return { statusCode: 500, headers: CORS, body: JSON.stringify({ error: err.message }) };
  }
}
