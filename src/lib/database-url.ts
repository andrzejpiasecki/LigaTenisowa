const DEFAULT_DATABASE_SCHEMA = "liga_tenisowa";

function applySchemaToUrl(connectionString: string, schema: string) {
  const url = new URL(connectionString);
  url.searchParams.set("schema", schema);
  return url.toString();
}

export function getDatabaseSchema() {
  return process.env.DATABASE_SCHEMA?.trim() || DEFAULT_DATABASE_SCHEMA;
}

export function getScopedDatabaseUrl(options?: { unpooled?: boolean }) {
  const key = options?.unpooled ? "DATABASE_URL_UNPOOLED" : "DATABASE_URL";
  const connectionString = process.env[key];

  if (!connectionString) {
    throw new Error(`${key} is not set.`);
  }

  return applySchemaToUrl(connectionString, getDatabaseSchema());
}
