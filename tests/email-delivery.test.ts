import {
  EmailDeliveryError,
  EmailDeliveryNotConfiguredError,
  isEmailDeliveryConfigured,
  sendPasswordResetEmail,
  sendVerificationEmail,
} from "../packages/auth/src/email-delivery";

const originalApiKey = process.env.RESEND_API_KEY;
const originalFrom = process.env.EMAIL_FROM;

function restoreEnv(name: string, value: string | undefined): void {
  if (value === undefined) delete process.env[name];
  else process.env[name] = value;
}

describe("transactional email delivery", () => {
  beforeEach(() => {
    process.env.RESEND_API_KEY = "test-resend-key-not-real";
    process.env.EMAIL_FROM = "FairMove Tests <tests@example.invalid>";
  });

  afterEach(() => {
    jest.restoreAllMocks();
    restoreEnv("RESEND_API_KEY", originalApiKey);
    restoreEnv("EMAIL_FROM", originalFrom);
  });

  test("reports missing provider configuration without a network request", async () => {
    delete process.env.RESEND_API_KEY;
    expect(isEmailDeliveryConfigured()).toBe(false);
    await expect(sendVerificationEmail("person@example.invalid", "123456"))
      .rejects.toBeInstanceOf(EmailDeliveryNotConfiguredError);
  });

  test("sends verification email through the authenticated HTTPS provider API", async () => {
    const fetchMock = jest.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response(JSON.stringify({ id: "email_test_123" }), { status: 200 })
    );

    await sendVerificationEmail("person@example.invalid", "123456");

    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url, init] = fetchMock.mock.calls[0];
    expect(String(url)).toBe("https://api.resend.com/emails");
    expect(init?.method).toBe("POST");
    expect((init?.headers as Record<string, string>).Authorization).toBe("Bearer test-resend-key-not-real");
    const body = JSON.parse(String(init?.body)) as { to: string[]; subject: string; html: string; text: string };
    expect(body.to).toEqual(["person@example.invalid"]);
    expect(body.subject).toContain("FairMove");
    expect(body.text).toContain("123456");
    expect(body.html).toContain("#d4af37");
  });

  test("escapes dynamic HTML and does not pass raw markup through", async () => {
    const fetchMock = jest.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response(JSON.stringify({ id: "email_test_456" }), { status: 200 })
    );
    await sendVerificationEmail("person@example.invalid", "<img src=x>");
    const body = JSON.parse(String(fetchMock.mock.calls[0][1]?.body)) as { html: string };
    expect(body.html).toContain("&lt;img src=x&gt;");
    expect(body.html).not.toContain("<p style=\"font-size:32px;letter-spacing:8px;color:#d4af37;font-weight:700\"><img");
  });

  test("surfaces provider failures as a sanitized error", async () => {
    jest.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response("private provider diagnostic", { status: 403 })
    );

    await expect(sendPasswordResetEmail("person@example.invalid", "a".repeat(64)))
      .rejects.toBeInstanceOf(EmailDeliveryError);
    try {
      await sendPasswordResetEmail("person@example.invalid", "a".repeat(64));
    } catch (error) {
      expect(String(error)).not.toContain("private provider diagnostic");
      expect(String(error)).not.toContain("test-resend-key-not-real");
    }
  });
});
