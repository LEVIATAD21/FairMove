import "dotenv/config";
import express, { Express, Request, Response } from "express";
import helmet from "helmet";
import cors from "cors";
import morgan from "morgan";
import rateLimit from "express-rate-limit";
import { authRouter } from "../../packages/auth/src/routes";
import { usersRouter } from "../../packages/users/src/routes";
import { rideRouter } from "../../packages/rides/src/routes";
import { matchingRouter } from "../../packages/matching/src/routes";
import { pricingRouter } from "../../packages/pricing/src/routes";
import { promotionRouter } from "../../packages/promotions/src/routes";
import { paymentRouter } from "../../packages/payments/src/routes";
import { walletRouter } from "../../packages/wallets/src/routes";
import { reserveRouter } from "../../packages/reserves/src/routes";
import { safetyRouter } from "../../packages/safety/src/routes";
import { fraudRouter } from "../../packages/fraud/src/routes";
import { subscriptionRouter } from "../../packages/subscriptions/src/routes";

const app: Express = express();
const port: number = Number(process.env.PORT) || 4000;

app.use(helmet());
app.use(cors({ origin: process.env.CORS_ORIGIN || "http://localhost:3000" }));
app.use(morgan("combined"));

const limiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 100,
  message: { error: "Too many requests from this IP, please try again later." },
});
app.use("/api/", limiter);

app.use(express.json({ limit: "10kb" }));
app.use(express.urlencoded({ extended: false }));

app.get("/health", (_req: Request, res: Response) => {
  res.json({ status: "ok", service: "fairmove-backend" });
});

app.use("/api/auth", authRouter);
app.use("/api/users", usersRouter);
app.use("/api/rides", rideRouter);
app.use("/api/matching", matchingRouter);
app.use("/api/pricing", pricingRouter);
app.use("/api/promotions", promotionRouter);
app.use("/api/payments", paymentRouter);
app.use("/api/wallets", walletRouter);
app.use("/api/reserves", reserveRouter);
app.use("/api/safety", safetyRouter);
app.use("/api/fraud", fraudRouter);
app.use("/api/subscriptions", subscriptionRouter);

app.use((_req: Request, res: Response) => {
  res.status(404).json({ error: "Not found" });
});

app.use((err: any, _req: Request, res: Response, _next: any) => {
  console.error(err.stack);
  res.status(500).json({ error: "Internal server error" });
});

app.listen(port, () => {
  console.log(`FairMove backend running on port ${port}`);
});

export { app };
