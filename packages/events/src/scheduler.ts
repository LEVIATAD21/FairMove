import { CronJob } from "cron";
import { db, events } from "@fairmove/shared-db";
import { eq, and, lte, gte } from "drizzle-orm";
import { recalculateLeaderboard } from "./engine/scoring-engine";

interface JobConfig {
  timezone?: string;
}

class EventScheduler {
  private jobs: Map<string, CronJob> = new Map();

  async start(): Promise<void> {
    // Job diário às 03:00 para recalcular leaderboards de eventos running
    const dailyJob = new CronJob("0 3 * * *", async () => {
      console.log("[EventScheduler] Iniciando recálculo diário de leaderboards...");
      await this.recalculateActiveLeaderboards();
    }, null, true, "America/Sao_Paulo");

    this.jobs.set("daily-recalculate", dailyJob);
    console.log("[EventScheduler] Agendador iniciado (diário 03:00 BRT)");
  }

  async recalculateActiveLeaderboards(): Promise<void> {
    const now = new Date();
    try {
      const activeEvents = await db
        .select()
        .from(events)
        .where(and(eq(events.status, "running"), lte(events.startDate, now), gte(events.endDate, now)));

      if (activeEvents.length === 0) {
        console.log("[EventScheduler] Nenhum evento ativo para recalcular");
        return;
      }

      for (const event of activeEvents) {
        try {
          console.log(`[EventScheduler] Recalculando leaderboard do evento ${event.id} (${event.title})`);
          await recalculateLeaderboard(event.id);
          console.log(`[EventScheduler] Leaderboard do evento ${event.id} atualizado`);
        } catch (error) {
          console.error(`[EventScheduler] Erro ao recalcular evento ${event.id}:`, error instanceof Error ? (error.stack ?? error.message) : String(error));
        }
      }
    } catch (error) {
      console.error("[EventScheduler] Erro geral no recálculo:", error instanceof Error ? (error.stack ?? error.message) : String(error));
    }
  }

  stop(): void {
    for (const [name, job] of this.jobs) {
      job.stop();
      console.log(`[EventScheduler] Job ${name} parado`);
    }
    this.jobs.clear();
  }
}

export const eventScheduler = new EventScheduler();