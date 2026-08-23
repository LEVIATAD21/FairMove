import { db } from "../db";
import { fraud_events, risk_scores, users, rides } from "../db/schema";
import { eq, and } from "drizzle-orm";

export type RiskLevel = "LOW" | "MEDIUM" | "HIGH" | "CRITICAL";

export interface RiskCalculationResult {
  riskLevel: RiskLevel;
  score: number;
  events: FraudEvent[];
  recommendations: string[];
}

export class FraudEngine {
  private riskThresholds = {
    LOW: 0,
    MEDIUM: 30,
    HIGH: 70,
    CRITICAL: 90,
  };

  async calculateUserRisk(userId: string): Promise<RiskCalculationResult> {
    const events: FraudEvent[] = [];
    let score = 0;

    // 1. Device Risk Analysis
    const deviceEvents = await db.select().from(fraud_events).where(
      and(
        eq(fraud_events.userId, userId),
        eq(fraud_events.eventType, "device_risk")
      )
    );

    for (const event of deviceEvents) {
      const eventScore = event.score || 0;
      score += eventScore;
      events.push(event as FraudEvent);
    }

    // 2. Account Risk Analysis
    const accountEvents = await db.select().from(fraud_events).where(
      and(
        eq(fraud_events.userId, userId),
        eq(fraud_events.eventType, "account_risk")
      )
    );

    for (const event of accountEvents) {
      const eventScore = event.score || 0;
      score += eventScore;
      events.push(event as FraudEvent);
    }

    // 3. Ride Risk Analysis
    const rideEvents = await db.select().from(fraud_events).where(
      and(
        eq(fraud_events.rideId, null), // We'll calculate per ride
        // In a real implementation, we'd filter by specific ride
      )
    );

    // For MVP, we'll use a simplified approach
    // 4. Behavioral Risk Analysis
    const behavioralEvents = await db.select().from(fraud_events).where(
      and(
        eq(fraud_events.userId, userId),
        eq(fraud_events.eventType, "behavioral_risk")
      )
    );

    for (const event of behavioralEvents) {
      const eventScore = event.score || 0;
      score += eventScore;
      events.push(event as FraudEvent);
    }

    // Determine risk level
    let riskLevel: RiskLevel = "LOW";
    if (score >= this.riskThresholds.CRITICAL) {
      riskLevel = "CRITICAL";
    } else if (score >= this.riskThresholds.HIGH) {
      riskLevel = "HIGH";
    } else if (score >= this.riskThresholds.MEDIUM) {
      riskLevel = "MEDIUM";
    } else {
      riskLevel = "LOW";
    }

    // Cap the score at 100
    score = Math.min(score, 100);

    // Update or create risk score record
    const existing = db.select().from(risk_scores).where(
      eq(risk_scores.userId, userId)
    );

    if (existing.length > 0) {
      await db.update(risk_scores).set({
        overallScore: score,
        riskLevel,
        lastCalculatedAt: new Date(),
        calculationDetails: JSON.stringify({
          deviceRisk: this.extractDeviceRisk(deviceEvents),
          accountRisk: this.extractAccountRisk(accountEvents),
          behavioralRisk: this.extractBehavioralRisk(behavioralEvents),
        }),
        updatedAt: new Date(),
      }).where(eq(risk_scores.userId, userId));
    } else {
      await db.insert(risk_scores).values({
        id: uuidv4(),
        userId,
        overallScore: score,
        riskLevel,
        calculationDetails: JSON.stringify({
          deviceRisk: this.extractDeviceRisk(deviceEvents),
          accountRisk: this.extractAccountRisk(accountEvents),
          behavioralRisk: this.extractBehavioralRisk(behavioralEvents),
        }),
      });
    }

    return {
      riskLevel,
      score,
      events,
      recommendations: this.generateRecommendations(riskLevel, score),
    };
  }

  private extractDeviceRisk(events: any[]): any {
    if (events.length === 0) return "none";
    const highRisk = events.filter((e: any) => e.score && e.score >= 70);
    return { total: events.length, highRiskCount: highRisk.length };
  }

  private extractAccountRisk(events: any[]): any {
    if (events.length === 0) return "none";
    const highRisk = events.filter((e: any) => e.score && e.score >= 70);
    return { total: events.length, highRiskCount: highRisk.length };
  }

  private extractBehavioralRisk(events: any[]): any {
    if (events.length === 0) return "none";
    const highRisk = events.filter((e: any) => e.score && e.score >= 70);
    return { total: events.length, highRiskCount: highRisk.length };
  }

  private generateRecommendations(riskLevel: RiskLevel, score: number): string[] {
    const recommendations: string[] = [];

    if (riskLevel === "CRITICAL") {
      recommendations.push("Conta bloqueada - risco crítico detectado");
      recommendations.push("Verificação de identidade obrigatória");
      recommendations.push("Não permitir novas corridas até revisão");
    } else if (riskLevel === "HIGH") {
      recommendations.push("Monitoramento reforçado");
      recommendations.push("Verificação de documento de identidade");
      recommendations.push("Limitar operações até validação");
    } else if (riskLevel === "MEDIUM") {
      recommendations.push("Monitoramento padrão");
      recommendations.push("Verificar padrões de uso");
    } else {
      recommendations.push("Nenhuma ação necessária");
    }

    if (score >= 50) {
      recommendations.push("Analisar transações financeiras recentes");
    }

    return recommendations;
  }

  async registerEvent(
    userId: string,
    rideId: string | null,
    eventType: string,
    riskLevel: RiskLevel,
    score: number,
    description: string,
    metadata?: Record<string, any>
  ): Promise<void> {
    await db.insert(fraud_events).values({
      id: uuidv4(),
      userId,
      rideId,
      eventType,
      riskLevel,
      score,
      description,
      metadata: metadata ? JSON.stringify(metadata) : null,
    });
  }
}

export const fraudEngine = new FraudEngine();