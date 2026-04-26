// Netlify serverless function — POST /api/chat
// Scenario mode chat. Stays sync since responses are short.

export default async (req) => {
  if (req.method !== 'POST') {
    return new Response(JSON.stringify({ error: 'Method not allowed' }), {
      status: 405, headers: { 'Content-Type': 'application/json' }
    });
  }

  const apiKey = Netlify.env.get('ANTHROPIC_API_KEY');
  if (!apiKey) {
    return new Response(JSON.stringify({ error: 'Server misconfiguration' }), {
      status: 500, headers: { 'Content-Type': 'application/json' }
    });
  }

  try {
    const { messages, audit, formData } = await req.json();

    if (!messages || !Array.isArray(messages)) {
      return new Response(JSON.stringify({ error: 'Invalid request' }), {
        status: 400, headers: { 'Content-Type': 'application/json' }
      });
    }

    const systemCtx = `You are a senior CPG brand strategist. The user has completed a brand audit and is now stress-testing strategic scenarios.

BRAND: ${formData?.product_name || 'Unknown'}
FULL AUDIT: ${JSON.stringify(audit)}
BRAND INPUTS: ${JSON.stringify(formData)}

Be direct, specific, and honest. Use the audit data as your foundation. Every recommendation must be calibrated to this brand's actual stage, budget, and constraints. Avoid generic advice — give the sharp, practitioner answer. Keep responses focused — 2 to 4 paragraphs max.`;

    const apiRes = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': apiKey,
        'anthropic-version': '2023-06-01'
      },
      body: JSON.stringify({
        model: 'claude-haiku-4-5-20251001',
        max_tokens: 1200,
        system: systemCtx,
        messages: messages
      })
    });

    if (!apiRes.ok) {
      return new Response(JSON.stringify({ error: 'Anthropic API error' }), {
        status: 502, headers: { 'Content-Type': 'application/json' }
      });
    }

    const data = await apiRes.json();
    const reply = data.content[0].text;

    return new Response(JSON.stringify({ reply }), {
      status: 200, headers: { 'Content-Type': 'application/json' }
    });

  } catch (err) {
    return new Response(JSON.stringify({
      error: 'Chat failed',
      message: err.message || 'Unknown error'
    }), { status: 500, headers: { 'Content-Type': 'application/json' } });
  }
};

export const config = {
  path: '/api/chat'
};
