// Netlify serverless function — POST /api/audit
// Receives form data, calls Anthropic, returns audit JSON.
// Includes IP-based rate limiting (2 audits per IP per 24h).

const RATE_LIMIT = 2; // audits per IP per window
const WINDOW_MS = 24 * 60 * 60 * 1000; // 24 hours

// In-memory rate limit store (resets when function cold-starts).
// For production scale, swap for Upstash Redis / Netlify Blobs.
const rateLimitStore = new Map();

function checkRateLimit(ip) {
  const now = Date.now();
  const record = rateLimitStore.get(ip) || { count: 0, resetAt: now + WINDOW_MS };

  // Reset if window expired
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
  return `You are a senior CPG brand strategist with 20+ years at top firms (P&G, Unilever, Nestlé). You run rigorous, no-fluff brand audits. Your analysis is HEAVILY weighted toward competitive landscape — that is the core value of this audit.

BRAND AUDIT INPUT:
Product: ${f.product_name || 'Not specified'}
Category: ${f.category || 'Not specified'} — ${f.subcategory || ''}
Format: ${f.format || 'Not specified'} | SKUs: ${f.sku_count || 'Not specified'} | Retail Price: ${f.retail_price || 'Not specified'}
Target Consumer: ${f.target_consumer || 'Not specified'}
Brand Promise: ${f.brand_promise || 'Not specified'}
Price Tier: ${f.price_tier || 'Not specified'} | Purchase Driver: ${f.purchase_driver || 'Not specified'}
Key Claims: ${f.key_claims || 'None'} | Stated Differentiation: ${f.differentiation || 'Not provided'}

COMPETITIVE SET:
Competitor 1: ${f.c1_name || 'Not named'} | Positioning: ${f.c1_pos || ''} | Threat: ${f.c1_threat || ''}
Competitor 2: ${f.c2_name || 'Not named'} | Positioning: ${f.c2_pos || ''} | Threat: ${f.c2_threat || ''}
Competitor 3: ${f.c3_name || 'Not named'} | Positioning: ${f.c3_pos || ''} | Threat: ${f.c3_threat || ''}
Category Context: ${f.comp_context || 'Not provided'}

MARKET & DISTRIBUTION:
Geography: ${f.geography || 'Not specified'} | Stage: ${f.dist_stage || 'Not specified'}
Target Channels: ${f.channels || 'Not specified'}
Current Footprint: ${f.footprint || 'None'} | Model: ${f.dist_model || 'Not specified'}

STAGE & CONSTRAINTS:
Brand Stage: ${f.brand_stage || 'Not specified'} | Team: ${f.team_size || 'Not specified'}
Funding: ${f.funding || 'Not specified'} | Marketing Budget: ${f.mktg_budget || 'Not specified'}
Production Constraints: ${f.prod_constraints || 'None'} | Marketing Channels: ${f.mktg_channels || 'Not specified'}

FINANCIAL & REGULATORY:
COGS: ${f.cogs || 'Not specified'} | Target Margin: ${f.gross_margin || 'Not specified'}
Health Claims: ${f.health_claims || 'None'} | Certifications: ${f.certs || 'None'}
Additional Context: ${f.extra_context || 'None'}

INSTRUCTIONS:
Generate a comprehensive, no-fluff CPG brand audit. Be ruthlessly specific — name names, cite real dynamics, avoid generic advice. Calibrate all recommendations to the brand's actual stage and constraints. Competitive landscape analysis should be the most detailed and specific section.

Return ONLY valid JSON with this exact structure (no markdown fences, no preamble):
{
  "verdict": {
    "signal": "green|yellow|red",
    "headline": "8-10 word sharp italic headline capturing the brand's strategic position",
    "summary": "3-5 sentences. Honest overall assessment with the biggest priorities called out directly."
  },
  "competitive": {
    "overview": "2-3 paragraphs of specific competitive landscape analysis. Name competitors. Describe category power dynamics, positioning clusters, and where the whitespace is.",
    "market_dynamics": "1 paragraph on the forces shaping competition in this specific category right now.",
    "competitors": [
      {
        "name": "Competitor name",
        "positioning": "Their actual market positioning in 1-2 sentences.",
        "strengths": ["Specific strength 1", "Specific strength 2"],
        "weaknesses": ["Specific weakness 1", "Specific weakness 2"],
        "threat_level": "high|medium|low",
        "opportunity_gap": "The specific gap or flank this brand can exploit against THIS competitor."
      }
    ],
    "white_space": "The specific underserved positioning territory this brand can own.",
    "differentiation_score": 65,
    "differentiation_rationale": "2-3 sentences explaining the score honestly.",
    "vulnerabilities": ["Specific vulnerability 1", "Specific vulnerability 2", "Specific vulnerability 3"],
    "advantages": ["Specific advantage 1", "Specific advantage 2", "Specific advantage 3"],
    "competitive_moat": "What specifically would make this brand defensible long-term."
  },
  "distribution": {
    "priority": "critical|watch|strong",
    "headline": "8-10 word headline",
    "insights": "Substantive paragraph with specific distribution analysis.",
    "actions": ["Specific action 1", "Specific action 2", "Specific action 3"]
  },
  "marketing": {
    "priority": "critical|watch|strong",
    "headline": "8-10 word headline",
    "insights": "Substantive paragraph with specific marketing recommendations.",
    "actions": ["Specific action 1", "Specific action 2", "Specific action 3"]
  },
  "financial": {
    "priority": "critical|watch|strong",
    "headline": "8-10 word headline",
    "insights": "Substantive paragraph on margin pressure and unit economics.",
    "actions": ["Specific action 1", "Specific action 2", "Specific action 3"]
  },
  "legal": {
    "priority": "critical|watch|strong",
    "headline": "8-10 word headline",
    "insights": "Specific legal and compliance considerations.",
    "actions": ["Specific action 1", "Specific action 2", "Specific action 3"]
  },
  "innovation": {
    "priority": "critical|watch|strong",
    "headline": "8-10 word headline",
    "insights": "Portfolio strategy and SKU rationalization.",
    "actions": ["Specific action 1", "Specific action 2", "Specific action 3"]
  }
}`;
}

export default async (req) => {
  // Only POST allowed
  if (req.method !== 'POST') {
    return new Response(JSON.stringify({ error: 'Method not allowed' }), {
      status: 405,
      headers: { 'Content-Type': 'application/json' }
    });
  }

  // Get client IP for rate limiting
  const ip = req.headers.get('x-forwarded-for')?.split(',')[0].trim()
          || req.headers.get('x-nf-client-connection-ip')
          || 'unknown';

  // Check rate limit
  const limit = checkRateLimit(ip);
  if (!limit.allowed) {
    return new Response(JSON.stringify({
      error: 'rate_limit',
      message: `You've used your 2 free audits for today. Come back in ${limit.hoursLeft} hours, or upgrade to Pro for unlimited audits.`
    }), {
      status: 429,
      headers: { 'Content-Type': 'application/json' }
    });
  }

  // Get API key from environment
  const apiKey = Netlify.env.get('ANTHROPIC_API_KEY');
  if (!apiKey) {
    return new Response(JSON.stringify({ error: 'Server misconfiguration' }), {
      status: 500,
      headers: { 'Content-Type': 'application/json' }
    });
  }

  try {
    const formData = await req.json();
    const prompt = buildPrompt(formData);

    const apiRes = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': apiKey,
        'anthropic-version': '2023-06-01'
      },
      body: JSON.stringify({
        model: 'claude-sonnet-4-6',
        max_tokens: 8000,
        messages: [{ role: 'user', content: prompt }]
      })
    });

    if (!apiRes.ok) {
      const errText = await apiRes.text();
      return new Response(JSON.stringify({ error: 'Anthropic API error', detail: errText }), {
        status: 502,
        headers: { 'Content-Type': 'application/json' }
      });
    }

    const data = await apiRes.json();
    let text = data.content[0].text.trim();
    // Strip markdown fences if present
    text = text.replace(/^```json\s*/, '').replace(/^```\s*/, '').replace(/\s*```$/, '').trim();

    const audit = JSON.parse(text);

    return new Response(JSON.stringify({ audit, remaining: limit.remaining }), {
      status: 200,
      headers: { 'Content-Type': 'application/json' }
    });

  } catch (err) {
    return new Response(JSON.stringify({
      error: 'Audit failed',
      message: err.message || 'Unknown error'
    }), {
      status: 500,
      headers: { 'Content-Type': 'application/json' }
    });
  }
};

export const config = {
  path: '/api/audit'
};
