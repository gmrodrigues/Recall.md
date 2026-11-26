#!/usr/bin/env bash
set -euo pipefail

state_dir=$(mktemp -d)
server_pid=
trap 'if [[ -n "$server_pid" ]]; then kill "$server_pid" 2>/dev/null || true; fi; rm -r "$state_dir"' EXIT

wrangler=./node_modules/.bin/wrangler
config=online/wrangler.jsonc
port=16423
"$wrangler" d1 migrations apply DB --local --persist-to "$state_dir" --config "$config"
"$wrangler" dev --local --persist-to "$state_dir" --port "$port" --config "$config" \
  --var DEPLOY_SHA:local > "$state_dir/server.log" 2>&1 &
server_pid=$!
if ! curl -fsS --retry 15 --retry-connrefused --retry-delay 1 --max-time 5 \
  "http://127.0.0.1:$port/health" -o "$state_dir/health.json"; then
  cat "$state_dir/server.log"
  exit 1
fi
node --input-type=module - "$state_dir/health.json" <<'JS'
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import worker from "./online/worker.mjs";

assert.deepEqual(JSON.parse(readFileSync(process.argv[2], "utf8")), { sha: "local", d1: "ok" });
const request = new Request("https://example.test/health");
const reply = await worker.fetch(request, { DB: { prepare() { throw new Error("D1"); } } });
assert.equal(reply.status, 503);
assert.deepEqual(await reply.json(), { d1: "unavailable" });
assert.equal((await worker.fetch(new Request("https://example.test/"), {})).status, 404);
JS
