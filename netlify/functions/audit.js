// Netlify serverless function — POST /api/audit
// Uses streaming to avoid Netlify's 30-second function timeout.

const RATE_LIMIT = 2;
const WINDOW_MS = 24 * 60 * 60 * 1000;
const rateLimitStore = new Map();

function checkRateLimit(ip) {
  const now = Date.now();
  const record = rateLimitStore.get(ip) || { count: 0, resetAt: now + WINDOW_MS };
  if (now > record.resetAt) {
    record.count = 0;
    record.resetAt = now + WINDOW_MS;
  }
  if (record.count >= RATE_LIMIT) {
    const hoursLeft = Math.ceil((record.resetAt - now) / (60 * 60 * 1000));
    return { allowed: false, hoursLeft };
  }
  record.count += 1;
  rateLimitStore.set(ip, record);
  return { allowed: true, remaining: RATE_LIMIT - record.count };
}

function buildPrompt(f) {
  return `You are a senior CPG brand strategist. Run a rigorous brand audit weighted heavily toward competitive landscape.

INPUT:
Product: ${f.product_name || 'N/A'} | ${f.category || ''} - ${f.subcategory || ''}
Format: ${f.format || ''} | Price: ${f.retail_price || ''}
Target: ${f.target_consumer || 'N/A'}
Promise: ${f.brand_promise || 'N/A'}
Tier: ${f.price_tier || ''} | Driver: ${f.purchase_driver || ''}
Differentiation: ${f.differentiation || ''}

COMPETITORS:
1. ${f.c1_name || ''} (${f.c1_pos || ''}): ${f.c1_threat || ''}
2. ${f.c2_name || ''} (${f.c2_pos || ''}): ${f.c2_threat || ''}
3. ${f.c3_name || ''} (${f.c3_pos || ''}): ${f.c3_threat || ''}
Context: ${f.comp_context || ''}

MARKET: ${f.geography || ''} | ${f.dist_stage || ''} | Channels: ${f.channels || ''} | Footprint: ${f.footprint || ''}

STAGE: ${f.brand_stage || ''} | Team: ${f.team_size || ''} | Funding: ${f.funding || ''} | Budget: ${f.mktg_budget || ''}
Marketing: ${f.mktg_channels || ''}

FINANCIAL: COGS ${f.cogs || ''} | Margin ${f.gross_margin || ''}
Claims: ${f.health_claims || ''} | Certs: ${f.certs || ''}

Be ruthlessly specific. Name names. Calibrate to actual stage and constraints. Return ONLY valid JSON, no markdown:
{
  "verdict": {"signal":"green|yellow|red","headline":"sharp 8-10 word headline","summary":"3-5 sentences with priorities"},
  "competitive": {
    "overview":"2-3 paragraphs naming competitors and category dynamics",
    "market_dynamics":"1 paragraph on category forces",
    "competitors":[{"name":"","positioning":"","strengths":["",""],"weaknesses":["",""],"threat_level":"high|medium|low","opportunity_gap":""}],
    "white_space":"specific underserved territory to own",
    "differentiation_score":65,
    "differentiation_rationale":"2-3 sentences on the score",
    "vulnerabilities":["","",""],
    "advantages":["","",""],
    "competitive_moat":"what makes the brand defensible long-term"
  },
  "distribution": {"priority":"critical|watch|strong","headline":"","insights":"","actions":["","",""]},
  "marketing": {"priority":"","headline":"","insights":"","actions":["","",""]},
  "financial": {"priority":"","headline":"","insights":"","actions":["","",""]},
  "legal": {"priority":"","headline":"","insights":"","actions":["","",""]},
  "innovation": {"priority":"","headline":"","insights":"","actions":["","",""]}
}`;
}

export default async (req) => {
  if (req.method !== 'POST') {
    return new Response(JSON.stringify({ error: 'Method not allowed' }), {
      status: 405, headers: { 'Content-Type': 'application/json' }
    });
  }

  const ip = req.headers.get('x-forwarded-for')?.split(',')[0].trim()
          || req.headers.get('x-nf-client-connection-ip') || 'unknown';

  const limit = checkRateLimit(ip);
  if (!limit.allowed) {
    return new Response(JSON.stringify({
      error: 'rate_limit',
      message: `You've used your 2 free audits today. Come back in ${limit.hoursLeft}h, or upgrade to Pro for unlimited.`
    }), { status: 429, headers: { 'Content-Type': 'application/json' } });
  }

  const apiKey = Netlify.env.get('ANTHROPIC_API_KEY');
  if (!apiKey) {
    return new Response(JSON.stringify({ error: 'Server misconfiguration' }), {
      status: 500, headers: { 'Content-Type': 'application/json' }
    });
  }

  try {
    const formData = await req.json();
    const prompt = buildPrompt(formData);

    // Use streaming to avoid the 30s timeout
    const apiRes = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': apiKey,
        'anthropic-version': '2023-06-01'
      },
      body: JSON.stringify({
        model: 'claude-haiku-4-5-20251001',
        max_tokens: 4500,
        stream: true,
        messages: [{ role: 'user', content: prompt }]
      })
    });

    if (!apiRes.ok) {
      const errText = await apiRes.text();
      return new Response(JSON.stringify({ error: 'Anthropic API error', detail: errText }), {
        status: 502, headers: { 'Content-Type': 'application/json' }
      });
    }

    // Read the streaming response and assemble the full text
    const reader = apiRes.body.getReader();
    const decoder = new TextDecoder();
    let fullText = '';

    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      const chunk = decoder.decode(value, { stream: true });
      const lines = chunk.split('\n');
      for (const line of lines) {
        if (line.startsWith('data: ')) {
          try {
            const data = JSON.parse(line.slice(6));
            if (data.type === 'content_block_delta' && data.delta?.text) {
              fullText += data.delta.text;
            }
          } catch (e) {}
        }
      }
    }

    // Parse the JSON
    let text = fullText.trim();
    text = text.replace(/^```json\s*/, '').replace(/^```\s*/, '').replace(/\s*```$/, '').trim();
    const audit = JSON.parse(text);

    return new Response(JSON.stringify({ audit, remaining: limit.remaining }), {
      status: 200, headers: { 'Content-Type': 'application/json' }
    });

  } catch (err) {
    return new Response(JSON.stringify({
      error: 'Audit failed',
      message: err.message || 'Unknown error'
    }), { status: 500, headers: { 'Content-Type': 'application/json' } });
  }
};

export const config = {
  path: '/api/audit'
};
