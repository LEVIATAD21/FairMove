export interface PaymentProvider {
  authorize(amount: number, currency: string, metadata?: Record<string, any>): Promise<{
    transactionId: string;
    status: "authorized" | "failed";
    error?: string;
  }>;

  capture(transactionId: string, amount?: number): Promise<{
    transactionId: string;
    status: "captured" | "failed";
    error?: string;
  }>;

  refund(transactionId: string, amount?: number): Promise<{
    transactionId: string;
    status: "refunded" | "failed";
    error?: string;
  }>;

  getStatus(transactionId: string): Promise<{
    transactionId: string;
    status: "authorized" | "captured" | "failed" | "refunded";
    error?: string;
  }>;
}

type TransactionStatus = "authorized" | "captured" | "failed" | "refunded";

interface MockTransaction {
  amount: number;
  currency: string;
  status: TransactionStatus;
  metadata?: Record<string, any>;
}

function isPositiveAmount(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value) && value > 0;
}

/**
 * Provedor de pagamento simulado (MVP).
 *
 * Mantém uma máquina de estados estrita:
 *   authorized -> captured -> refunded
 * e valida valores. A implementação é em memória — trocar por um provedor real
 * (Stripe/Mercado Pago/PSP bancário) mantendo a interface `PaymentProvider`.
 */
export class MockPaymentProvider implements PaymentProvider {
  private transactions: Map<string, MockTransaction>;

  constructor() {
    this.transactions = new Map();
  }

  async authorize(
    amount: number,
    currency: string,
    metadata?: Record<string, any>
  ): Promise<{
    transactionId: string;
    status: "authorized" | "failed";
    error?: string;
  }> {
    if (!isPositiveAmount(amount)) {
      return {
        transactionId: "",
        status: "failed",
        error: "Amount must be a positive number",
      };
    }

    const transactionId = `mock_tx_${Date.now()}_${Math.random().toString(36).substring(2, 9)}`;

    this.transactions.set(transactionId, {
      amount,
      currency,
      status: "authorized",
      metadata,
    });

    return { transactionId, status: "authorized" };
  }

  async capture(
    transactionId: string,
    amount?: number
  ): Promise<{
    transactionId: string;
    status: "captured" | "failed";
    error?: string;
  }> {
    const transaction = this.transactions.get(transactionId);

    if (!transaction) {
      return { transactionId, status: "failed", error: "Transaction not found" };
    }

    if (transaction.status !== "authorized") {
      return {
        transactionId,
        status: "failed",
        error: `Cannot capture transaction in status "${transaction.status}"`,
      };
    }

    if (amount !== undefined) {
      if (!isPositiveAmount(amount)) {
        return { transactionId, status: "failed", error: "Invalid capture amount" };
      }
      if (amount > transaction.amount) {
        return {
          transactionId,
          status: "failed",
          error: "Capture amount exceeds authorized amount",
        };
      }
      transaction.amount = amount;
    }

    transaction.status = "captured";
    return { transactionId, status: "captured" };
  }

  async refund(
    transactionId: string,
    amount?: number
  ): Promise<{
    transactionId: string;
    status: "refunded" | "failed";
    error?: string;
  }> {
    const transaction = this.transactions.get(transactionId);

    if (!transaction) {
      return { transactionId, status: "failed", error: "Transaction not found" };
    }

    if (transaction.status === "refunded") {
      return { transactionId, status: "failed", error: "Transaction already refunded" };
    }

    if (transaction.status !== "captured") {
      return {
        transactionId,
        status: "failed",
        error: `Cannot refund transaction in status "${transaction.status}"`,
      };
    }

    if (amount !== undefined) {
      if (!isPositiveAmount(amount)) {
        return { transactionId, status: "failed", error: "Invalid refund amount" };
      }
      if (amount > transaction.amount) {
        return {
          transactionId,
          status: "failed",
          error: "Refund amount exceeds captured amount",
        };
      }
      if (amount < transaction.amount) {
        return {
          transactionId,
          status: "failed",
          error: "Partial refunds are not supported by the mock provider",
        };
      }
    }

    transaction.status = "refunded";
    return { transactionId, status: "refunded" };
  }

  async getStatus(
    transactionId: string
  ): Promise<{
    transactionId: string;
    status: TransactionStatus;
    error?: string;
  }> {
    const transaction = this.transactions.get(transactionId);

    if (!transaction) {
      return { transactionId, status: "failed", error: "Transaction not found" };
    }

    return { transactionId, status: transaction.status };
  }
}

/** Instância única usada pelo backend. */
export const paymentProvider: PaymentProvider = new MockPaymentProvider();
