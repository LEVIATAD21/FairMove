import { createHash, createHmac, randomUUID, timingSafeEqual } from "node:crypto";
import { and, eq } from "drizzle-orm";
import { db, walletDeposits } from "@fairmove/shared-db";
import { walletEngine } from "../../wallets/src/engine/wallet-engine";

const API = "https://api.mercadopago.com";

export class MercadoPagoNotConfiguredError extends Error {
  constructor() {
    super("Mercado Pago Pix is not configured for this environment.");
    this.name = "MercadoPagoNotConfiguredError";
  }
}

export class MercadoPagoRequestError extends Error {
  constructor() {
    super("Mercado Pago request failed or returned an invalid response.");
    this.name = "MercadoPagoRequestError";
  }
}

export class WalletDepositConflictError extends Error {
  constructor() {
    super("The idempotency key was already used for a different deposit.");
    this.name = "WalletDepositConflictError";
  }
}

type MercadoPagoPayment = {
  id: string;
  status: string;
  transaction_amount: number;
  currency_id: string;
  payment_method_id: string;
  external_reference?: string | null;
  live_mode?: boolean;
  metadata?: Record<string, unknown>;
  point_of_interaction?: {
    transaction_data?: {
      qr_code?: string;
      qr_code_base64?: string;
      ticket_url?: string;
    };
  };
};

export type PixDepositResponse = {
  depositId: string;
  amountCents: number;
  currency: "BRL";
  status: string;
  qrCode: string | null;
  qrCodeBase64: string | null;
  ticketUrl: string | null;
  expiresAt: string | null;
};

export function isMercadoPagoConfigured(): boolean {
  const accessToken = process.env.MP_ACCESS_TOKEN?.trim();
  const webhookSecret = process.env.MP_WEBHOOK_SECRET?.trim();
  const webhookUrl = process.env.MERCADO_PAGO_WEBHOOK_URL?.trim();
  if (!accessToken || !webhookSecret || !webhookUrl) return false;

  try {
    const parsed = new URL(webhookUrl);
    if (process.env.NODE_ENV === "production" && parsed.protocol !== "https:") return false;
    return parsed.protocol === "https:" || process.env.NODE_ENV !== "production";
  } catch {
    return false;
  }
}

function requireMercadoPagoConfig(): { accessToken: string; webhookUrl: string } {
  if (!isMercadoPagoConfigured()) throw new MercadoPagoNotConfiguredError();
  return {
    accessToken: process.env.MP_ACCESS_TOKEN!.trim(),
    webhookUrl: process.env.MERCADO_PAGO_WEBHOOK_URL!.trim(),
  };
}

function parsePayment(value: unknown): MercadoPagoPayment {
  if (!value || typeof value !== "object") throw new MercadoPagoRequestError();
  const p = value as Record<string, any>;
  if (
    !(typeof p.id === "string" || typeof p.id === "number") ||
    typeof p.status !== "string" ||
    typeof p.transaction_amount !== "number" ||
    typeof p.currency_id !== "string" ||
    typeof p.payment_method_id !== "string"
  ) throw new MercadoPagoRequestError();

  const transactionData = p.point_of_interaction?.transaction_data;
  return {
    id: String(p.id),
    status: p.status,
    transaction_amount: p.transaction_amount,
    currency_id: p.currency_id,
    payment_method_id: p.payment_method_id,
    external_reference: typeof p.external_reference === "string" ? p.external_reference : null,
    live_mode: typeof p.live_mode === "boolean" ? p.live_mode : undefined,
    metadata: p.metadata && typeof p.metadata === "object" ? p.metadata as Record<string, unknown> : undefined,
    point_of_interaction: transactionData && typeof transactionData === "object"
      ? {
          transaction_data: {
            qr_code: typeof transactionData.qr_code === "string" ? transactionData.qr_code : undefined,
            qr_code_base64: typeof transactionData.qr_code_base64 === "string" ? transactionData.qr_code_base64 : undefined,
            ticket_url: typeof transactionData.ticket_url === "string" ? transactionData.ticket_url : undefined,
          },
        }
      : undefined,
  };
}

async function providerRequest(url: string, init: RequestInit): Promise<unknown> {
  const accessToken = process.env.MP_ACCESS_TOKEN?.trim();
  if (!accessToken) throw new MercadoPagoNotConfiguredError();

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 12_000);
  try {
    const response = await fetch(url, {
      ...init,
      headers: {
        Authorization: `Bearer ${accessToken}`,
        Accept: "application/json",
        "Content-Type": "application/json",
        ...((init.headers as Record<string, string> | undefined) ?? {}),
      },
      signal: controller.signal as unknown as RequestInit["signal"],
    });
    if (!response.ok) throw new MercadoPagoRequestError();
    try {
      return await response.json();
    } catch {
      throw new MercadoPagoRequestError();
    }
  } catch (error) {
    if (error instanceof MercadoPagoRequestError || error instanceof MercadoPagoNotConfiguredError) throw error;
    throw new MercadoPagoRequestError();
  } finally {
    clearTimeout(timeout);
  }
}

function normalizeCpf(value: string): string {
  const digits = value.replace(/\D/g, "");
  if (digits.length !== 11 || /^(\d)\1{10}$/.test(digits)) {
    throw new TypeError("A valid Brazilian CPF is required.");
  }
  const calculate = (slice: string, weightStart: number) => {
    const sum = [...slice].reduce((total, digit, index) => total + Number(digit) * (weightStart - index), 0);
    const remainder = (sum * 10) % 11;
    return remainder === 10 ? 0 : remainder;
  };
  const first = calculate(digits.slice(0, 9), 10);
  const second = calculate(digits.slice(0, 10), 11);
  if (first !== Number(digits[9]) || second !== Number(digits[10])) {
    throw new TypeError("A valid Brazilian CPF is required.");
  }
  return digits;
}

function idempotencyDigest(userId: string, clientKey: string): string {
  return createHash("sha256").update(`fairmove-pix-deposit:${userId}:${clientKey}`).digest("hex");
}

function presentDeposit(deposit: typeof walletDeposits.$inferSelect): PixDepositResponse {
  return {
    depositId: deposit.id,
    amountCents: deposit.amountCents,
    currency: "BRL",
    status: deposit.status,
    qrCode: deposit.qrCode,
    qrCodeBase64: deposit.qrCodeBase64,
    ticketUrl: deposit.ticketUrl,
    expiresAt: deposit.expiresAt?.toISOString() ?? null,
  };
}

/**
 * Creates or retrieves an idempotent Pix intent. Only the provider's verified
 * webhook may move money into the wallet; this function never credits balance.
 */
export async function createPixDeposit(input: {
  userId: string;
  payerEmail: string;
  payerCpf: string;
  amountCents: number;
  idempotencyKey: string;
}): Promise<PixDepositResponse> {
  const { webhookUrl } = requireMercadoPagoConfig();
  if (!Number.isSafeInteger(input.amountCents) || input.amountCents < 500 || input.amountCents > 500_000) {
    throw new RangeError("Pix deposits must be between R$ 5.00 and R$ 5,000.00.");
  }
  if (!/^[A-Za-z0-9._:-]{16,128}$/.test(input.idempotencyKey)) {
    throw new TypeError("A valid idempotency key is required.");
  }
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(input.payerEmail)) {
    throw new TypeError("A valid payer email is required.");
  }
  const payerCpf = normalizeCpf(input.payerCpf);

  const key = idempotencyDigest(input.userId, input.idempotencyKey);
  const inserted = await db.insert(walletDeposits).values({
    id: randomUUID(),
    userId: input.userId,
    amountCents: input.amountCents,
    currency: "BRL",
    provider: "mercadopago",
    status: "pending",
    idempotencyKey: key,
  }).onConflictDoNothing({ target: walletDeposits.idempotencyKey }).returning();

  let deposit = inserted[0];
  if (!deposit) {
    const existing = await db.select().from(walletDeposits).where(eq(walletDeposits.idempotencyKey, key)).limit(1);
    deposit = existing[0];
  }
  if (!deposit) throw new MercadoPagoRequestError();
  if (deposit.userId !== input.userId || deposit.amountCents !== input.amountCents) {
    throw new WalletDepositConflictError();
  }
  if (deposit.status !== "pending" || (deposit.qrCode && deposit.qrCodeBase64 && deposit.ticketUrl)) {
    return presentDeposit(deposit);
  }

  // Repeated attempts reuse deposit.id as Mercado Pago's X-Idempotency-Key.
  const body = {
    transaction_amount: Number((deposit.amountCents / 100).toFixed(2)),
    description: "Recarga de carteira FairMove via Pix",
    payment_method_id: "pix",
    payer: {
      email: input.payerEmail.trim().toLowerCase(),
      identification: { type: "CPF", number: payerCpf },
    },
    external_reference: `fairmove-deposit:${deposit.id}`,
    notification_url: webhookUrl,
    metadata: {
      fairmove_deposit_id: deposit.id,
      fairmove_user_id: deposit.userId,
      fairmove_amount_cents: deposit.amountCents,
    },
  };

  const raw = await providerRequest(`${API}/v1/payments`, {
    method: "POST",
    headers: { "X-Idempotency-Key": deposit.id },
    body: JSON.stringify(body),
  });
  const payment = parsePayment(raw);
  const txData = payment.point_of_interaction?.transaction_data;
  if (
    payment.currency_id !== "BRL" ||
    payment.payment_method_id !== "pix" ||
    payment.external_reference !== `fairmove-deposit:${deposit.id}` ||
    String(payment.metadata?.fairmove_user_id ?? "") !== input.userId ||
    String(payment.metadata?.fairmove_deposit_id ?? "") !== deposit.id ||
    Number(payment.metadata?.fairmove_amount_cents) !== deposit.amountCents ||
    !txData?.qr_code ||
    !txData.qr_code_base64 ||
    !txData.ticket_url
  ) {
    throw new MercadoPagoRequestError();
  }

  const updated = await db.update(walletDeposits).set({
    providerPaymentId: payment.id,
    qrCode: txData.qr_code,
    qrCodeBase64: txData.qr_code_base64,
    ticketUrl: txData.ticket_url,
    updatedAt: new Date(),
  }).where(and(eq(walletDeposits.id, deposit.id), eq(walletDeposits.userId, input.userId))).returning();
  if (updated.length !== 1) throw new MercadoPagoRequestError();
  return presentDeposit(updated[0]);
}

/** Constant-time validation of Mercado Pago's HMAC-SHA256 notification signature. */
export function verifyMercadoPagoWebhookSignature(
  signature: string | undefined,
  requestId: string | undefined,
  dataId: string | undefined,
  secret = process.env.MP_WEBHOOK_SECRET?.trim()
): boolean {
  if (!signature || !requestId || !dataId || !secret) return false;
  const pairs = new Map<string, string>();
  for (const segment of signature.split(",")) {
    const separator = segment.indexOf("=");
    if (separator <= 0) continue;
    pairs.set(segment.slice(0, separator).trim(), segment.slice(separator + 1).trim());
  }
  const timestamp = pairs.get("ts");
  const receivedHex = pairs.get("v1");
  if (!timestamp || !/^\d+$/.test(timestamp) || !receivedHex || !/^[a-f0-9]{64}$/i.test(receivedHex)) return false;

  const manifest = `id:${dataId.toLowerCase()};request-id:${requestId};ts:${timestamp};`;
  const expected = createHmac("sha256", secret).update(manifest).digest();
  const received = Buffer.from(receivedHex, "hex");
  return received.length === expected.length && timingSafeEqual(received, expected);
}

export type MercadoPagoWebhookResult = "ignored" | "pending" | "credited" | "already_processed" | "rejected";

export async function processMercadoPagoPaymentWebhook(dataId: string): Promise<MercadoPagoWebhookResult> {
  requireMercadoPagoConfig();
  const raw = await providerRequest(`${API}/v1/payments/${encodeURIComponent(dataId)}`, { method: "GET" });
  const payment = parsePayment(raw);
  if (payment.id !== dataId) throw new MercadoPagoRequestError();
  if (process.env.NODE_ENV === "production" && payment.live_mode !== true) {
    throw new MercadoPagoRequestError();
  }

  const depositId = String(payment.metadata?.fairmove_deposit_id ?? "");
  const userId = String(payment.metadata?.fairmove_user_id ?? "");
  const amountCents = Number(payment.metadata?.fairmove_amount_cents);
  if (
    !depositId ||
    !userId ||
    !Number.isSafeInteger(amountCents) ||
    payment.currency_id !== "BRL" ||
    payment.payment_method_id !== "pix" ||
    payment.external_reference !== `fairmove-deposit:${depositId}` ||
    Math.round(payment.transaction_amount * 100) !== amountCents
  ) throw new MercadoPagoRequestError();

  const deposits = await db.select().from(walletDeposits).where(eq(walletDeposits.id, depositId)).limit(1);
  const deposit = deposits[0];
  if (
    !deposit ||
    deposit.userId !== userId ||
    deposit.amountCents !== amountCents ||
    (deposit.providerPaymentId !== null && deposit.providerPaymentId !== payment.id)
  ) throw new MercadoPagoRequestError();

  if (payment.status !== "approved") {
    if (payment.status === "rejected" || payment.status === "cancelled" || payment.status === "canceled") {
      await db.update(walletDeposits).set({
        status: payment.status === "rejected" ? "rejected" : "cancelled",
        providerPaymentId: payment.id,
        updatedAt: new Date(),
      }).where(and(eq(walletDeposits.id, deposit.id), eq(walletDeposits.status, "pending")));
      return "rejected";
    }
    return "pending";
  }

  const didCredit = await db.transaction(async (tx) => {
    const locked = await tx.select().from(walletDeposits).where(eq(walletDeposits.id, deposit.id)).for("update");
    const current = locked[0];
    if (!current) throw new MercadoPagoRequestError();
    if (current.status === "approved") {
      if (current.providerPaymentId !== payment.id) throw new MercadoPagoRequestError();
      return false;
    }
    if (current.status !== "pending") return false;
    if (current.providerPaymentId && current.providerPaymentId !== payment.id) throw new MercadoPagoRequestError();

    const now = new Date();
    const claimed = await tx.update(walletDeposits).set({
      status: "approved",
      providerPaymentId: payment.id,
      approvedAt: now,
      updatedAt: now,
    }).where(and(eq(walletDeposits.id, current.id), eq(walletDeposits.status, "pending"))).returning({ id: walletDeposits.id });
    if (claimed.length !== 1) return false;

    await walletEngine.creditCents(current.userId, current.amountCents, {
      idempotencyKey: `mercadopago:pix:deposit:${current.id}`,
      description: "Recarga de carteira via Pix",
      metadata: {
        provider: "mercadopago",
        providerPaymentId: payment.id,
        depositId: current.id,
      },
    }, tx);
    return true;
  });

  return didCredit ? "credited" : "already_processed";
}
