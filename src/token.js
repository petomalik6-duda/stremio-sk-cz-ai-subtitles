import crypto from "node:crypto";

function secret() {
  const value = process.env.TOKEN_SECRET;
  if (!value || value.length < 24) {
    throw new Error("TOKEN_SECRET must be set and contain at least 24 characters");
  }
  return value;
}

export function signPayload(payload, ttlHours = Number(process.env.SIGNED_URL_TTL_HOURS || 168)) {
  const data = {
    ...payload,
    exp: Date.now() + ttlHours * 60 * 60 * 1000
  };
  const body = Buffer.from(JSON.stringify(data), "utf8").toString("base64url");
  const signature = crypto.createHmac("sha256", secret()).update(body).digest("base64url");
  return `${body}.${signature}`;
}

export function verifyPayload(token) {
  const [body, suppliedSignature] = String(token || "").split(".");
  if (!body || !suppliedSignature) throw new Error("Invalid signed subtitle URL");
  const expectedSignature = crypto.createHmac("sha256", secret()).update(body).digest("base64url");
  const supplied = Buffer.from(suppliedSignature);
  const expected = Buffer.from(expectedSignature);
  if (supplied.length !== expected.length || !crypto.timingSafeEqual(supplied, expected)) {
    throw new Error("Invalid signed subtitle URL");
  }
  const data = JSON.parse(Buffer.from(body, "base64url").toString("utf8"));
  if (!data.exp || Date.now() > Number(data.exp)) throw new Error("Subtitle URL has expired");
  return data;
}
