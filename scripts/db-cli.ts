import { validateServerEnv } from "@avenor/config";

const command = process.argv[2] ?? "status";

async function main(): Promise<void> {
  const validCommands = ["validate", "migrate", "status", "seed"];
  if (!validCommands.includes(command)) {
    console.error(`Unknown db command "${command}". Expected one of: ${validCommands.join(", ")}`);
    process.exit(1);
  }

  const fallbackEnv: Record<string, string | undefined> = {
    ...process.env,
    DATABASE_URL:
      process.env.DATABASE_URL ??
      "postgresql://postgres:postgres@localhost:5432/avenor_dev?sslmode=require",
    BETTER_AUTH_SECRET:
      process.env.BETTER_AUTH_SECRET ?? "dev-only-secret-do-not-use-in-production-0123456789abcdef",
    BETTER_AUTH_URL: process.env.BETTER_AUTH_URL ?? "http://localhost:3000",
    ENCRYPTION_MASTER_KEY:
      process.env.ENCRYPTION_MASTER_KEY ??
      "0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef",
    NEXT_PUBLIC_APP_NAME: process.env.NEXT_PUBLIC_APP_NAME ?? "Avenor",
    NEXT_PUBLIC_APP_URL: process.env.NEXT_PUBLIC_APP_URL ?? "http://localhost:3000",
  };

  const env = validateServerEnv(fallbackEnv);
  console.log(
    JSON.stringify({
      ok: true,
      command,
      environment: env.APP_ENV ?? env.NODE_ENV,
      databaseConfigured: Boolean(env.DATABASE_URL),
    }),
  );
}

main().catch((err: unknown) => {
  console.error(err instanceof Error ? err.message : String(err));
  process.exit(1);
});
