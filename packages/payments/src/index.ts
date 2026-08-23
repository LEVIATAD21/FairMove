export * from "./provider";

// Payment provider interface
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

// Mock payment provider for MVP
export class MockPaymentProvider implements PaymentProvider {
  private transactions: Map<string, {
    amount: number;
    currency: string;
    status: "authorized" | "captured" | "failed" | "refunded";
    metadata?: Record<string, any>;
  }>;

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
    const transactionId = `mock_tx_${Date.now()}_${Math.random().toString(36).substring(2, 9)}`;

    this.transactions.set(transactionId, {
      amount,
      currency,
      status: "authorized",
      metadata,
    });

    return {
      transactionId,
      status: "authorized",
    };
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
      return {
        transactionId,
        status: "failed",
        error: "Transaction not found",
      };
    }

    if (transaction.status !== "authorized") {
      return {
        transactionId,
        status: "failed",
        error: "Transaction not authorized",
      };
    }

    transaction.status = "captured";

    return {
      transactionId,
      status: "captured",
    };
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
      return {
        transactionId,
        status: "failed",
        error: "Transaction not found",
      };
    }

    transaction.status = "refunded";

    return {
      transactionId,
      status: "refunded",
    };
  }

  async getStatus(
    transactionId: string
  ): Promise<{
    transactionId: string;
    status: "authorized" | "captured" | "failed" | "refunded";
    error?: string;
  }> {
    const transaction = this.transactions.get(transactionId);

    if (!transaction) {
      return {
        transactionId,
        status: "failed",
        error: "Transaction not found",
      };
    }

    return {
      transactionId,
      status: transaction.status,
    };
  }
}