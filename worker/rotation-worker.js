/*
  Shared store for the daily rotation. One JSON document, two verbs.

    GET  /   -> the current config, or null if nothing has been saved yet
    PUT  /   -> replace it; requires the team key in an x-team-key header

  Reads are deliberately open: every phone needs the roster on open, and the
  roster is not a secret. Writes need the key, and the key lives in this
  Worker's environment rather than in the page, so nobody who finds the public
  URL can rewrite the rotation.

  The version counter is stamped here, not by the clients. Two phones editing
  in the same minute can't then argue about which copy is newer — whoever
  writes last gets the higher number, and everyone else adopts it on next open.

  ── Setting it up (once) ───────────────────────────────────────────────────
  1. Cloudflare dashboard -> Workers & Pages -> Create -> Worker. Paste this in.
  2. Storage & Databases -> KV -> Create namespace, call it rotation.
  3. Back in the Worker -> Settings -> Bindings -> add a KV binding:
        variable name  ROTATION      namespace  rotation
  4. Settings -> Variables and Secrets -> add a secret:
        name  TEAM_KEY               value  any long random string
  5. Deploy, copy the worker URL, and put it in SYNC_URL in index.html.
     Open the app, Ajustes -> Sincronizar, and paste the same TEAM_KEY there.
*/

const MAX_BYTES = 20000;   // the whole roster is well under 2KB; this is a lid

const cors = {
  "access-control-allow-origin": "*",
  "access-control-allow-methods": "GET,PUT,OPTIONS",
  "access-control-allow-headers": "content-type,x-team-key",
  "access-control-max-age": "86400",
};
const json = (body, status = 200) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { ...cors, "content-type": "application/json", "cache-control": "no-store" },
  });

export default {
  async fetch(req, env) {
    if (req.method === "OPTIONS") return new Response(null, { headers: cors });

    if (!env.ROTATION) return json({ error: "no KV binding named ROTATION" }, 500);

    if (req.method === "GET") {
      const doc = await env.ROTATION.get("config");
      return new Response(doc || "null", {
        headers: { ...cors, "content-type": "application/json", "cache-control": "no-store" },
      });
    }

    if (req.method === "PUT") {
      if (!env.TEAM_KEY) return json({ error: "no TEAM_KEY secret set" }, 500);
      if (req.headers.get("x-team-key") !== env.TEAM_KEY)
        return json({ error: "wrong team key" }, 403);

      const body = await req.text();
      if (body.length > MAX_BYTES) return json({ error: "too big" }, 413);

      let next;
      try { next = JSON.parse(body); }
      catch { return json({ error: "not json" }, 400); }
      if (!next || typeof next !== "object" || Array.isArray(next))
        return json({ error: "expected an object" }, 400);

      const prev = JSON.parse((await env.ROTATION.get("config")) || "null");
      next.v = ((prev && prev.v) | 0) + 1;      // the server owns the version
      next.at = Date.now();
      await env.ROTATION.put("config", JSON.stringify(next));
      return json({ v: next.v, at: next.at });
    }

    return json({ error: "method not allowed" }, 405);
  },
};
