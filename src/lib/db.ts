import { PrismaPg } from "@prisma/adapter-pg";
import { PrismaClient } from "@prisma/client";
import { Pool } from "pg";
import { getDatabaseSchema, getScopedDatabaseUrl } from "@/lib/database-url";

const globalForPrisma = globalThis as unknown as {
  prisma?: PrismaClient;
  prismaConfigKey?: string;
};

function createPrismaClient(connectionString: string, schema: string) {
  const configKey = `${connectionString}|${schema}`;

  const prisma = new PrismaClient({
    adapter: new PrismaPg(
      new Pool({
        connectionString,
        options: `-c search_path=${schema}`,
      }),
    ),
    log: process.env.NODE_ENV === "development" ? ["query", "error", "warn"] : ["error"],
  });

  return { prisma, configKey };
}

function getPrismaConfig() {
  const connectionString = getScopedDatabaseUrl({ unpooled: true });
  const schema = getDatabaseSchema();

  return { connectionString, schema, configKey: `${connectionString}|${schema}` };
}

const hasRequiredDelegates = (client: PrismaClient | undefined) => {
  if (!client) return false;
  const prismaClient = client as unknown as Record<string, unknown>;
  return "scheduledMatch" in prismaClient;
};

export function getDb() {
  const { connectionString, schema, configKey } = getPrismaConfig();

  if (
    hasRequiredDelegates(globalForPrisma.prisma)
    && globalForPrisma.prismaConfigKey === configKey
  ) {
    return globalForPrisma.prisma!;
  }

  const { prisma } = createPrismaClient(connectionString, schema);

  if (process.env.NODE_ENV !== "production") {
    globalForPrisma.prisma = prisma;
    globalForPrisma.prismaConfigKey = configKey;
  }

  return prisma;
}
