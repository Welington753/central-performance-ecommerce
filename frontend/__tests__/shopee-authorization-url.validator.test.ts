import { isAllowedShopeeAuthorizationUrl } from "@/lib/shopee-authorization-url.validator";

describe("isAllowedShopeeAuthorizationUrl", () => {
  it("accepts the exact production host+path", () => {
    expect(
      isAllowedShopeeAuthorizationUrl("https://open.shopee.com.br/auth"),
    ).toBe(true);
  });

  it("accepts the exact sandbox host+path", () => {
    expect(
      isAllowedShopeeAuthorizationUrl(
        "https://open.sandbox.test-stable.shopee.com.br/auth",
      ),
    ).toBe(true);
  });

  it("accepts an allowlisted URL that also carries a query string", () => {
    expect(
      isAllowedShopeeAuthorizationUrl(
        "https://open.shopee.com.br/auth?partner_id=1&state=abc",
      ),
    ).toBe(true);
  });

  it("rejects http (non-HTTPS)", () => {
    expect(
      isAllowedShopeeAuthorizationUrl("http://open.shopee.com.br/auth"),
    ).toBe(false);
  });

  it("rejects localhost", () => {
    expect(
      isAllowedShopeeAuthorizationUrl("https://localhost/auth"),
    ).toBe(false);
  });

  it("rejects a relative URL", () => {
    expect(isAllowedShopeeAuthorizationUrl("/auth")).toBe(false);
  });

  it("rejects embedded credentials", () => {
    expect(
      isAllowedShopeeAuthorizationUrl(
        "https://user:pass@open.shopee.com.br/auth",
      ),
    ).toBe(false);
  });

  it("rejects a fragment", () => {
    expect(
      isAllowedShopeeAuthorizationUrl("https://open.shopee.com.br/auth#x"),
    ).toBe(false);
  });

  it("rejects a lookalike subdomain", () => {
    expect(
      isAllowedShopeeAuthorizationUrl("https://evil.open.shopee.com.br/auth"),
    ).toBe(false);
  });

  it("rejects a host that merely contains the allowlisted host as a suffix trick", () => {
    expect(
      isAllowedShopeeAuthorizationUrl(
        "https://open.shopee.com.br.evil.com/auth",
      ),
    ).toBe(false);
  });

  it("rejects a different pathname on an allowlisted host", () => {
    expect(
      isAllowedShopeeAuthorizationUrl("https://open.shopee.com.br/auth/extra"),
    ).toBe(false);
  });

  it("rejects a malformed string", () => {
    expect(isAllowedShopeeAuthorizationUrl("not a url")).toBe(false);
  });
});
