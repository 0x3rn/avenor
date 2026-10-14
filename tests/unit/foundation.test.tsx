import "@testing-library/jest-dom/vitest";
import {
  assertNonProductionDestructiveAction,
  validateClientEnv,
  validateServerEnv,
} from "@avenor/config";
import {
  AppError,
  AVENOR_UX_STATES,
  canRenderNumericValue,
  ERROR_CODES,
  redactSensitiveText,
  roleHasPermission,
  UX_STATE_DESCRIPTORS,
} from "@avenor/types";
import {
  Badge,
  Button,
  DataTable,
  EmptyState,
  ErrorState,
  FormField,
  MetricCard,
  ProgressIndicator,
  SIGNAL_ATLAS_COLORS,
  SIGNAL_ATLAS_GEOMETRY,
  SIGNAL_ATLAS_SPACING_SCALE,
  TextInput,
  WarningBanner,
} from "@avenor/ui";
import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";

const VALID_DEV_ENV = {
  NODE_ENV: "development",
  APP_ENV: "development",
  DATABASE_URL: "postgresql://user:pass@localhost:5432/avenor_dev?sslmode=require",
  BETTER_AUTH_SECRET: "dev-only-secret-do-not-use-in-production-0123456789abcdef",
  BETTER_AUTH_URL: "http://localhost:3000",
  ENCRYPTION_MASTER_KEY: "0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef",
  NEXT_PUBLIC_APP_NAME: "Avenor",
  NEXT_PUBLIC_APP_URL: "http://localhost:3000",
};

function withServerRuntime<T>(fn: () => T): T {
  const originalWindow = globalThis.window;
  // Simulate Node.js server runtime inside jsdom test worker
  Reflect.deleteProperty(globalThis, "window");
  try {
    return fn();
  } finally {
    globalThis.window = originalWindow;
  }
}

describe("THE-112: @avenor/config runtime environment validation", () => {
  it("blocks validateServerEnv when invoked inside a browser runtime", () => {
    expect(() => validateServerEnv(VALID_DEV_ENV)).toThrowError(
      /Security boundary violation: validateServerEnv cannot be accessed in a browser runtime/,
    );
  });

  it("validates a complete development server environment on the server", () => {
    const parsed = withServerRuntime(() => validateServerEnv(VALID_DEV_ENV));
    expect(parsed.NODE_ENV).toBe("development");
    expect(parsed.NEXT_PUBLIC_APP_NAME).toBe("Avenor");
    expect(parsed.DATABASE_URL).toContain("postgresql://");
  });

  it("validates client environment defaults and rejects invalid URLs", () => {
    const validClient = validateClientEnv({
      NEXT_PUBLIC_APP_NAME: "Avenor",
      NEXT_PUBLIC_APP_URL: "https://avenor.app",
    });
    expect(validClient.NEXT_PUBLIC_APP_URL).toBe("https://avenor.app");

    expect(() =>
      validateClientEnv({
        NEXT_PUBLIC_APP_NAME: "Avenor",
        NEXT_PUBLIC_APP_URL: "not-a-valid-url",
      }),
    ).toThrowError(AppError);
  });

  it("rejects non-PostgreSQL DATABASE_URL and short BETTER_AUTH_SECRET", () => {
    withServerRuntime(() => {
      try {
        validateServerEnv({
          ...VALID_DEV_ENV,
          DATABASE_URL: "mysql://localhost:3306/wrong",
          BETTER_AUTH_SECRET: "too-short",
        });
        expect.fail("Expected validation error");
      } catch (err) {
        expect(err).toBeInstanceOf(AppError);
        const appErr = err as AppError;
        expect(appErr.code).toBe(ERROR_CODES.VALIDATION_ERROR);
        expect(appErr.statusCode).toBe(400);
        expect(appErr.details?.DATABASE_URL).toBeDefined();
        expect(appErr.details?.BETTER_AUTH_SECRET).toBeDefined();
      }
    });
  });

  it("rejects development placeholder secrets when running in production mode", () => {
    withServerRuntime(() => {
      expect(() =>
        validateServerEnv({
          ...VALID_DEV_ENV,
          NODE_ENV: "production",
          APP_ENV: "production",
          BETTER_AUTH_SECRET: "dev-only-secret-do-not-use-in-production-0123456789abcdef",
        }),
      ).toThrowError(/Production environment cannot use a development or placeholder/);

      expect(() =>
        validateServerEnv({
          ...VALID_DEV_ENV,
          NODE_ENV: "production",
          APP_ENV: "production",
          BETTER_AUTH_SECRET: "prod-verified-high-entropy-secret-key-998877665544332211",
          ENCRYPTION_MASTER_KEY: "0".repeat(64),
        }),
      ).toThrowError(/trivial all-zero/);
    });
  });

  it("blocks destructive database helpers in production environments", () => {
    expect(() =>
      assertNonProductionDestructiveAction({ NODE_ENV: "production" }, "resetTestDatabase"),
    ).toThrowError(/Blocked destructive operation "resetTestDatabase" in production/);

    expect(() =>
      assertNonProductionDestructiveAction({ NODE_ENV: "test" }, "resetTestDatabase"),
    ).not.toThrow();
  });
});

describe("THE-112: @avenor/types error taxonomy, UX states, and RBAC matrix", () => {
  it("redacts sensitive connection strings and tokens from public error payloads", () => {
    const rawMessage =
      "Connection failed to postgresql://admin:supersecret@db.neon.tech/avenor with Bearer eyJhbGciOiJIUzI1NiJ9";
    const redacted = redactSensitiveText(rawMessage);
    expect(redacted).not.toContain("supersecret");
    expect(redacted).not.toContain("eyJhbGciOiJIUzI1NiJ9");
    expect(redacted).toContain("[REDACTED]");

    const appErr = new AppError({
      code: ERROR_CODES.INTERNAL_ERROR,
      message: rawMessage,
    });
    const payload = appErr.toPublicJson();
    expect(payload.error.code).toBe("INTERNAL_ERROR");
    expect(payload.error.message).not.toContain("supersecret");
  });

  it("defines all 21 UX states from Master Product Design Brief Section 13 and prevents fake 0 metrics", () => {
    expect(AVENOR_UX_STATES).toHaveLength(21);
    for (const state of AVENOR_UX_STATES) {
      expect(UX_STATE_DESCRIPTORS[state]).toBeDefined();
      expect(UX_STATE_DESCRIPTORS[state].label.length).toBeGreaterThan(2);
    }

    // Empty or unconnected states must NEVER render numeric 0
    expect(canRenderNumericValue("unconnected", 0)).toBe(false);
    expect(canRenderNumericValue("empty_first_use", 0)).toBe(false);
    expect(canRenderNumericValue("empty_filtered", 0)).toBe(false);
    expect(canRenderNumericValue("loading_initial", 0)).toBe(false);
    expect(canRenderNumericValue("permission_insufficient", 0)).toBe(false);
    expect(canRenderNumericValue("provider_error", 0)).toBe(false);

    // Connected healthy state with a real numeric measurement is allowed
    expect(canRenderNumericValue("connected_healthy", 0)).toBe(true);
    expect(canRenderNumericValue("connected_healthy", 42)).toBe(true);
    expect(canRenderNumericValue("connected_healthy", null)).toBe(false);
  });

  it("enforces workspace role permission boundaries across OWNER, ADMIN, ANALYST, and VIEWER", () => {
    expect(roleHasPermission("OWNER", "project:create")).toBe(true);
    expect(roleHasPermission("ADMIN", "project:create")).toBe(true);
    expect(roleHasPermission("ANALYST", "project:create")).toBe(false);
    expect(roleHasPermission("VIEWER", "project:create")).toBe(false);
    expect(roleHasPermission("ANALYST", "report:create")).toBe(true);
    expect(roleHasPermission("VIEWER", "report:create")).toBe(false);
    expect(roleHasPermission("VIEWER", "project:read")).toBe(true);
  });
});

describe("THE-112: @avenor/ui Signal Atlas tokens and accessible primitives", () => {
  it("matches Master Product Design Brief v1.0 color and geometry tokens", () => {
    expect(SIGNAL_ATLAS_COLORS.canvas).toBe("#F7F9FC");
    expect(SIGNAL_ATLAS_COLORS.surfacePrimary).toBe("#FFFFFF");
    expect(SIGNAL_ATLAS_COLORS.inkPrimary).toBe("#17243A");
    expect(SIGNAL_ATLAS_COLORS.accentPrimary).toBe("#5157D9");
    expect(SIGNAL_ATLAS_COLORS.signalTeal).toBe("#168E99");
    expect(SIGNAL_ATLAS_GEOMETRY.sidebarWidthPx).toBe(256);
    expect(SIGNAL_ATLAS_GEOMETRY.headerHeightPx).toBe(64);
    expect(SIGNAL_ATLAS_SPACING_SCALE).toContain(8);
    expect(SIGNAL_ATLAS_SPACING_SCALE).toContain(24);
  });

  it("renders MetricCard with tabular numerals when connected and honest non-numeric state when unconnected", () => {
    const { rerender } = render(
      <MetricCard
        title="Active Environments"
        definition="Configured logical environments"
        state="connected_healthy"
        value={3}
        unit="envs"
        sourceLabel="Avenor Core"
        freshnessLabel="Just now"
      />,
    );

    const numericEl = screen.getByTestId("metric-card-numeric-value");
    expect(numericEl).toHaveTextContent("3");
    expect(numericEl.className).toContain("tabular-nums");

    rerender(
      <MetricCard
        title="GA4 Traffic"
        definition="Google Analytics 4 property sessions"
        state="unconnected"
        value={0}
        sourceLabel="GA4"
        freshnessLabel="Awaiting connection"
      />,
    );

    expect(screen.queryByTestId("metric-card-numeric-value")).toBeNull();
    expect(screen.getByTestId("metric-card-non-numeric-state")).toHaveTextContent("Not connected");
  });

  it("renders accessible FormField, Button, Badge, EmptyState, ErrorState, WarningBanner, ProgressIndicator, and DataTable", () => {
    render(
      <div>
        <FormField id="project-name" label="Project name" error="Project name is required" required>
          <TextInput id="project-name" hasError defaultValue="" />
        </FormField>
        <Button variant="primary">Create project</Button>
        <Badge tone="read-only">Read-Only</Badge>
        <EmptyState
          title="No logical projects yet"
          description="Create your first project to organize environments."
        />
        <ErrorState
          title="Unable to load workspace"
          message="Session expired"
          code="UNAUTHENTICATED"
        />
        <WarningBanner
          title="Read-only boundary active"
          description="Avenor never mutates external provider resources."
          tone="signal"
        />
        <ProgressIndicator
          steps={[
            {
              id: "org",
              title: "Organization",
              description: "Verified tenant root",
              status: "completed",
            },
            {
              id: "project",
              title: "First Project",
              description: "Create logical product",
              status: "current",
            },
          ]}
        />
        <DataTable
          caption="Environments table"
          columns={[
            { key: "name", header: "Environment", render: (row) => row.name },
            { key: "count", header: "Mapped Sources", numeric: true, render: (row) => row.count },
          ]}
          rows={[{ id: "env-1", name: "Production", count: 2 }]}
          getRowKey={(r) => r.id}
        />
      </div>,
    );

    expect(screen.getByLabelText(/Project name/i)).toHaveAttribute("aria-invalid", "true");
    expect(screen.getByRole("button", { name: "Create project" })).toBeInTheDocument();
    expect(screen.getByText("No logical projects yet")).toBeInTheDocument();
    expect(screen.getByText("Unable to load workspace")).toBeInTheDocument();
    expect(screen.getByText("Production")).toBeInTheDocument();
  });
});
