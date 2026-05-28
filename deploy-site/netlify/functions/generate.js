export async function handler(event) {
  if (event.httpMethod !== 'POST') {
    return { statusCode: 405, body: JSON.stringify({ error: 'Method not allowed' }) };
  }
  try {
    const { prompt, imageBase64, imageMimeType } = JSON.parse(event.body || '{}');
    if (!prompt && !imageBase64) {
      return { statusCode: 400, body: JSON.stringify({ error: 'Missing prompt' }) };
    }

    const apiKey = process.env.GROQ_API_KEY;
    let model, messages;

    if (imageBase64) {
      model = 'llama-3.2-11b-vision-preview';
      messages = [{
        role: 'user',
        content: [
          { type: 'text', text: prompt || 'Extract all resume data from this image as JSON.' },
          { type: 'image_url', image_url: { url: `data:${imageMimeType || 'image/jpeg'};base64,${imageBase64}` } }
        ]
      }];
    } else {
      model = 'llama-3.3-70b-versatile';
      messages = [
        { role: 'system', content: 'You are an expert resume writer who creates ATS-optimised, professional resumes. Write in clear, action-oriented language with quantified achievements where possible. Output plain text without markdown formatting.' },
        { role: 'user', content: prompt }
      ];
    }

    const response = await fetch('https://api.groq.com/openai/v1/chat/completions', {
      method: 'POST',
      headers: { 'Authorization': `Bearer ${apiKey}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ model, messages, temperature: imageBase64 ? 0.2 : 0.7, max_tokens: 2048 })
    });

    const data = await response.json();
    if (!response.ok) {
      return { statusCode: response.status, body: JSON.stringify({ error: data.error?.message || 'API error' }) };
    }

    const text = data.choices?.[0]?.message?.content;
    return { statusCode: 200, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ text }) };
  } catch (err) {
    return { statusCode: 500, body: JSON.stringify({ error: err.message }) };
  }
}
