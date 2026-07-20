import test from "node:test";
import assert from "node:assert/strict";
import { codeAt, verifyTotp } from "../server/totp.mjs";

test("optional TOTP verifies current codes and rejects malformed input", () => {
  const secret = "JBSWY3DPEHPK3PXP";
  const now = 1_700_000_000_000;
  assert.equal(verifyTotp(codeAt(secret, now), secret, now), true);
  assert.equal(verifyTotp("00000", secret, now), false);
});
