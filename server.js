// Claude AI Proxy Server for Roblox Studio Plugin
// Deploy this to Render, Railway, or any Node host
//
// Environment variables needed:
//   ANTHROPIC_API_KEY=sk-ant-...
//   PORT (optional, defaults to 3000)

const http = require("http");
const https = require("https");

const PORT = process.env.PORT || 3000;
const API_KEY = process.env.ANTHROPIC_API_KEY;

if (!API_KEY) {
  console.error("ERROR: ANTHROPIC_API_KEY environment variable is not set.");
  process.exit(1);
}

// ── Helper: read full body from a request ──────────────────────
function readBody(req) {
  return new Promise((resolve, reject) => {
    let data = "";
    req.on("data", (chunk) => (data += chunk));
    req.on("end", () => resolve(data));
    req.on("error", reject);
  });
}

// ── Call Anthropic API ─────────────────────────────────────────
function callClaude(systemPrompt, userPrompt) {
  return new Promise((resolve, reject) => {
    const payload = JSON.stringify({
      model: "claude-sonnet-4-6",
      max_tokens: 4096,
      system: systemPrompt,
      messages: [{ role: "user", content: userPrompt }],
    });

    const options = {
      hostname: "api.anthropic.com",
      path: "/v1/messages",
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-api-key": API_KEY,
        "anthropic-version": "2023-06-01",
        "Content-Length": Buffer.byteLength(payload),
      },
    };

    const req = https.request(options, (res) => {
      let body = "";
      res.on("data", (chunk) => (body += chunk));
      res.on("end", () => {
        try {
          const parsed = JSON.parse(body);
          if (parsed.error) {
            reject(new Error(parsed.error.message));
          } else {
            resolve(parsed);
          }
        } catch (e) {
          reject(e);
        }
      });
    });

    req.on("error", reject);
    req.write(payload);
    req.end();
  });
}

// ── Strip code fences if Claude adds them ─────────────────────
function extractCode(text) {
  const match = text.match(/```(?:lua|luau)?\n([\s\S]*?)```/);
  return match ? match[1].trim() : text.trim();
}

// ── Derive a script name from the user prompt ─────────────────
function deriveScriptName(prompt) {
  const words = prompt
    .replace(/[^a-zA-Z0-9 ]/g, "")
    .split(" ")
    .filter(Boolean)
    .slice(0, 4)
    .map((w) => w.charAt(0).toUpperCase() + w.slice(1));
  return words.join("") || "ClaudeScript";
}

// ── HTTP server ────────────────────────────────────────────────
const server = http.createServer(async (req, res) => {
  // CORS headers (Roblox HttpService doesn't need them, but useful for testing)
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "POST, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");

  if (req.method === "OPTIONS") {
    res.writeHead(204);
    res.end();
    return;
  }

  if (req.method === "GET" && req.url === "/health") {
    res.writeHead(200, { "Content-Type": "application/json" });
    res.end(JSON.stringify({ status: "ok" }));
    return;
  }

  if (req.method !== "POST" || req.url !== "/claude") {
    res.writeHead(404, { "Content-Type": "application/json" });
    res.end(JSON.stringify({ error: "Not found. POST to /claude" }));
    return;
  }

  try {
    const rawBody = await readBody(req);
    const body = JSON.parse(rawBody);

    const { prompt, system, scriptType, destination } = body;

    if (!prompt) {
      res.writeHead(400, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ error: "Missing 'prompt' field" }));
      return;
    }

    const systemPrompt =
      system ||
      `You are an expert Roblox Luau developer.
The user will describe what they want a script to do.
Respond with ONLY valid Luau code — no explanations, no markdown fences.
The code should be clean, commented, and production-ready.
Script type: ${scriptType || "Script"}.
Target location: ${destination || "ServerScriptService"}.
Use best practices: server/client separation, RemoteEvents where needed.`;

    const userMessage = `Write a Roblox Luau ${scriptType || "Script"} that does the following:\n${prompt}`;

    console.log(`[${new Date().toISOString()}] Request: "${prompt.slice(0, 80)}..."`);

    const claudeResponse = await callClaude(systemPrompt, userMessage);
    const rawText = claudeResponse.content?.[0]?.text || "";
    const code = extractCode(rawText);
    const name = deriveScriptName(prompt);

    res.writeHead(200, { "Content-Type": "application/json" });
    res.end(JSON.stringify({ code, name }));

    console.log(`[${new Date().toISOString()}] Success: inserted "${name}" (${code.length} chars)`);
  } catch (err) {
    console.error("Error:", err.message);
    res.writeHead(500, { "Content-Type": "application/json" });
    res.end(JSON.stringify({ error: err.message }));
  }
});

server.listen(PORT, () => {
  console.log(`Claude proxy running on port ${PORT}`);
  console.log(`POST http://localhost:${PORT}/claude`);
});
