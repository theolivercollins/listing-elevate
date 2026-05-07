import { randomBytes } from "node:crypto";

// URL-safe base64 token. 32 bytes = 256 bits of entropy, ~43 chars after b64.
// Used for both onboarding links and public deliverable review links — both
// tokens are unguessable and act as bearer credentials for unauthenticated flows.
export function generateToken(): string {
  return randomBytes(32).toString("base64url");
}
