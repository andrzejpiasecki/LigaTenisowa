import { defineConfig } from "prisma/config";
import { config as loadEnv } from "dotenv";
import { getScopedDatabaseUrl } from "./src/lib/database-url";

loadEnv({ path: ".env.local" });
loadEnv();

export default defineConfig({
  schema: "prisma/schema.prisma",
  migrations: {
    path: "prisma/migrations",
  },
  datasource: {
    url: getScopedDatabaseUrl({ unpooled: Boolean(process.env["DATABASE_URL_UNPOOLED"]) }),
  },
});
