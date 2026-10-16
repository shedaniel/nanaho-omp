import { expect, test } from "bun:test";
import { normalizeBaseUrl } from "./config";

test("normalizes an API base URL without losing its path", () => {
  expect(normalizeBaseUrl("  https://gateway.invalid/api/v1///  ")).toBe("https://gateway.invalid/api/v1");
  expect(normalizeBaseUrl("http://127.0.0.1:39224/v1/")).toBe("http://127.0.0.1:39224/v1");
});

test.each([
  "not a URL",
  "file:///etc/passwd",
  "ftp://gateway.invalid/v1",
  "https://user:secret@gateway.invalid/v1",
  "https://gateway.invalid/v1?api_key=secret",
  "https://gateway.invalid/v1#secret",
])("rejects unsupported or credential-bearing endpoint %s", value => {
  expect(() => normalizeBaseUrl(value)).toThrow();
});
