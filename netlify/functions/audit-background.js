// Netlify Background Function — has up to 15 minutes runtime.
// Filename ends in -background so Netlify runs it asynchronously.

import { getStore } from "@netlify/blobs";

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
  console.log('[bg] audit-background invoked');
  const store = getStore('audits');
  let jobId;

  try {
    const body = await req.json();
    jobId = body.jobId;
    console.log('[bg] jobId received:', jobId);

    if (!jobId) {
      console.log('[bg] no jobId, exiting');
      return new Response('Missing jobId', { status: 400 });
    }

    const job = await store.get(jobId, { type: 'json' });
    if (!job || !job.formData) {
      console.log('[bg] no job record found for', jobId);
      await store.setJSON(jobId, { status: 'error', error: 'Job not found' });
      return new Response('Job not found', { status: 404 });
    }

    const formData = job.formData;
    console.log('[bg] starting audit for product:', formData.product_name);

    await store.setJSON(jobId, { status: 'processing', formData, createdAt: Date.now() });

    const apiKey = Netlify.env.get('ANTHROPIC_API_KEY');
    if (!apiKey) {
      console.log('[bg] no API key set');
      await store.setJSON(jobId, { status: 'error', error: 'Server misconfiguration' });
      return new Response('No API key', { status: 500 });
    }

    const prompt = buildPrompt(formData);
    console.log('[bg] calling Anthropic...');

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

    console.log('[bg] Anthropic responded with status:', apiRes.status);

    if (!apiRes.ok) {
      const errText = await apiRes.text();
      console.log('[bg] Anthropic error:', errText.slice(0, 200));
      await store.setJSON(jobId, { status: 'error', error: 'Anthropic API error', detail: errText.slice(0, 500) });
      return new Response('API error', { status: 502 });
    }

    const data = await apiRes.json();
    let text = data.content[0].text.trim();
    text = text.replace(/^```json\s*/, '').replace(/^```\s*/, '').replace(/\s*```$/, '').trim();

    console.log('[bg] parsing JSON...');
    const audit = JSON.parse(text);

    await store.setJSON(jobId, {
      status: 'complete',
      audit,
      completedAt: Date.now()
    });

    console.log('[bg] DONE — saved result for', jobId);
    return new Response('OK', { status: 200 });

  } catch (err) {
    console.log('[bg] caught error:', err.message);
    if (jobId) {
      await store.setJSON(jobId, {
        status: 'error',
        error: err.message || 'Unknown error',
        completedAt: Date.now()
      });
    }
    return new Response('Error', { status: 500 });
  }
};
