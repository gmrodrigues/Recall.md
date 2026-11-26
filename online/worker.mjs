export default {
  async fetch(request, env) {
    const headers = { "Cache-Control": "no-store" };
    if (request.method !== "GET" || new URL(request.url).pathname !== "/health") {
      return new Response(null, { status: 404, headers });
    }

    try {
      const marker = await env.DB.prepare(
        "SELECT marker FROM deployment_probe WHERE id = 1",
      ).first("marker");
      if (marker === "recall-online-pilot") {
        return Response.json({ sha: env.DEPLOY_SHA, d1: "ok" }, { headers });
      }
    } catch {
      // Keep operational details out of the public response.
    }
    return Response.json({ d1: "unavailable" }, { status: 503, headers });
  },
};
