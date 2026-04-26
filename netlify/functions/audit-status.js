// Netlify function — GET /api/audit-status?id=xxx
// Frontend polls this to check on a running audit.

import { getStore } from "@netlify/blobs";

export default async (req) => {
  const url = new URL(req.url);
  const jobId = url.searchParams.get('id');

  if (!jobId) {
    return new Response(JSON.stringify({ error: 'Missing job ID' }), {
      status: 400, headers: { 'Content-Type': 'application/json' }
    });
  }

  try {
    const store = getStore('audits');
    const job = await store.get(jobId, { type: 'json' });

    if (!job) {
      return new Response(JSON.stringify({ status: 'not_found' }), {
        status: 404, headers: { 'Content-Type': 'application/json' }
      });
    }

    return new Response(JSON.stringify(job), {
      status: 200, headers: { 'Content-Type': 'application/json' }
    });

  } catch (err) {
    return new Response(JSON.stringify({
      error: 'Status check failed',
      message: err.message
    }), { status: 500, headers: { 'Content-Type': 'application/json' } });
  }
};

export const config = {
  path: '/api/audit-status'
};
