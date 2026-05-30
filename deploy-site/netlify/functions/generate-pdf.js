import chromium from '@sparticuz/chromium';
import puppeteer from 'puppeteer-core';

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

  let browser;
  try {
    const { html, filename } = JSON.parse(event.body || '{}');
    if (!html) {
      return { statusCode: 400, body: JSON.stringify({ error: 'Missing html' }) };
    }

    browser = await puppeteer.launch({
      args: chromium.args,
      defaultViewport: { width: 794, height: 1123, deviceScaleFactor: 1 },
      executablePath: await chromium.executablePath(),
      headless: chromium.headless,
    });

    const page = await browser.newPage();

    // networkidle2: wait until ≤2 network requests for 500ms — handles Google Fonts
    await page.setContent(html, { waitUntil: ['domcontentloaded', 'networkidle2'], timeout: 18000 });

    // Extra pause for font rendering to settle
    await new Promise(r => setTimeout(r, 600));

    const pdfBuffer = await page.pdf({
      format: 'A4',
      printBackground: true,
      displayHeaderFooter: false,
      margin: { top: 0, right: 0, bottom: 0, left: 0 },
    });

    await browser.close();
    browser = null;

    const safe = (filename || 'resume').replace(/[^\w\s\-]/g, '').trim() || 'resume';

    return {
      statusCode: 200,
      headers: {
        'Content-Type': 'application/pdf',
        'Content-Disposition': `attachment; filename="${safe}.pdf"`,
        'Access-Control-Allow-Origin': '*',
      },
      body: Buffer.from(pdfBuffer).toString('base64'),
      isBase64Encoded: true,
    };
  } catch (err) {
    if (browser) await browser.close().catch(() => {});
    console.error('[generate-pdf]', err.message);
    return {
      statusCode: 500,
      headers: { 'Access-Control-Allow-Origin': '*' },
      body: JSON.stringify({ error: 'PDF generation failed', details: err.message }),
    };
  }
}
