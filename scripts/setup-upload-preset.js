import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const appDir = path.dirname(__dirname);
const envPath = path.join(appDir, ".env");

loadDotEnv(envPath);

const cloudName = process.env.CLOUDINARY_CLOUD_NAME || "";
const apiKey = process.env.CLOUDINARY_API_KEY || "";
const apiSecret = process.env.CLOUDINARY_API_SECRET || "";
const uploadPreset = process.env.CLOUDINARY_UPLOAD_PRESET || "unsigned_upload_preset";
const uploadFolder = process.env.CLOUDINARY_UPLOAD_FOLDER || "AAF_INTL";

if (!cloudName || !apiKey || !apiSecret) {
  console.error(
    "Missing Cloudinary setup values. Add CLOUDINARY_CLOUD_NAME, CLOUDINARY_API_KEY, and CLOUDINARY_API_SECRET to .env.",
  );
  process.exit(1);
}

const baseUrl = `https://api.cloudinary.com/v1_1/${encodeURIComponent(cloudName)}`;
const authHeader = `Basic ${Buffer.from(`${apiKey}:${apiSecret}`).toString("base64")}`;

try {
  const existing = await getUploadPreset(uploadPreset);

  if (existing.status === 200) {
    if (existing.body.unsigned === true) {
      console.log(`Upload preset "${uploadPreset}" already exists and allows unsigned uploads.`);
      process.exit(0);
    }

    console.error(
      `Upload preset "${uploadPreset}" already exists but is not unsigned. Use a different CLOUDINARY_UPLOAD_PRESET value or update that preset in Cloudinary.`,
    );
    process.exit(1);
  }

  if (existing.status !== 404) {
    console.error(`Could not check upload preset "${uploadPreset}".`);
    console.error(formatCloudinaryError(existing));
    process.exit(1);
  }

  const created = await createUploadPreset(uploadPreset);
  if (created.status < 200 || created.status >= 300) {
    console.error(`Could not create upload preset "${uploadPreset}".`);
    console.error(formatCloudinaryError(created));
    process.exit(1);
  }

  console.log(`Created unsigned upload preset "${uploadPreset}" for folder "${uploadFolder}".`);
} catch (error) {
  console.error(error.message || "Unexpected setup error.");
  process.exit(1);
}

async function getUploadPreset(name) {
  return callCloudinary(`/upload_presets/${encodeURIComponent(name)}`, {
    method: "GET",
  });
}

async function createUploadPreset(name) {
  const body = new URLSearchParams({
    name,
    unsigned: "true",
    disallow_public_id: "true",
    folder: uploadFolder,
  });

  return callCloudinary("/upload_presets", {
    method: "POST",
    body,
  });
}

async function callCloudinary(pathname, options) {
  const response = await fetch(`${baseUrl}${pathname}`, {
    method: options.method,
    headers: {
      Authorization: authHeader,
      Accept: "application/json",
      ...(options.body ? { "Content-Type": "application/x-www-form-urlencoded" } : {}),
    },
    body: options.body,
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

function formatCloudinaryError(result) {
  const message = result.body?.error?.message || result.body?.error || result.body?.raw || "";
  return `Status ${result.status}${message ? `: ${message}` : ""}`;
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
