export async function handler(event) {
  if (event.httpMethod === 'OPTIONS') {
    return {
      statusCode: 204,
      headers: {
        'Access-Control-Allow-Origin': '*',
        'Access-Control-Allow-Methods': 'POST, OPTIONS',
        'Access-Control-Allow-Headers': 'Content-Type',
      },
      body: '',
    };
  }

  if (event.httpMethod !== 'POST') {
    return { statusCode: 405, body: 'Method not allowed' };
  }

  try {
    const { html, filename } = JSON.parse(event.body || '{}');
    if (!html) {
      return { statusCode: 400, body: JSON.stringify({ error: 'Missing html' }) };
    }

    const apiKey = process.env.PDFSHIFT_API_KEY;
    if (!apiKey) {
      return {
        statusCode: 500,
        body: JSON.stringify({ error: 'PDF service not configured — add PDFSHIFT_API_KEY to Netlify environment variables' }),
      };
    }

    // PDFShift uses headless Chrome server-side — perfect PDF, no URL/date
    const response = await fetch('https://api.pdfshift.io/v3/convert/html', {
      method: 'POST',
      headers: {
        'Authorization': 'Basic ' + Buffer.from('api:' + apiKey).toString('base64'),
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

    if (!response.ok) {
      const errText = await response.text();
      throw new Error('PDFShift ' + response.status + ': ' + errText);
    }

    const pdfBuffer = await response.arrayBuffer();
    const safe = (filename || 'resume').replace(/[^\w\s\-]/g, '').trim() || 'resume';

    return {
      statusCode: 200,
      headers: {
        'Content-Type': 'application/pdf',
        'Content-Disposition': 'attachment; filename="' + safe + '.pdf"',
        'Access-Control-Allow-Origin': '*',
      },
      body: Buffer.from(pdfBuffer).toString('base64'),
      isBase64Encoded: true,
    };
  } catch (err) {
    console.error('[generate-pdf]', err.message);
    return {
      statusCode: 500,
      headers: { 'Access-Control-Allow-Origin': '*' },
      body: JSON.stringify({ error: 'PDF generation failed', details: err.message }),
    };
  }
}
