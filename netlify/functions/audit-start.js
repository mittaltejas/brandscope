// Netlify function — POST /api/audit-start
// Accepts form data, creates a job, triggers the background worker, returns job ID instantly.

import { getStore } from "@netlify/blobs";

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

  try {
    const formData = await req.json();
    const jobId = `${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;

    // Store initial job state
    const store = getStore('audits');
    await store.setJSON(jobId, { status: 'pending', createdAt: Date.now() });

    // Trigger the background function (fire and forget)
    const url = new URL(req.url);
    const bgUrl = `${url.protocol}//${url.host}/.netlify/functions/audit-worker-background`;

    fetch(bgUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ jobId, formData })
    }).catch(() => {}); // fire and forget, don't await

    return new Response(JSON.stringify({ jobId, remaining: limit.remaining }), {
      status: 200, headers: { 'Content-Type': 'application/json' }
    });

  } catch (err) {
    return new Response(JSON.stringify({
      error: 'Could not start audit',
      message: err.message
    }), { status: 500, headers: { 'Content-Type': 'application/json' } });
  }
};

export const config = {
  path: '/api/audit-start'
};
