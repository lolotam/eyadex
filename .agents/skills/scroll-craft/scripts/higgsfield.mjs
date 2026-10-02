#!/usr/bin/env node
/**
 * scrollcraft asset generator: Higgsfield API (platform.higgsfield.ai).
 *
 *   POST https://api.higgsfield.ai/<model-endpoint>   -> { request_id, status_url }
 *   GET  <status_url>                                  -> poll until completed
 *
 * COMMANDS
 *   still  <prompt> <out.png> [--ar 16:9] [--ref a.png]
 *          higgsfield-ai/soul/standard text-to-image. With --ref, the
 *          reference image is uploaded and passed as image_url.
 *          Photoreal by default. Stills are cheap; generate, look, reroll.
 *
 *   shot   <prompt> <in.png> <out.mp4> [--tail b.png] [--dur 5]
 *          bytedance/seedance-2.5/image-to-video. --tail pins the LAST frame
 *          (end_image_url), which is the whole trick behind a seamless chain:
 *          leg N's tail is leg N+1's head, so the cut between them is
 *          frame-identical and invisible.
 *
 *   probe  check credentials and exit. Higgsfield has no credit-balance
 *          endpoint; probe verifies the key pair is accepted.
 *
 * Env: HIGGSFIELD_API_KEY as "key_id:key_secret" (or HF_API_KEY_ID +
 * HF_API_KEY_SECRET), read from the project-root .env if not already set.
 */

import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";

const API = "https://api.higgsfield.ai";

const MODELS = {
  still: "higgsfield-ai/soul/standard",
  shot:  "bytedance/seedance-2.5/image-to-video",
};

// ---------------------------------------------------------------- key ----
function findEnv(start) {
  let dir = path.resolve(start);
  for (let i = 0; i < 8; i++) {
    const p = path.join(dir, ".env");
    if (fs.existsSync(p)) return p;
    const up = path.dirname(dir);
    if (up === dir) break;
    dir = up;
  }
  return null;
}
function envValue(envPath, name) {
  for (const line of fs.readFileSync(envPath, "utf8").split(/\r?\n/)) {
    const m = line.match(new RegExp(`^\\s*${name}\\s*=\\s*(.+?)\\s*$`));
    if (m) return m[1].replace(/^["']|["']$/g, "");
  }
  return null;
}
function loadKey() {
  let combined = process.env.HIGGSFIELD_API_KEY;
  let id = process.env.HF_API_KEY_ID;
  let secret = process.env.HF_API_KEY_SECRET;
  if (!combined && !(id && secret)) {
    const envPath = findEnv(process.cwd());
    if (envPath) {
      combined = combined || envValue(envPath, "HIGGSFIELD_API_KEY");
      id = id || envValue(envPath, "HF_API_KEY_ID");
      secret = secret || envValue(envPath, "HF_API_KEY_SECRET");
    }
  }
  if (combined && combined.includes(":")) return combined;
  if (id && secret) return `${id}:${secret}`;
  throw new Error(
    "HIGGSFIELD_API_KEY (\"key_id:key_secret\") or HF_API_KEY_ID + HF_API_KEY_SECRET not set, " +
    "and no .env found walking up from " + process.cwd()
  );
}
const KEY = loadKey();
const H = { "Content-Type": "application/json", Authorization: `Key ${KEY}` };

// ------------------------------------------------------------- helpers ----
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function uploadLocal(file) {
  const abs = path.resolve(file);
  if (!fs.existsSync(abs)) throw new Error("input not found: " + abs);
  const ext = path.extname(abs).slice(1).toLowerCase();
  const mime = ext === "jpg" ? "image/jpeg" : `image/${ext}`;
  // 1. presigned upload url
  const res = await fetch(`${API}/files/generate-upload-url`, {
    method: "POST", headers: H, body: JSON.stringify({ content_type: mime }),
  });
  const j = await res.json();
  if (!res.ok || !j?.upload_url || !j?.public_url) {
    throw new Error("upload-url failed: " + JSON.stringify(j));
  }
  // 2. PUT the file to storage (no API credentials on this call)
  const put = await fetch(j.upload_url, {
    method: "PUT",
    headers: j.upload_headers || { "Content-Type": mime },
    body: fs.readFileSync(abs),
  });
  if (!put.ok) throw new Error(`upload PUT ${put.status} for ${abs}`);
  return j.public_url;
}

// A local path becomes a hosted URL; an http(s) string passes straight through.
const asUrl = (v) => (/^https?:\/\//i.test(v) ? Promise.resolve(v) : uploadLocal(v));

async function createRequest(model, input) {
  const res = await fetch(`${API}/${model}`, {
    method: "POST",
    headers: { ...H, "Idempotency-Key": crypto.randomUUID() },
    body: JSON.stringify(input),
  });
  const j = await res.json();
  if (!res.ok || !j?.request_id || !j?.status_url) {
    throw new Error(`createRequest ${model}: ${res.status} ${JSON.stringify(j)}`);
  }
  return j;
}

async function waitRequest(statusUrl, { label = "job", timeoutMs = 15 * 60 * 1000 } = {}) {
  const t0 = Date.now();
  let delay = 4000;
  for (;;) {
    if (Date.now() - t0 > timeoutMs) throw new Error(`${label}: timed out after ${Math.round((Date.now() - t0) / 1000)}s`);
    const res = await fetch(statusUrl, { headers: H });
    const d = await res.json();
    const state = d.status;
    if (state === "completed") {
      const urls = [];
      if (d.video?.url) urls.push(d.video.url);
      for (const img of d.images || []) if (img?.url) urls.push(img.url);
      if (d.audio?.url) urls.push(d.audio.url);
      if (!urls.length) throw new Error(`${label}: completed with no result url: ${JSON.stringify(d)}`);
      return urls;
    }
    if (state === "failed" || state === "nsfw" || state === "canceled") {
      throw new Error(`${label} ${state}: ${d.error ? JSON.stringify(d.error) : JSON.stringify(d)}`);
    }
    process.stderr.write(`  ${label}: ${state || "queued"} (${Math.round((Date.now() - t0) / 1000)}s)\n`);
    await sleep(delay);
    delay = Math.min(delay * 1.25, 15000);
  }
}

async function download(url, out) {
  fs.mkdirSync(path.dirname(path.resolve(out)), { recursive: true });
  const res = await fetch(url);
  if (!res.ok) throw new Error(`download ${res.status} ${url}`);
  fs.writeFileSync(path.resolve(out), Buffer.from(await res.arrayBuffer()));
  return out;
}

function flag(argv, name, dflt = null) {
  const i = argv.indexOf(name);
  return i > -1 && argv[i + 1] ? argv[i + 1] : dflt;
}
function flags(argv, name) {
  const out = [];
  argv.forEach((a, i) => { if (a === name && argv[i + 1]) out.push(argv[i + 1]); });
  return out;
}

// ---------------------------------------------------------------- main ----
const [cmd, ...rest] = process.argv.slice(2);

try {
  if (cmd === "probe") {
    // Higgsfield has no credit-balance endpoint; probe submits nothing and
    // only confirms the key pair is accepted by the upload-url endpoint.
    const res = await fetch(`${API}/files/generate-upload-url`, {
      method: "POST", headers: H, body: JSON.stringify({ content_type: "image/png" }),
    });
    if (res.ok) {
      console.log("credentials: ok");
    } else {
      const j = await res.text();
      throw new Error(`credentials rejected: ${res.status} ${j}`);
    }

  } else if (cmd === "still") {
    const [prompt, out] = rest;
    if (!prompt || !out) throw new Error('usage: higgsfield.mjs still "<prompt>" <out.png> [--ar 16:9] [--ref a.png]');
    const ar = flag(rest, "--ar", "16:9");
    const refs = flags(rest, "--ref");
    const input = {
      prompt,
      aspect_ratio: ar,
      resolution: flag(rest, "--resolution", "720p"),
    };
    if (refs.length) input.image_url = await asUrl(refs[0]);
    const req = await createRequest(MODELS.still, input);
    const urls = await waitRequest(req.status_url, { label: path.basename(out) });
    await download(urls[0], out);
    console.log(out);

  } else if (cmd === "shot") {
    const [prompt, head, out] = rest;
    if (!prompt || !head || !out) {
      throw new Error('usage: higgsfield.mjs shot "<prompt>" <head.png> <out.mp4> [--tail b.png] [--dur 5]');
    }
    const dur = Number(flag(rest, "--dur", "5"));
    const tail = flag(rest, "--tail");
    const input = {
      prompt,
      image_url: await asUrl(head),
      duration: dur,
      resolution: "720p",
      output_format: "mp4",
      generate_audio: false,
    };
    if (tail) input.end_image_url = await asUrl(tail);
    const req = await createRequest(MODELS.shot, input);
    const urls = await waitRequest(req.status_url, { label: path.basename(out), timeoutMs: 20 * 60 * 1000 });
    await download(urls[0], out);
    console.log(out);

  } else {
    console.error(`scrollcraft asset generator (Higgsfield)

  node higgsfield.mjs probe
  node higgsfield.mjs still "<prompt>" <out.png> [--ar 16:9] [--ref ref.png]
  node higgsfield.mjs shot  "<prompt>" <head.png> <out.mp4> [--tail tail.png] [--dur 5]
`);
    process.exit(1);
  }
} catch (err) {
  console.error("ERROR:", err.message);
  process.exit(1);
}
