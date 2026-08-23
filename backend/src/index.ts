import "dotenv/config";
import express, { Express, Request, Response } from "express";
import helmet from "helmet";
import cors from "cors";
import morgan from "morgan";
import rateLimit from "express-rate-limit";
import { authRouter } from "../packages/auth/src/routes";
import { userRouter } from "../packages/users/srcroutes";
import { passengerRouter } from "../packages/passengers/srcroutes";
import { driverRouter } from "../packages/drivers/srcroutes";
import { vehicleRouter } from "../packages/vehicles/srcroutes";
import { rideRouter } from "../packages/rides/srcroutes";
import { matchingRouter } from "../packages/matching/srcroutes";
import { pricingRouter } from "../packages/pricing/srcroutes";
import { promotionRouter } from "../packages/promotions/srcroutes";
import { paymentRouter } from "../packages/payments/srcroutes";
import { walletRouter } from "../packages/wallets/srcroutes";
import { reserveRouter } from "../packages/reserves/srcroutes";
import { notificationRouter } from "../packages/notifications/srcroutes";
import { safetyRouter } from "../packages/safety/srcroutes";
import { realtimeRouter } from "../packages/realtime/srcroutes";
import { supportRouter } from "../packages/support/srcroutes";
import { fraudRouter } from "../packages/fraud/srcroutes";
import { b2bRouter } from "../packages/b2b/srcroutes";
import { subscriptionRouter } from "../packages/subscriptions/srcroutes";

const app: Express = express();
const port: number = process.env.PORT || 3000;

// Security middleware
app.use(helmet());
app.use(cors({ origin: process.env.CORS_ORIGIN || "http://localhost:3000" }));
app.use(morgan("combined"));

// Rate limiting
const limiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 100,
  message: { error: "Too many requests from this IP, please try again later." },
});
app.use("/api/", limiter);

// Body parsing
app.use(express.json({ limit: "10kb" }));
app.use(express.urlencoded({ extended: false }));

// Health check
app.get("/health", (_req: Request, res: Response) => {
  res.json({ status: "ok", service: "fairmove-backend" });
});

// API routes
app.use("/api/auth", authRouter);
app.use("/api/users", userRouter);
app.use("/api/passengers", passengerRouter);
app.use("/api/drivers", driverRouter);
app.use("/api/vehicles", vehicleRouter);
app.use("/api/rides", rideRouter);
app.use("/api/matching", matchingRouter);
app.use("/api/pricing", pricingRouter);
app.use("/api/promotions", promotionRouter);
app.use("/api/payments", paymentRouter);
app.use("/api/wallets", walletRouter);
app.use("/api/reserves", reserveRouter);
app.use("/api/realtime", realtimeRouter);
app.use("/api/notifications", notificationRouter);
app.use("/api/safety", safetyRouter);
app.use("/api/support", supportRouter);
app.use("/api/fraud", fraudRouter);
app.use("/api/b2b", b2bRouter);
app.use("/api/subscriptions", subscriptionRouter);

// 404 handler
app.use((_req: Request, res: Response) => {
  res.status(404).json({ error: "Not found" });
});

// Error handler
app.use((err: any, _req: Request, res: Response, _next: any) => {
  console.error(err.stack);
  res.status(500).json({ error: "Internal server error" });
});

app.listen(port, () => {
  console.log(`FairMove backend running on port ${port}`);
});

export { app };
