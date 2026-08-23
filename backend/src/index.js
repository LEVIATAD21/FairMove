import "dotenv/config";
import express from "express";

const app = express();
const port = process.env.PORT || 4000;

app.use(express.json());

app.get("/health", (_req, res) => {
  res.json({ status: "ok", service: "fairmove-backend" });
});

app.listen(port, () => {
  console.log(`FairMove backend running on port ${port}`);
});