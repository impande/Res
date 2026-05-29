export async function handler(event) {
  if (event.httpMethod !== 'POST') {
    return { statusCode: 405, body: JSON.stringify({ error: 'Method not allowed' }) };
  }
  try {
    const { prompt, imageBase64, imageMimeType } = JSON.parse(event.body || '{}');
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
      // Claude API takes system as a top-level field, not inside messages
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
