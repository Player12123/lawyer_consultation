const baseUrl = (process.env.SMOKE_BASE_URL ?? "http://localhost:3000").replace(/\/$/, "");

async function request(path, options = {}) {
  const response = await fetch(`${baseUrl}${path}`, options);
  const text = await response.text();
  return { response, text };
}

function expect(condition, message) {
  if (!condition) throw new Error(message);
}

const readiness = await request("/api/readyz");
expect(readiness.response.status === 200, `readyz failed: ${readiness.response.status}`);

const unauthenticated = await request("/api/v1/auth/me", {
  method: "POST",
  headers: { origin: baseUrl, "content-type": "application/json" },
  body: "{}",
});
expect(unauthenticated.response.status === 401, `unauthenticated auth check expected 401, got ${unauthenticated.response.status}`);
expect(unauthenticated.response.headers.get("x-content-type-options") === "nosniff", "API response is missing nosniff header");

const rejectedOrigin = await request("/api/v1/auth/me", {
  method: "POST",
  headers: { origin: "https://untrusted.invalid", "content-type": "application/json" },
  body: "{}",
});
expect(rejectedOrigin.response.status === 403, `cross-origin request expected 403, got ${rejectedOrigin.response.status}`);

console.log(`Smoke test passed for ${baseUrl}`);
