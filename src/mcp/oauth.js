// Minimal stateless OAuth 2.0 + PKCE for Claude's MCP connector.
//
// Security model: the static bearer token (AUTH_TOKEN env var) IS the secret.
// The OAuth flow lets Claude discover and register normally; PKCE ties the
// code exchange to the client that initiated the flow.
//
// Stateless trick: the authorization code IS the code_challenge.
// At token time, SHA256(code_verifier) must equal the code — no DB needed.

import { createHash } from "node:crypto";

export function buildMetadata(baseUrl) {
  return {
    issuer: baseUrl,
    authorization_endpoint: `${baseUrl}/oauth/authorize`,
    token_endpoint: `${baseUrl}/oauth/token`,
    registration_endpoint: `${baseUrl}/oauth/register`,
    response_types_supported: ["code"],
    grant_types_supported: ["authorization_code"],
    code_challenge_methods_supported: ["S256"],
    token_endpoint_auth_methods_supported: ["none"],
  };
}

export function handleRegister(body) {
  // Accept any dynamic client registration — we only have one user.
  return {
    client_id: "health-pipeline-client",
    client_id_issued_at: Math.floor(Date.now() / 1000),
    redirect_uris: body?.redirect_uris ?? [],
    grant_types: ["authorization_code"],
    response_types: ["code"],
    token_endpoint_auth_method: "none",
  };
}

export function handleAuthorize(params) {
  const { redirect_uri, state, code_challenge, code_challenge_method } = params;
  if (!redirect_uri)
    return { type: "error", status: 400, body: { error: "invalid_request", error_description: "redirect_uri required" } };
  if (code_challenge_method && code_challenge_method !== "S256")
    return { type: "error", status: 400, body: { error: "invalid_request", error_description: "Only S256 supported" } };

  // Code = code_challenge so we can verify at token time without storage.
  const code = code_challenge ?? "no-pkce";
  const url = new URL(redirect_uri);
  url.searchParams.set("code", code);
  if (state) url.searchParams.set("state", state);
  return { type: "redirect", location: url.toString() };
}

export function handleToken(params, expectedToken) {
  const { grant_type, code, code_verifier } = params ?? {};

  if (grant_type !== "authorization_code")
    return { status: 400, body: { error: "unsupported_grant_type" } };

  if (code !== "no-pkce") {
    if (!code_verifier)
      return { status: 400, body: { error: "invalid_request", error_description: "code_verifier required" } };
    const computed = createHash("sha256").update(code_verifier).digest("base64url");
    if (computed !== code)
      return { status: 400, body: { error: "invalid_grant", error_description: "code_verifier mismatch" } };
  }

  return {
    status: 200,
    body: { access_token: expectedToken, token_type: "bearer", scope: "" },
  };
}
