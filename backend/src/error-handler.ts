import type { NextFunction, Request, Response } from "express";

/**
 * Error handler central do backend (Express exige4 args).
 *
 * Mapeia erros de cliente para status corretos em vez de deixar cair em500:
 * - SyntaxError com body / entity.parse.failed →400 JSON malformado;
 * - entity.too.large (express.json limit10kb) →413;
 * - charset/encoding não suportado →415.
 *
 * Qualquer outro erro continua500 com corpo genérico (sem vazar stack).
 * Exportado separadamente para ser coberto por teste automatizado.
 */
export function errorHandler(
  err: unknown,
  _req: Request,
  res: Response,
  next: NextFunction
): void {
  if (res.headersSent) {
    next(err);
    return;
  }
  if (err instanceof SyntaxError && "body" in err) {
    res.status(400).json({ error: "Malformed JSON body" });
    return;
  }
  const errType = (err as { type?: string } | null)?.type;
  if (errType === "entity.too.large") {
    res.status(413).json({ error: "Payload too large" });
    return;
  }
  if (errType === "entity.parse.failed") {
    res.status(400).json({ error: "Malformed JSON body" });
    return;
  }
  if (errType === "charset.unsupported" || errType === "encoding.unsupported") {
    res.status(415).json({ error: "Unsupported charset or encoding" });
    return;
  }
  const message = err instanceof Error ? err.message : "Internal server error";
  console.error("Unhandled error:", message);
  res.status(500).json({ error: "Internal server error" });
}
