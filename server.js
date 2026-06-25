import { createServer } from "node:http";
import { readFile, stat } from "node:fs/promises";
import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const publicDir = path.join(__dirname, "public");
const envPath = path.join(__dirname, ".env");

loadDotEnv(envPath);

const cloudName = process.env.CLOUDINARY_CLOUD_NAME || "";
const apiKey = process.env.CLOUDINARY_API_KEY || "";
const apiSecret = process.env.CLOUDINARY_API_SECRET || "";
const uploadPreset = process.env.CLOUDINARY_UPLOAD_PRESET || "unsigned_upload_preset";
const port = Number(process.env.PORT || 5174);
const host = process.env.HOST || "127.0.0.1";

const analyzeEndpoints = new Set([
  "ai_vision_general",
  "ai_vision_tagging",
  "captioning",
  "coco",
  "cld_text",
  "image_quality",
  "cld_fashion",
  "lvis",
  "unidet",
  "watermark_detection",
  "shop_classifier",
  "human_anatomy",
]);

const mimeTypes = {
  ".css": "text/css; charset=utf-8",
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".svg": "image/svg+xml",
};

const server = createServer(async (req, res) => {
  try {
    const url = new URL(req.url || "/", `http://${req.headers.host || "localhost"}`);

    if (req.method === "GET" && url.pathname === "/api/config") {
      return sendJson(res, 200, {
        cloudName,
        uploadPreset,
        hasCloudName: Boolean(cloudName),
        hasUploadPreset: Boolean(uploadPreset),
        hasAnalyzeCredentials: Boolean(apiKey && apiSecret),
      });
    }

    const analyzeMatch = url.pathname.match(/^\/api\/analyze\/([a-z0-9_]+)$/);
    if (req.method === "POST" && analyzeMatch) {
      return handleAnalyze(req, res, analyzeMatch[1]);
    }

    if (req.method === "POST" && url.pathname === "/api/assets/tags") {
      return handleUpdateTags(req, res);
    }

    if (req.method === "POST" && url.pathname === "/api/assets/context") {
      return handleUpdateContext(req, res);
    }

    const taskMatch = url.pathname.match(/^\/api\/tasks\/([^/]+)$/);
    if (req.method === "GET" && taskMatch) {
      return handleTaskStatus(res, decodeURIComponent(taskMatch[1]));
    }

    if (req.method === "GET" || req.method === "HEAD") {
      return serveStatic(req, res, url.pathname);
    }

    sendJson(res, 405, { error: "Method not allowed" });
  } catch (error) {
    console.error(error);
    sendJson(res, 500, { error: "Unexpected server error" });
  }
});

server.listen(port, host, () => {
  console.log(`AAF_INTL demo running at http://${host}:${port}`);
});

async function handleAnalyze(req, res, endpoint) {
  if (!analyzeEndpoints.has(endpoint)) {
    return sendJson(res, 404, { error: `Unsupported analysis endpoint: ${endpoint}` });
  }

  if (!cloudName) {
    return sendJson(res, 503, {
      error: "Missing Cloudinary cloud name on the server.",
      detail: "Add CLOUDINARY_CLOUD_NAME to AAF_INTL/.env.",
    });
  }

  if (!apiKey || !apiSecret) {
    return sendJson(res, 503, {
      error: "Missing Cloudinary API credentials on the server.",
      detail: "Add CLOUDINARY_API_KEY and CLOUDINARY_API_SECRET to AAF_INTL/.env.",
    });
  }

  const payload = await readJsonBody(req);
  if (!payload?.source?.asset_id && !payload?.source?.uri) {
    return sendJson(res, 400, {
      error: "Analysis requires source.asset_id or source.uri.",
    });
  }

  if (endpoint === "ai_vision_general" && !Array.isArray(payload.prompts)) {
    payload.prompts = [
      "Describe this image in detail.",
      "List visible objects, text, brands, colors, and scene details.",
      "Suggest concise metadata tags for this asset.",
    ];
  }

  const upstream = await callCloudinaryAnalysis(`/analyze/${endpoint}`, {
    method: "POST",
    body: payload,
  });

  sendJson(res, upstream.status, upstream.body);
}

async function handleTaskStatus(res, taskId) {
  if (!cloudName) {
    return sendJson(res, 503, {
      error: "Missing Cloudinary cloud name on the server.",
      detail: "Add CLOUDINARY_CLOUD_NAME to AAF_INTL/.env.",
    });
  }

  if (!apiKey || !apiSecret) {
    return sendJson(res, 503, {
      error: "Missing Cloudinary API credentials on the server.",
      detail: "Add CLOUDINARY_API_KEY and CLOUDINARY_API_SECRET to AAF_INTL/.env.",
    });
  }

  const upstream = await callCloudinaryAnalysis(`/tasks/${encodeURIComponent(taskId)}`, {
    method: "GET",
  });

  sendJson(res, upstream.status, upstream.body);
}

async function handleUpdateTags(req, res) {
  if (!cloudName) {
    return sendJson(res, 503, {
      error: "Missing Cloudinary cloud name on the server.",
      detail: "Add CLOUDINARY_CLOUD_NAME to AAF_INTL/.env.",
    });
  }

  if (!apiKey || !apiSecret) {
    return sendJson(res, 503, {
      error: "Missing Cloudinary API credentials on the server.",
      detail: "Add CLOUDINARY_API_KEY and CLOUDINARY_API_SECRET to AAF_INTL/.env.",
    });
  }

  const payload = await readJsonBody(req);
  const assetId = String(payload.assetId || "");
  const publicId = String(payload.publicId || "");
  const tags = normalizeTags(payload.tags);

  if ((!assetId && !publicId) || !tags.length) {
    return sendJson(res, 400, {
      error: "Updating tags requires assetId or publicId and at least one tag.",
    });
  }

  const upstream = await updateCloudinaryResource(payload, {
    tags: tags.join(","),
  });

  sendJson(res, upstream.status, upstream.body);
}

async function handleUpdateContext(req, res) {
  if (!cloudName) {
    return sendJson(res, 503, {
      error: "Missing Cloudinary cloud name on the server.",
      detail: "Add CLOUDINARY_CLOUD_NAME to AAF_INTL/.env.",
    });
  }

  if (!apiKey || !apiSecret) {
    return sendJson(res, 503, {
      error: "Missing Cloudinary API credentials on the server.",
      detail: "Add CLOUDINARY_API_KEY and CLOUDINARY_API_SECRET to AAF_INTL/.env.",
    });
  }

  const payload = await readJsonBody(req);
  const assetId = String(payload.assetId || "");
  const publicId = String(payload.publicId || "");
  const caption = String(payload.caption || "").trim();

  if ((!assetId && !publicId) || !caption) {
    return sendJson(res, 400, {
      error: "Updating context requires assetId or publicId and caption.",
    });
  }

  const context = [
    ["caption", caption],
    ["alt", caption],
  ]
    .map(([key, value]) => `${key}=${escapeContextValue(value).slice(0, 1024)}`)
    .join("|");

  const upstream = await updateCloudinaryResource(payload, { context });
  sendJson(res, upstream.status, upstream.body);
}

async function updateCloudinaryResource(payload, fields) {
  const assetId = String(payload.assetId || "");
  if (assetId) {
    return updateCloudinaryResourceByAssetId(assetId, fields);
  }

  const resourceType = encodeURIComponent(payload.resourceType || "image");
  const type = encodeURIComponent(payload.type || "upload");
  const publicIdPath = String(payload.publicId)
    .split("/")
    .map((segment) => encodeURIComponent(segment))
    .join("/");
  const url = `https://api.cloudinary.com/v1_1/${encodeURIComponent(
    cloudName,
  )}/resources/${resourceType}/${type}/${publicIdPath}`;
  const body = new URLSearchParams(fields);

  const response = await fetch(url, {
    method: "POST",
    headers: {
      Authorization: `Basic ${Buffer.from(`${apiKey}:${apiSecret}`).toString("base64")}`,
      Accept: "application/json",
      "Content-Type": "application/x-www-form-urlencoded",
    },
    body,
  });

  const text = await response.text();
  let responseBody = text;

  try {
    responseBody = text ? JSON.parse(text) : {};
  } catch {
    responseBody = { raw: text };
  }

  return { status: response.status, body: responseBody };
}

async function updateCloudinaryResourceByAssetId(assetId, fields) {
  const url = `https://api.cloudinary.com/v1_1/${encodeURIComponent(
    cloudName,
  )}/resources/${encodeURIComponent(assetId)}`;
  const body = new URLSearchParams(fields);

  const response = await fetch(url, {
    method: "PUT",
    headers: {
      Authorization: `Basic ${Buffer.from(`${apiKey}:${apiSecret}`).toString("base64")}`,
      Accept: "application/json",
      "Content-Type": "application/x-www-form-urlencoded",
    },
    body,
  });

  const text = await response.text();
  let responseBody = text;

  try {
    responseBody = text ? JSON.parse(text) : {};
  } catch {
    responseBody = { raw: text };
  }

  return { status: response.status, body: responseBody };
}

async function callCloudinaryAnalysis(route, options) {
  const url = `https://api.cloudinary.com/v2/analysis/${encodeURIComponent(cloudName)}${route}`;
  const headers = {
    Authorization: `Basic ${Buffer.from(`${apiKey}:${apiSecret}`).toString("base64")}`,
    Accept: "application/json",
  };

  if (options.body) {
    headers["Content-Type"] = "application/json";
  }

  const response = await fetch(url, {
    method: options.method,
    headers,
    body: options.body ? JSON.stringify(options.body) : undefined,
  });

  const text = await response.text();
  let body = text;

  try {
    body = text ? JSON.parse(text) : {};
  } catch {
    body = { raw: text };
  }

  return { status: response.status, body };
}

function normalizeTags(tags) {
  const rawTags = Array.isArray(tags) ? tags : String(tags || "").split(",");
  const seen = new Set();

  return rawTags
    .map((tag) =>
      String(tag)
        .trim()
        .toLowerCase()
        .replace(/^[#\s]+/, "")
        .replace(/\s+/g, "-")
        .replace(/[^a-z0-9_-]/g, ""),
    )
    .filter((tag) => tag.length >= 2 && tag.length <= 64)
    .filter((tag) => {
      if (seen.has(tag)) {
        return false;
      }
      seen.add(tag);
      return true;
    })
    .slice(0, 20);
}

function escapeContextValue(value) {
  return String(value)
    .replace(/\\/g, "\\\\")
    .replace(/\|/g, "\\|")
    .replace(/=/g, "\\=");
}

async function serveStatic(req, res, pathname) {
  const decodedPath = decodeURIComponent(pathname);
  const requestPath = decodedPath === "/" ? "/index.html" : decodedPath;
  const normalized = path.normalize(requestPath).replace(/^(\.\.[/\\])+/, "");
  const filePath = path.join(publicDir, normalized);

  if (!filePath.startsWith(publicDir)) {
    return sendJson(res, 403, { error: "Forbidden" });
  }

  try {
    const fileStat = await stat(filePath);
    if (!fileStat.isFile()) {
      return sendJson(res, 404, { error: "Not found" });
    }

    const ext = path.extname(filePath);
    res.writeHead(200, {
      "Content-Type": mimeTypes[ext] || "application/octet-stream",
      "Cache-Control": "no-store",
    });

    if (req.method === "HEAD") {
      return res.end();
    }

    res.end(await readFile(filePath));
  } catch {
    sendJson(res, 404, { error: "Not found" });
  }
}

async function readJsonBody(req) {
  const chunks = [];
  let size = 0;

  for await (const chunk of req) {
    size += chunk.length;
    if (size > 1024 * 1024) {
      throw new Error("Request body is too large");
    }
    chunks.push(chunk);
  }

  const text = Buffer.concat(chunks).toString("utf8");
  return text ? JSON.parse(text) : {};
}

function sendJson(res, status, body) {
  res.writeHead(status, {
    "Content-Type": "application/json; charset=utf-8",
    "Cache-Control": "no-store",
  });
  res.end(JSON.stringify(body, null, 2));
}

function loadDotEnv(filePath) {
  if (!existsSync(filePath)) {
    return;
  }

  const lines = readFileSync(filePath, "utf8").split(/\r?\n/);
  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) {
      continue;
    }

    const separator = trimmed.indexOf("=");
    if (separator === -1) {
      continue;
    }

    const key = trimmed.slice(0, separator).trim();
    const rawValue = trimmed.slice(separator + 1).trim();
    const value = rawValue.replace(/^['"]|['"]$/g, "");
    if (key && process.env[key] === undefined) {
      process.env[key] = value;
    }
  }
}
