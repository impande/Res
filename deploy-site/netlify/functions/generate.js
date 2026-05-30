export async function handler(event) {
  if (event.httpMethod !== 'POST') {
    return { statusCode: 405, body: JSON.stringify({ error: 'Method not allowed' }) };
  }
  try {
    const body = JSON.parse(event.body || '{}');

    // ── PDF generation ────────────────────────────────────────────────────────
    if (body.action === 'generate-pdf') {
      const { html, filename } = body;
      if (!html) return { statusCode: 400, body: JSON.stringify({ error: 'Missing html' }) };

      const apiKey = process.env.PDFSHIFT_API_KEY;
      if (!apiKey) {
        return {
          statusCode: 500,
          body: JSON.stringify({ error: 'Add PDFSHIFT_API_KEY to your Netlify environment variables, then redeploy' }),
        };
      }

      const pdfRes = await fetch('https://api.pdfshift.io/v3/convert/html', {
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

      const uint8 = new Uint8Array(pdfBuffer);
      let binary = '';
      for (let i = 0; i < uint8.length; i++) { binary += String.fromCharCode(uint8[i]); }

      return {
        statusCode: 200,
        headers: {
          'Content-Type': 'application/pdf',
          'Content-Disposition': 'attachment; filename="' + safe + '.pdf"',
        },
        body: btoa(binary),
        isBase64Encoded: true,
      };
    }

    // ── Claude AI (resume generation / image extraction) ──────────────────────
    const { prompt, imageBase64, imageMimeType } = body;
    if (!prompt && !imageBase64) {
      return { statusCode: 400, body: JSON.stringify({ error: 'Missing prompt' }) };
    }

    const apiKey = process.env.ANTHROPIC_API_KEY;

    // Vision path: use Sonnet for better image reading accuracy
    // Text path:   use Haiku for speed and cost efficiency
    const model = imageBase64 ? 'claude-sonnet-4-6' : 'claude-haiku-4-5-20251001';

    const requestBody = { model, max_tokens: 4096 };

    if (imageBase64) {
      requestBody.messages = [{
        role: 'user',
        content: [
          {
            type: 'image',
            source: {
              type: 'base64',
              media_type: imageMimeType || 'image/jpeg',
              data: imageBase64
            }
          },
          {
            type: 'text',
            text: prompt || 'Extract all resume data from this image as JSON.'
          }
        ]
      }];
    } else {
      requestBody.system = 'You are an expert resume writer who creates ATS-optimised, professional resumes. Write in clear, action-oriented language with quantified achievements where possible. Output plain text without markdown formatting.';
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
      return { statusCode: response.status, body: JSON.stringify({ error: data.error?.message || 'API error' }) };
    }

    const text = data.content?.[0]?.text;
    return { statusCode: 200, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ text }) };
  } catch (err) {
    return { statusCode: 500, body: JSON.stringify({ error: err.message }) };
  }
}
