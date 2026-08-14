import { Hono } from "hono";
import type { AppBindings } from "../lib/auth";
import { requireAuth } from "../lib/auth";
import { AppError } from "../lib/errors";

const download = new Hono<AppBindings>();
download.use("*", requireAuth);

download.get("/", async (c) => {
  const tenant = c.get("tenant");
  const key = c.req.query("key");
  if (!key) throw AppError.badRequest("key query parameter is required");

  // Enforce tenant scoping of the R2 key.
  const prefix = `tenants/${tenant.id}/`;
  if (!key.startsWith(prefix)) throw AppError.forbidden("You cannot access this object");

  const object = await c.env.DOCS.get(key);
  if (!object) throw AppError.notFound("Object not found");

  const isPdf = key.endsWith(".pdf");
  return new Response(object.body, {
    headers: {
      "Content-Type": isPdf ? "application/pdf" : "image/png",
      "Content-Disposition": isPdf ? `inline; filename="${key.split("/").pop()}"` : `attachment; filename="${key.split("/").pop()}"`,
      "Cache-Control": "private, max-age=300",
    },
  });
});

export default download;
