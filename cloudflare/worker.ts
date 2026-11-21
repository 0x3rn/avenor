import {
  authenticateUser,
  authorizeWorkspaceAccess,
  buildGoogleAuthorizeUrl,
  completeOAuthCallback,
  completeUserOnboarding,
  createGoogleOAuthRefreshHandler,
  createGoogleOAuthTokenExchangeHandler,
  createLogicalProject,
  createPasswordResetRequest,
  createProjectEnvironment,
  createWorkspaceInOrganization,
  defaultSandboxTokenExchangeHandler,
  defaultSandboxTokenRefreshHandler,
  disconnectProviderConnection,
  getLogicalProjectById,
  getWorkspaceGovernanceDetails,
  initiateOAuthAuthorization,
  isGoogleProviderKey,
  listWorkspaceProjects,
  refreshConnectionOAuthToken,
  registerUserWithDefaultOwnership,
  resolvePendingOAuthStateDetails,
  resolveSessionByToken,
  revokeSessionByToken,
  SESSION_COOKIE_NAME,
  SESSION_TTL_SECONDS,
  switchSessionActiveWorkspace,
  updateLogicalProject,
  updateProjectEnvironment,
  updateWorkspaceSettings,
  verifyEmailToken,
} from "@avenor/auth";
import { resolveGoogleApiMode } from "@avenor/config";
import { AppError, ERROR_CODES, type ReadOnlyProviderContext, toAppError } from "@avenor/types";
import {
  discoverAndPersistConnectionResources,
  getWorkspaceConnectionDetail,
  listWorkspaceConnections,
  mapResourceToProjectEnvironment,
  unmapResourceFromProject,
  validateConnectionHealth,
} from "../src/lib/connections";
import { getProjectSyncStatusSummary, triggerProjectIngestionAction } from "../src/lib/ingestion";
import {
  BIGQUERY_BILLING_EXPORT_ONBOARDING_STEPS,
  completeBigQueryBillingExportOnboarding,
  getProviderCatalogEntry,
  PROVIDER_CATALOG,
  sharedGitHubWebhookDedupe,
  sharedGoogleTelemetryCache,
  syncBigQueryBillingCostLedger,
  verifyAndMinimizeGitHubWebhook,
} from "../src/lib/providers";
import {
  activateCardFreeProTrial,
  createLemonSqueezyCheckoutSession,
  getWorkspaceEffectiveEntitlements,
  listWorkspaceSubscriptionInvoices,
  processLemonSqueezyWebhookEvent,
} from "../src/lib/billing/lemon-squeezy";
import { getWorkspaceUsageAndQuotaReport } from "../src/lib/billing/quotas";
import { AVENOR_PLAN_CATALOG, type AvenorBillingInterval } from "../src/lib/billing/plan-catalog";
import {
  type CreateCostSpendingThresholdInput,
  createCostSpendingThreshold,
  evaluateCostSpendingThresholds,
  listCostSpendingThresholds,
} from "../src/lib/billing/thresholds";
import {
  createDigestSchedule,
  listDigestSchedules,
  registerOutboundChannel,
  runDigestScheduleIdempotently,
} from "../src/lib/alerts/digests";
import {
  createAlertRule,
  evaluateAndDispatchWorkspaceAlerts,
  getNotificationPreferences,
  listWorkspaceAlertsAndNotifications,
  markInAppNotificationRead,
  updateNotificationPreferences,
} from "../src/lib/alerts/service";
import {
  assertPrivateSignupAllowed,
  getOnboardingProgress,
  type OnboardingStepKey,
  submitPrivateAccessRequest,
  upsertOnboardingProgress,
} from "../src/lib/onboarding/private-access";
import {
  getProjectBackendIntelligenceReport,
  getWorkspaceBackendIntelligenceReport,
} from "../src/lib/reports/backend-service";
import {
  buildPortfolioReconciliationMatrix,
  type SourceConsoleBenchmarkEntry,
} from "../src/lib/reports/mvp-reconciliation";
import {
  getProjectOperationalTimeline,
  recordOperationalEvent,
} from "../src/lib/reliability/correlation";
import {
  createUptimeMonitor,
  deleteUptimeMonitor,
  executeUptimeProbeAndRecord,
  listWorkspaceReliabilitySnapshot,
  toggleUptimeMonitor,
} from "../src/lib/reliability/uptime";
import { getAndPersistProjectSecurityPosture } from "../src/lib/reports/security-posture";
import {
  acceptWorkspaceInvitation,
  createWorkspaceInvitation,
  listProjectAccessGrants,
  listWorkspaceInvitations,
  removeWorkspaceMember,
  revokeWorkspaceInvitation,
  updateWorkspaceMemberRole,
} from "../src/lib/team/memberships";
import {
  createHistoricalDataExportJob,
  downloadExportArtifactWithToken,
  executeWorkspaceRetentionCleanup,
  getWorkspaceRetentionPolicy,
  listWorkspaceExportJobs,
  updateWorkspaceRetentionPolicy,
} from "../src/lib/exports/service";
import {
  generateAndPersistInsightSummary,
  type InsightEvidenceItem,
  listWorkspaceInsights,
} from "../src/lib/intelligence/insights";
import {
  evaluateAndPersistProjectAnomaly,
  listWorkspaceAnomalies,
  type StatisticalAnomalyInput,
  updateAnomalyStatus,
} from "../src/lib/intelligence/anomalies";
import {
  createSavedReport,
  deleteSavedReport,
  executeSavedReportBenchmark,
  listSavedReports,
  renderReportToPrintableHtml,
  serializeReportToSafeCsv,
} from "../src/lib/reports/custom-reports";
import {
  getProjectCostIntelligenceReport,
  getWorkspaceCostIntelligenceReport,
} from "../src/lib/reports/cost-service";
import {
  getProjectGa4RealtimeTelemetry,
  getProjectGa4StandardTelemetry,
  parseGa4ReportSearchParams,
} from "../src/lib/reports/ga4-service";
import {
  getProjectSearchConsoleTelemetry,
  parseSearchConsoleReportParams,
} from "../src/lib/reports/search-console-service";
import {
  getProjectControlCenterOverview,
  getWorkspacePortfolioOverview,
} from "../src/lib/reports/portfolio-service";
import {
  generateProjectReconciliationReport,
  type ProviderExpectedMetricBenchmark,
} from "../src/lib/reports/reconciliation";

export interface CloudflareWorkerEnv {
  ASSETS?: {
    fetch(request: Request | string): Promise<Response>;
  };
  [key: string]: unknown;
}

function syncWorkerEnvToProcess(env: CloudflareWorkerEnv): void {
  for (const [key, value] of Object.entries(env)) {
    if (typeof value === "string" && value.length > 0) {
      process.env[key] = value;
    }
  }
}

function jsonResponse(body: unknown, status = 200, extraHeaders?: HeadersInit): Response {
  const headers = new Headers(extraHeaders);
  headers.set("content-type", "application/json; charset=utf-8");
  return new Response(JSON.stringify(body), { status, headers });
}

function errorResponse(error: unknown): Response {
  const appErr = toAppError(error);
  return jsonResponse(appErr.toPublicJson(), appErr.statusCode);
}

function readCookie(request: Request, name: string): string | undefined {
  const cookieHeader = request.headers.get("cookie");
  if (!cookieHeader) {
    return undefined;
  }
  for (const part of cookieHeader.split(";")) {
    const [rawKey, ...rest] = part.trim().split("=");
    if (rawKey === name) {
      return decodeURIComponent(rest.join("="));
    }
  }
  return undefined;
}

function buildSessionSetCookie(rawToken: string): string {
  const secure = process.env.NODE_ENV === "production" ? "; Secure" : "";
  return `${SESSION_COOKIE_NAME}=${encodeURIComponent(rawToken)}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${SESSION_TTL_SECONDS}${secure}`;
}

function buildClearSessionCookie(): string {
  return `${SESSION_COOKIE_NAME}=; Path=/; HttpOnly; SameSite=Lax; Max-Age=0`;
}

async function getWorkerSession(request: Request) {
  const rawToken = readCookie(request, SESSION_COOKIE_NAME);
  return resolveSessionByToken(rawToken);
}

async function handleApiRequest(request: Request, url: URL): Promise<Response> {
  const pathname = url.pathname;
  const method = request.method.toUpperCase();

  if (pathname === "/api/health" && method === "GET") {
    return jsonResponse({
      status: "ok",
      service: "avenor",
      milestone: "01-foundation",
      mode: "read-only-intelligence",
      runtime: "cloudflare-workers",
      timestamp: new Date().toISOString(),
    });
  }

  try {
    if (pathname.startsWith("/api/auth/")) {
      const action = pathname.slice("/api/auth/".length);
      const ipAddress = request.headers.get("x-forwarded-for") ?? null;
      const userAgent = request.headers.get("user-agent") ?? null;

      if (action === "session" && method === "GET") {
        const session = await getWorkerSession(request);
        if (!session) {
          return jsonResponse({ authenticated: false, session: null }, 401);
        }
        return jsonResponse({ authenticated: true, session }, 200);
      }

      if (action === "signup" && method === "POST") {
        const body = (await request.json()) as { email?: string };
        await assertPrivateSignupAllowed(String(body?.email ?? ""));
        const result = await registerUserWithDefaultOwnership(body, { ipAddress, userAgent });
        return jsonResponse(
          {
            authenticated: true,
            session: result.context,
            verificationToken: result.verificationToken,
          },
          201,
          { "set-cookie": buildSessionSetCookie(result.rawSessionToken) },
        );
      }

      if (action === "signin" && method === "POST") {
        const body = await request.json();
        const result = await authenticateUser(body, { ipAddress, userAgent });
        return jsonResponse({ authenticated: true, session: result.context }, 200, {
          "set-cookie": buildSessionSetCookie(result.rawSessionToken),
        });
      }

      if (action === "signout" && method === "POST") {
        const rawToken = readCookie(request, SESSION_COOKIE_NAME);
        await revokeSessionByToken(rawToken);
        return jsonResponse({ authenticated: false }, 200, {
          "set-cookie": buildClearSessionCookie(),
        });
      }

      if (action === "switch-workspace" && method === "POST") {
        const session = await getWorkerSession(request);
        if (!session) {
          throw new AppError({
            code: ERROR_CODES.UNAUTHENTICATED,
            message: "Authentication required to switch workspaces.",
          });
        }
        const body = (await request.json()) as { workspaceId?: string };
        if (!body.workspaceId) {
          throw new AppError({
            code: ERROR_CODES.VALIDATION_ERROR,
            message: "workspaceId is required.",
          });
        }
        const activeWorkspace = await switchSessionActiveWorkspace(session, body.workspaceId);
        return jsonResponse({ ok: true, activeWorkspace }, 200);
      }

      if (action === "verify-email" && method === "POST") {
        const body = (await request.json()) as { email?: string; token?: string };
        if (!body.email || !body.token) {
          throw new AppError({
            code: ERROR_CODES.VALIDATION_ERROR,
            message: "Email and verification token are required.",
          });
        }
        const verified = await verifyEmailToken(body.email, body.token);
        if (!verified) {
          throw new AppError({
            code: ERROR_CODES.VALIDATION_ERROR,
            message: "Verification token is invalid or has expired.",
          });
        }
        return jsonResponse({ ok: true, verified: true }, 200);
      }

      if (action === "forgot-password" && method === "POST") {
        const body = (await request.json()) as { email?: string };
        if (!body.email) {
          throw new AppError({
            code: ERROR_CODES.VALIDATION_ERROR,
            message: "Email address is required.",
          });
        }
        await createPasswordResetRequest(body.email);
        return jsonResponse({ ok: true, requested: true }, 200);
      }

      return jsonResponse(
        { error: { code: ERROR_CODES.NOT_FOUND, message: `Unknown auth route: ${action}` } },
        404,
      );
    }

    if (pathname === "/api/webhooks/github" && method === "POST") {
      const webhookSecret = process.env.GITHUB_WEBHOOK_SECRET ?? "";
      if (!webhookSecret) {
        throw new AppError({
          code: ERROR_CODES.UNAUTHENTICATED,
          message: "GITHUB_WEBHOOK_SECRET is not configured on this worker.",
        });
      }
      const rawBody = await request.text();
      const event = verifyAndMinimizeGitHubWebhook({
        rawBody,
        eventHeader: request.headers.get("x-github-event"),
        deliveryIdHeader: request.headers.get("x-github-delivery"),
        signatureHeader: request.headers.get("x-hub-signature-256"),
        webhookSecret,
      });
      const isNewDelivery = sharedGitHubWebhookDedupe.recordIfNew(event.deliveryId);
      return jsonResponse(
        {
          accepted: true,
          deduplicated: !isNewDelivery,
          deliveryId: event.deliveryId,
          event,
        },
        200,
      );
    }

    if (pathname === "/api/webhooks/lemon-squeezy" && method === "POST") {
      const webhookSecret = process.env.LEMON_SQUEEZY_WEBHOOK_SECRET ?? "";
      if (!webhookSecret) {
        throw new AppError({
          code: ERROR_CODES.UNAUTHENTICATED,
          message: "LEMON_SQUEEZY_WEBHOOK_SECRET is not configured on this worker.",
        });
      }
      const rawBody = await request.text();
      const result = await processLemonSqueezyWebhookEvent({
        rawBody,
        signatureHeader: request.headers.get("x-signature"),
        webhookSecret,
      });
      return jsonResponse(result, 200);
    }

    if (pathname === "/api/usage" && method === "GET") {
      const session = await getWorkerSession(request);
      const report = await getWorkspaceUsageAndQuotaReport(
        session,
        url.searchParams.get("workspaceId") ?? undefined,
      );
      return jsonResponse(report, 200);
    }

    if (pathname === "/api/billing/subscription") {
      const session = await getWorkerSession(request);
      if (method === "GET") {
        const workspaceId = url.searchParams.get("workspaceId") ?? undefined;
        const [entitlements, invoices] = await Promise.all([
          getWorkspaceEffectiveEntitlements(session, workspaceId),
          listWorkspaceSubscriptionInvoices(session, workspaceId),
        ]);
        return jsonResponse({ entitlements, invoices, catalog: AVENOR_PLAN_CATALOG }, 200);
      }
      if (method === "POST") {
        const body = (await request.json()) as {
          action?: string;
          workspaceId?: string;
          planCode?: "PRO" | "TEAM";
          interval?: AvenorBillingInterval;
        };
        if (body.action === "start_trial") {
          const entitlements = await activateCardFreeProTrial(session, body.workspaceId);
          return jsonResponse({ entitlements }, 200);
        }
        if (body.action === "checkout") {
          const checkout = await createLemonSqueezyCheckoutSession(session, {
            workspaceId: body.workspaceId,
            planCode: body.planCode === "TEAM" ? "TEAM" : "PRO",
            interval: body.interval === "ANNUAL" ? "ANNUAL" : "MONTHLY",
          });
          return jsonResponse(checkout, 200);
        }
      }
    }

    if (pathname === "/api/team/invitations") {
      const session = await getWorkerSession(request);
      if (method === "GET") {
        const invitations = await listWorkspaceInvitations(
          session,
          url.searchParams.get("workspaceId") ?? undefined,
        );
        return jsonResponse({ invitations }, 200);
      }
      if (method === "POST") {
        const body = (await request.json()) as Record<string, unknown>;
        if (body.action === "accept" && typeof body.token === "string") {
          return jsonResponse(await acceptWorkspaceInvitation(session, body.token), 200);
        }
        return jsonResponse(
          await createWorkspaceInvitation(
            session,
            body as Parameters<typeof createWorkspaceInvitation>[1],
          ),
          201,
        );
      }
      if (method === "DELETE") {
        return jsonResponse(
          await revokeWorkspaceInvitation(session, url.searchParams.get("invitationId") ?? ""),
          200,
        );
      }
    }

    if (pathname === "/api/team/members") {
      const session = await getWorkerSession(request);
      if (method === "GET") {
        const grants = await listProjectAccessGrants(
          session,
          url.searchParams.get("workspaceId") ?? undefined,
        );
        return jsonResponse({ grants }, 200);
      }
      if (method === "PATCH") {
        const body = (await request.json()) as {
          workspaceId?: string;
          targetUserId?: string;
          newRole?: "OWNER" | "ADMIN" | "ANALYST" | "VIEWER";
        };
        return jsonResponse(
          await updateWorkspaceMemberRole(session, {
            workspaceId: body.workspaceId,
            targetUserId: String(body.targetUserId ?? ""),
            newRole: body.newRole ?? "VIEWER",
          }),
          200,
        );
      }
      if (method === "DELETE") {
        return jsonResponse(
          await removeWorkspaceMember(session, {
            workspaceId: url.searchParams.get("workspaceId") ?? undefined,
            targetUserId: url.searchParams.get("userId") ?? "",
          }),
          200,
        );
      }
    }

    if (pathname === "/api/exports") {
      const session = await getWorkerSession(request);
      if (method === "GET") {
        const downloadId = url.searchParams.get("downloadId");
        const token = url.searchParams.get("token");
        if (downloadId && token) {
          const artifact = await downloadExportArtifactWithToken(session, downloadId, token);
          return new Response(artifact.content, {
            status: 200,
            headers: {
              "content-type": artifact.contentType,
              "x-content-sha256": artifact.checksumSha256,
              "cache-control": "private, no-store",
            },
          });
        }
        const workspaceId = url.searchParams.get("workspaceId") ?? undefined;
        const [jobs, retentionPolicy] = await Promise.all([
          listWorkspaceExportJobs(session, workspaceId),
          getWorkspaceRetentionPolicy(session, workspaceId),
        ]);
        return jsonResponse({ jobs, retentionPolicy }, 200);
      }
      if (method === "POST") {
        const body = (await request.json()) as Record<string, unknown>;
        if (body.action === "run_retention_cleanup") {
          const result = await executeWorkspaceRetentionCleanup(
            session,
            typeof body.workspaceId === "string" ? body.workspaceId : undefined,
          );
          return jsonResponse(result, 200);
        }
        const created = await createHistoricalDataExportJob(
          session,
          body as Parameters<typeof createHistoricalDataExportJob>[1],
        );
        return jsonResponse(created, 201);
      }
      if (method === "PATCH") {
        const body = (await request.json()) as Parameters<typeof updateWorkspaceRetentionPolicy>[1];
        const retentionPolicy = await updateWorkspaceRetentionPolicy(session, body);
        return jsonResponse({ retentionPolicy }, 200);
      }
    }

    if (pathname === "/api/insights") {
      const session = await getWorkerSession(request);
      if (method === "GET") {
        const insights = await listWorkspaceInsights(
          session,
          url.searchParams.get("workspaceId") ?? undefined,
        );
        return jsonResponse({ insights }, 200);
      }
      if (method === "POST") {
        const body = (await request.json()) as {
          workspaceId?: string;
          projectId?: string | null;
          evidence?: InsightEvidenceItem[];
          preferAi?: boolean;
        };
        const insight = await generateAndPersistInsightSummary(session, {
          workspaceId: body.workspaceId,
          projectId: body.projectId,
          evidence: Array.isArray(body.evidence) ? body.evidence : [],
          preferAi: Boolean(body.preferAi),
        });
        return jsonResponse({ insight }, 201);
      }
    }

    if (pathname === "/api/digests") {
      const session = await getWorkerSession(request);
      if (method === "GET") {
        const schedules = await listDigestSchedules(
          session,
          url.searchParams.get("workspaceId") ?? undefined,
        );
        return jsonResponse({ schedules }, 200);
      }
      if (method === "POST") {
        const body = (await request.json()) as Record<string, unknown>;
        if (body.action === "run" && typeof body.scheduleId === "string") {
          const result = await runDigestScheduleIdempotently(session, body.scheduleId);
          return jsonResponse(result, 200);
        }
        if (body.action === "register_channel") {
          const channel = await registerOutboundChannel(
            session,
            body as Parameters<typeof registerOutboundChannel>[1],
          );
          return jsonResponse({ channel }, 201);
        }
        const schedule = await createDigestSchedule(
          session,
          body as Parameters<typeof createDigestSchedule>[1],
        );
        return jsonResponse({ schedule }, 201);
      }
    }

    if (pathname === "/api/anomalies") {
      const session = await getWorkerSession(request);
      if (method === "GET") {
        const anomalies = await listWorkspaceAnomalies(
          session,
          url.searchParams.get("workspaceId") ?? undefined,
        );
        return jsonResponse({ anomalies }, 200);
      }
      if (method === "POST") {
        const body = (await request.json()) as {
          projectId: string;
          evaluation: StatisticalAnomalyInput;
        };
        const result = await evaluateAndPersistProjectAnomaly(
          session,
          String(body.projectId ?? ""),
          body.evaluation,
        );
        return jsonResponse(result, 200);
      }
      if (method === "PATCH") {
        const body = (await request.json()) as {
          anomalyId?: string;
          status?: "ACKNOWLEDGED" | "RESOLVED";
        };
        const anomaly = await updateAnomalyStatus(
          session,
          String(body.anomalyId ?? ""),
          body.status === "RESOLVED" ? "RESOLVED" : "ACKNOWLEDGED",
        );
        return jsonResponse({ anomaly }, 200);
      }
    }

    if (pathname === "/api/reports") {
      const session = await getWorkerSession(request);
      if (method === "GET") {
        const executeId = url.searchParams.get("executeId");
        if (executeId) {
          const executed = await executeSavedReportBenchmark(session, executeId);
          const format = url.searchParams.get("format");
          if (format === "csv") {
            return new Response(serializeReportToSafeCsv(executed), {
              status: 200,
              headers: {
                "content-type": "text/csv; charset=utf-8",
                "cache-control": "private, no-store",
              },
            });
          }
          if (format === "html") {
            return new Response(renderReportToPrintableHtml(executed), {
              status: 200,
              headers: {
                "content-type": "text/html; charset=utf-8",
                "cache-control": "private, no-store",
              },
            });
          }
          return jsonResponse(executed, 200);
        }
        const reports = await listSavedReports(
          session,
          url.searchParams.get("workspaceId") ?? undefined,
        );
        return jsonResponse({ reports }, 200);
      }
      if (method === "POST") {
        const body = (await request.json()) as Parameters<typeof createSavedReport>[1];
        const report = await createSavedReport(session, body);
        return jsonResponse({ report }, 201);
      }
      if (method === "DELETE") {
        const reportId = url.searchParams.get("reportId") ?? "";
        const result = await deleteSavedReport(session, reportId);
        return jsonResponse(result, 200);
      }
    }

    if (pathname === "/api/reliability") {
      const session = await getWorkerSession(request);
      if (method === "GET") {
        const snapshot = await listWorkspaceReliabilitySnapshot(session, {
          workspaceId: url.searchParams.get("workspaceId") ?? undefined,
          projectId: url.searchParams.get("projectId") ?? undefined,
        });
        return jsonResponse(snapshot, 200);
      }
      if (method === "POST") {
        const body = (await request.json()) as Record<string, unknown>;
        if (body.action === "probe" && typeof body.monitorId === "string") {
          const probe = await executeUptimeProbeAndRecord(session, body.monitorId);
          return jsonResponse({ probe }, 200);
        }
        const monitor = await createUptimeMonitor(
          session,
          body as Parameters<typeof createUptimeMonitor>[1],
        );
        return jsonResponse({ monitor }, 201);
      }
      if (method === "PATCH") {
        const body = (await request.json()) as { monitorId?: string; isEnabled?: boolean };
        const monitor = await toggleUptimeMonitor(
          session,
          String(body.monitorId ?? ""),
          Boolean(body.isEnabled),
        );
        return jsonResponse({ monitor }, 200);
      }
      if (method === "DELETE") {
        const monitorId = url.searchParams.get("monitorId") ?? "";
        const result = await deleteUptimeMonitor(session, monitorId);
        return jsonResponse(result, 200);
      }
    }

    const projectTimelineMatch = pathname.match(
      /^\/api\/projects\/([^/]+)\/reliability\/timeline$/,
    );
    if (projectTimelineMatch) {
      const session = await getWorkerSession(request);
      const projectId = decodeURIComponent(projectTimelineMatch[1]);
      if (method === "GET") {
        const timeline = await getProjectOperationalTimeline(session, projectId, {
          environmentName: url.searchParams.get("environment") ?? undefined,
          bypassCache: url.searchParams.get("refresh") === "1",
        });
        return jsonResponse(timeline, 200);
      }
      if (method === "POST") {
        const body = (await request.json()) as Record<string, unknown>;
        const event = await recordOperationalEvent(session, {
          ...(body as Parameters<typeof recordOperationalEvent>[1]),
          projectId,
        });
        return jsonResponse({ event }, 201);
      }
    }

    const projectReliabilityMatch = pathname.match(/^\/api\/projects\/([^/]+)\/reliability$/);
    if (projectReliabilityMatch) {
      const session = await getWorkerSession(request);
      const projectId = decodeURIComponent(projectReliabilityMatch[1]);
      if (method === "GET") {
        const snapshot = await listWorkspaceReliabilitySnapshot(session, { projectId });
        return jsonResponse(snapshot, 200);
      }
      if (method === "POST") {
        const body = (await request.json()) as Record<string, unknown>;
        if (body.action === "probe" && typeof body.monitorId === "string") {
          const probe = await executeUptimeProbeAndRecord(session, body.monitorId);
          return jsonResponse({ probe }, 200);
        }
        const monitor = await createUptimeMonitor(session, {
          ...(body as Parameters<typeof createUptimeMonitor>[1]),
          projectId,
        });
        return jsonResponse({ monitor }, 201);
      }
    }

    if (pathname === "/api/workspaces") {
      const session = await getWorkerSession(request);
      if (method === "GET") {
        const details = await getWorkspaceGovernanceDetails(
          session,
          session?.activeWorkspace.id ?? "",
        );
        return jsonResponse({
          activeWorkspace: details.workspace,
          organization: details.organization,
          workspaces: session?.workspaces ?? [],
          members: details.members,
          auditLogs: details.auditLogs,
        });
      }
      if (method === "POST") {
        const body = await request.json();
        const created = await createWorkspaceInOrganization(
          session,
          session?.activeWorkspace.id ?? "",
          body,
        );
        return jsonResponse({ workspace: created }, 201);
      }
      if (method === "PATCH") {
        const body = (await request.json()) as { workspaceId?: string } & Record<string, unknown>;
        const targetWorkspaceId = body.workspaceId ?? session?.activeWorkspace.id ?? "";
        const updated = await updateWorkspaceSettings(session, targetWorkspaceId, body);
        return jsonResponse({ workspace: updated }, 200);
      }
    }

    if (pathname === "/api/projects") {
      const session = await getWorkerSession(request);
      if (method === "GET") {
        const workspaceId =
          url.searchParams.get("workspaceId") ?? session?.activeWorkspace.id ?? "";
        const includeArchived = url.searchParams.get("includeArchived") === "true";
        const search = url.searchParams.get("search") ?? undefined;
        const projects = await listWorkspaceProjects(session, workspaceId, {
          includeArchived,
          search,
        });
        return jsonResponse({ projects }, 200);
      }
      if (method === "POST") {
        const body = (await request.json()) as { workspaceId?: string } & Record<string, unknown>;
        const workspaceId = body.workspaceId ?? session?.activeWorkspace.id ?? "";
        const project = await createLogicalProject(session, workspaceId, body);
        return jsonResponse({ project }, 201);
      }
    }

    const projectRealtimeMatch = pathname.match(/^\/api\/projects\/([^/]+)\/analytics\/realtime$/);
    if (projectRealtimeMatch && method === "GET") {
      const session = await getWorkerSession(request);
      const projectId = decodeURIComponent(projectRealtimeMatch[1]);
      const result = await getProjectGa4RealtimeTelemetry(session, projectId, {
        environmentId: url.searchParams.get("environmentId"),
        resourceId: url.searchParams.get("resourceId"),
        bypassCache: url.searchParams.get("refresh") === "1",
      });
      const responseHeaders: Record<string, string> = {
        "content-type": "application/json",
      };
      if (result.payload.realtime?.rateLimited && result.payload.realtime.retryAfterSeconds) {
        responseHeaders["Retry-After"] = String(result.payload.realtime.retryAfterSeconds);
      }
      return new Response(JSON.stringify(result.payload), {
        status: result.statusCode,
        headers: responseHeaders,
      });
    }

    const projectEnvMatch = pathname.match(/^\/api\/projects\/([^/]+)\/environments$/);
    if (projectEnvMatch) {
      const session = await getWorkerSession(request);
      const projectId = decodeURIComponent(projectEnvMatch[1]);
      if (method === "POST") {
        const body = await request.json();
        const environment = await createProjectEnvironment(session, projectId, body, {
          expectedWorkspaceId: session?.activeWorkspace.id,
        });
        return jsonResponse({ environment }, 201);
      }
      if (method === "PATCH") {
        const body = (await request.json()) as { environmentId?: string } & Record<string, unknown>;
        if (!body.environmentId) {
          throw new AppError({
            code: ERROR_CODES.VALIDATION_ERROR,
            message: "environmentId is required.",
          });
        }
        const environment = await updateProjectEnvironment(
          session,
          projectId,
          body.environmentId,
          body,
          { expectedWorkspaceId: session?.activeWorkspace.id },
        );
        return jsonResponse({ environment }, 200);
      }
    }

    const projectAnalyticsMatch = pathname.match(/^\/api\/projects\/([^/]+)\/analytics$/);
    if (projectAnalyticsMatch && method === "GET") {
      const session = await getWorkerSession(request);
      const projectId = decodeURIComponent(projectAnalyticsMatch[1]);
      const parsed = parseGa4ReportSearchParams(url.searchParams);
      const result = await getProjectGa4StandardTelemetry(session, projectId, parsed);
      return jsonResponse(result.payload, result.statusCode);
    }

    const projectGscMatch = pathname.match(/^\/api\/projects\/([^/]+)\/search-console$/);
    if (projectGscMatch && method === "GET") {
      const session = await getWorkerSession(request);
      const projectId = decodeURIComponent(projectGscMatch[1]);
      const parsed = parseSearchConsoleReportParams(url.searchParams);
      const result = await getProjectSearchConsoleTelemetry(session, projectId, parsed);
      return jsonResponse(result.payload, result.statusCode);
    }

    const projectSyncMatch = pathname.match(/^\/api\/projects\/([^/]+)\/sync$/);
    if (projectSyncMatch) {
      const session = await getWorkerSession(request);
      const projectId = decodeURIComponent(projectSyncMatch[1]);
      if (method === "GET") {
        const summary = await getProjectSyncStatusSummary(session, projectId);
        return jsonResponse(summary, 200);
      }
      if (method === "POST") {
        const body = (await request.json().catch(() => ({}))) as {
          action?: "sync" | "backfill" | "revision_lookback" | "pause" | "resume";
          connectedResourceId?: string | null;
          backfillDays?: number | null;
          idempotencyToken?: string | null;
        };
        const result = await triggerProjectIngestionAction(session, projectId, body);
        return jsonResponse(result, 200);
      }
    }

    if (pathname === "/api/costs" && method === "GET") {
      const session = await getWorkerSession(request);
      const report = await getWorkspaceCostIntelligenceReport(session, {
        preset: url.searchParams.get("preset"),
        startDate: url.searchParams.get("startDate"),
        endDate: url.searchParams.get("endDate"),
        compare: url.searchParams.get("compare") !== "false",
        currencyFilter: url.searchParams.get("currency"),
      });
      return jsonResponse(report, 200);
    }

    const projectCostThresholdsMatch = pathname.match(
      /^\/api\/projects\/([^/]+)\/cost\/thresholds$/,
    );
    if (projectCostThresholdsMatch) {
      const session = await getWorkerSession(request);
      const projectId = decodeURIComponent(projectCostThresholdsMatch[1]);
      if (method === "GET") {
        const data = await listCostSpendingThresholds(session, { projectId });
        return jsonResponse(data, 200);
      }
      if (method === "POST") {
        const body = (await request
          .json()
          .catch(() => ({}))) as CreateCostSpendingThresholdInput & {
          action?: "create" | "evaluate";
          referenceDate?: string;
        };
        if (body.action === "evaluate") {
          const evaluations = await evaluateCostSpendingThresholds(session, {
            projectId,
            referenceDate: body.referenceDate,
          });
          const updated = await listCostSpendingThresholds(session, { projectId });
          return jsonResponse({ latestEvaluations: evaluations, ...updated }, 200);
        }
        const threshold = await createCostSpendingThreshold(session, {
          ...body,
          projectId,
        });
        const evaluations = await evaluateCostSpendingThresholds(session, {
          projectId,
          referenceDate: body.referenceDate,
        });
        const updated = await listCostSpendingThresholds(session, { projectId });
        return jsonResponse({ threshold, latestEvaluations: evaluations, ...updated }, 201);
      }
    }

    const projectCostMatch = pathname.match(/^\/api\/projects\/([^/]+)\/cost$/);
    if (projectCostMatch) {
      const session = await getWorkerSession(request);
      const projectId = decodeURIComponent(projectCostMatch[1]);
      if (method === "GET") {
        const report = await getProjectCostIntelligenceReport(session, projectId, {
          environmentId: url.searchParams.get("environmentId"),
          environmentType: url.searchParams.get("environmentType") as
            | "PRODUCTION"
            | "STAGING"
            | "DEVELOPMENT"
            | null,
          preset: url.searchParams.get("preset"),
          startDate: url.searchParams.get("startDate"),
          endDate: url.searchParams.get("endDate"),
          compare: url.searchParams.get("compare") !== "false",
          currencyFilter: url.searchParams.get("currency"),
        });
        return jsonResponse(report, 200);
      }
      if (method === "POST") {
        const body = (await request.json().catch(() => ({}))) as {
          connectedResourceId: string;
          environmentId?: string | null;
          startDate: string;
          endDate: string;
          gcpProjectFilter?: string | null;
        };
        const syncResult = await syncBigQueryBillingCostLedger(session, {
          connectedResourceId: body.connectedResourceId,
          projectId,
          environmentId: body.environmentId ?? null,
          startDate: body.startDate,
          endDate: body.endDate,
          gcpProjectFilter: body.gcpProjectFilter ?? null,
        });
        const report = await getProjectCostIntelligenceReport(session, projectId, {
          environmentId: body.environmentId,
          preset: "custom",
          startDate: body.startDate,
          endDate: body.endDate,
          bypassCache: true,
        });
        return jsonResponse({ syncResult, report }, 200);
      }
    }

    if (pathname === "/api/access-request" && method === "POST") {
      const body = (await request.json().catch(() => ({}))) as {
        name?: string;
        email?: string;
        productCountHint?: string | null;
        notes?: string | null;
      };
      const forwardedFor = request.headers.get("x-forwarded-for");
      const sourceIp = forwardedFor ? forwardedFor.split(",")[0]?.trim() : null;
      const result = await submitPrivateAccessRequest({
        name: body.name ?? "",
        email: body.email ?? "",
        productCountHint: body.productCountHint ?? null,
        notes: body.notes ?? null,
        sourceIp,
      });
      return jsonResponse(result, result.alreadyRequested ? 200 : 201);
    }

    if (pathname === "/api/onboarding/progress") {
      const session = await getWorkerSession(request);
      if (method === "GET") {
        const progress = await getOnboardingProgress(
          session,
          url.searchParams.get("workspaceId") ?? undefined,
        );
        return jsonResponse(progress, 200);
      }
      if (method === "PATCH") {
        const body = (await request.json().catch(() => ({}))) as {
          workspaceId?: string;
          currentStep: OnboardingStepKey;
          completedSteps?: OnboardingStepKey[];
          draftProjectId?: string | null;
          metadata?: Record<string, unknown>;
          markCompleted?: boolean;
        };
        const progress = await upsertOnboardingProgress(session, body);
        return jsonResponse(progress, 200);
      }
    }

    if (pathname === "/api/alerts") {
      const session = await getWorkerSession(request);
      if (method === "GET") {
        const data = await listWorkspaceAlertsAndNotifications(
          session,
          url.searchParams.get("workspaceId") ?? undefined,
        );
        return jsonResponse(data, 200);
      }
      if (method === "POST") {
        const body = (await request.json().catch(() => ({}))) as Record<string, unknown>;
        if (body.action === "evaluate") {
          const wsId = typeof body.workspaceId === "string" ? body.workspaceId : undefined;
          const outcome = await evaluateAndDispatchWorkspaceAlerts(session, { workspaceId: wsId });
          const updated = await listWorkspaceAlertsAndNotifications(session, wsId);
          return jsonResponse({ outcome, ...updated }, 200);
        }
        const rule = await createAlertRule(session, body as Parameters<typeof createAlertRule>[1]);
        return jsonResponse({ rule }, 201);
      }
    }

    if (pathname === "/api/notifications/preferences") {
      const session = await getWorkerSession(request);
      if (method === "GET") {
        const prefs = await getNotificationPreferences(
          session,
          url.searchParams.get("workspaceId") ?? undefined,
        );
        return jsonResponse(prefs, 200);
      }
      if (method === "PATCH") {
        const body = (await request.json().catch(() => ({}))) as Parameters<
          typeof updateNotificationPreferences
        >[1];
        const updated = await updateNotificationPreferences(session, body);
        return jsonResponse(updated, 200);
      }
    }

    if (pathname === "/api/notifications") {
      const session = await getWorkerSession(request);
      if (method === "GET") {
        const data = await listWorkspaceAlertsAndNotifications(
          session,
          url.searchParams.get("workspaceId") ?? undefined,
        );
        return jsonResponse(
          { notifications: data.notifications, deliveries: data.deliveries },
          200,
        );
      }
      if (method === "PATCH") {
        const body = (await request.json().catch(() => ({}))) as {
          notificationId?: string;
          workspaceId?: string;
        };
        const res = await markInAppNotificationRead(
          session,
          body.notificationId ?? "",
          body.workspaceId,
        );
        return jsonResponse(res, 200);
      }
    }

    if (pathname === "/api/backend" && method === "GET") {
      const session = await getWorkerSession(request);
      const report = await getWorkspaceBackendIntelligenceReport(session, {
        preset: url.searchParams.get("preset"),
        startDate: url.searchParams.get("startDate"),
        endDate: url.searchParams.get("endDate"),
        compare: url.searchParams.get("compare") !== "false",
      });
      return jsonResponse(report, 200);
    }

    const projectBackendPostureMatch = pathname.match(
      /^\/api\/projects\/([^/]+)\/backend\/security-posture$/,
    );
    if (projectBackendPostureMatch && method === "GET") {
      const session = await getWorkerSession(request);
      const projectId = decodeURIComponent(projectBackendPostureMatch[1]);
      const posture = await getAndPersistProjectSecurityPosture(session, projectId);
      return jsonResponse(posture, 200);
    }

    const projectBackendMatch = pathname.match(/^\/api\/projects\/([^/]+)\/backend$/);
    if (projectBackendMatch && method === "GET") {
      const session = await getWorkerSession(request);
      const projectId = decodeURIComponent(projectBackendMatch[1]);
      const report = await getProjectBackendIntelligenceReport(session, projectId, {
        preset: url.searchParams.get("preset"),
        startDate: url.searchParams.get("startDate"),
        endDate: url.searchParams.get("endDate"),
        environmentId: url.searchParams.get("environmentId"),
        compare: url.searchParams.get("compare") !== "false",
      });
      return jsonResponse(report, 200);
    }

    if (pathname === "/api/portfolio/reconciliation-matrix" && method === "POST") {
      const session = await getWorkerSession(request);
      const body = (await request.json().catch(() => ({}))) as {
        workspaceId?: string;
        startDate?: string;
        endDate?: string;
        executionMode?: "LIVE_PROVIDER_CREDENTIALS" | "DETERMINISTIC_FIXTURE_VERIFICATION";
        benchmarks?: SourceConsoleBenchmarkEntry[];
      };
      const today = new Date().toISOString().slice(0, 10);
      const matrix = await buildPortfolioReconciliationMatrix(session, {
        workspaceId: body.workspaceId,
        startDate: body.startDate ?? today,
        endDate: body.endDate ?? today,
        executionMode: body.executionMode,
        benchmarks: body.benchmarks ?? [],
      });
      return jsonResponse(matrix, 200);
    }

    if (pathname === "/api/portfolio" && method === "GET") {
      const session = await getWorkerSession(request);
      const overview = await getWorkspacePortfolioOverview(session, {
        preset: url.searchParams.get("preset"),
        startDate: url.searchParams.get("startDate"),
        endDate: url.searchParams.get("endDate"),
        compare: url.searchParams.get("compare") !== "false",
      });
      return jsonResponse(overview, 200);
    }

    const projectControlCenterMatch = pathname.match(/^\/api\/projects\/([^/]+)\/control-center$/);
    if (projectControlCenterMatch && method === "GET") {
      const session = await getWorkerSession(request);
      const projectId = decodeURIComponent(projectControlCenterMatch[1]);
      const overview = await getProjectControlCenterOverview(session, projectId, {
        environmentId: url.searchParams.get("environmentId"),
        environmentType: url.searchParams.get("environmentType") as
          | "PRODUCTION"
          | "STAGING"
          | "DEVELOPMENT"
          | null,
        preset: url.searchParams.get("preset"),
        startDate: url.searchParams.get("startDate"),
        endDate: url.searchParams.get("endDate"),
        compare: url.searchParams.get("compare") !== "false",
      });
      return jsonResponse(overview, 200);
    }

    const projectReconciliationMatch = pathname.match(/^\/api\/projects\/([^/]+)\/reconciliation$/);
    if (projectReconciliationMatch) {
      const session = await getWorkerSession(request);
      const projectId = decodeURIComponent(projectReconciliationMatch[1]);
      if (method === "GET") {
        const report = await generateProjectReconciliationReport(session, projectId, {
          environmentId: url.searchParams.get("environmentId"),
          environmentType: url.searchParams.get("environmentType") as
            | "PRODUCTION"
            | "STAGING"
            | "DEVELOPMENT"
            | null,
          preset: url.searchParams.get("preset"),
          startDate: url.searchParams.get("startDate"),
          endDate: url.searchParams.get("endDate"),
          includeToday: url.searchParams.get("includeToday") === "true",
        });
        return jsonResponse(report, 200);
      }
      if (method === "POST") {
        const body = (await request.json().catch(() => ({}))) as {
          environmentId?: string | null;
          preset?: string | null;
          startDate?: string | null;
          endDate?: string | null;
          includeToday?: boolean;
          canonicalMetricKeys?: string[];
          dimensionFilters?: Record<string, string | null | undefined>;
          benchmarks?: ProviderExpectedMetricBenchmark[];
        };
        const report = await generateProjectReconciliationReport(session, projectId, body);
        return jsonResponse(report, 200);
      }
    }

    const projectDetailMatch = pathname.match(/^\/api\/projects\/([^/]+)$/);
    if (projectDetailMatch) {
      const session = await getWorkerSession(request);
      const projectId = decodeURIComponent(projectDetailMatch[1]);
      if (method === "GET") {
        const project = await getLogicalProjectById(
          session,
          projectId,
          session?.activeWorkspace.id,
        );
        return jsonResponse({ project }, 200);
      }
      if (method === "PATCH") {
        const body = await request.json();
        const project = await updateLogicalProject(session, projectId, body, {
          expectedWorkspaceId: session?.activeWorkspace.id,
        });
        return jsonResponse({ project }, 200);
      }
    }

    if (pathname === "/api/onboarding/complete" && method === "POST") {
      const session = await getWorkerSession(request);
      const result = await completeUserOnboarding(session, session?.activeWorkspace.id ?? "");
      return jsonResponse({ ok: true, ...result }, 200);
    }

    if (pathname === "/api/connections/gcp-billing/onboarding") {
      if (method === "GET") {
        return jsonResponse(
          {
            steps: BIGQUERY_BILLING_EXPORT_ONBOARDING_STEPS,
            readOnlyGuarantee:
              "Avenor never creates or modifies Google Cloud Billing exports, datasets, or IAM bindings.",
          },
          200,
        );
      }
      if (method === "POST") {
        const session = await getWorkerSession(request);
        const body = (await request.json().catch(() => ({}))) as {
          workspaceId?: string;
          connectionId: string;
          billingAccountId: string;
          datasetProjectId: string;
          queryProjectId?: string;
          datasetId: string;
          tableId: string;
          projectId?: string | null;
          environmentId?: string | null;
        };
        const result = await completeBigQueryBillingExportOnboarding(session, body);
        return jsonResponse(result, 200);
      }
    }

    if (pathname === "/api/connections" && method === "GET") {
      const session = await getWorkerSession(request);
      const workspaceId = url.searchParams.get("workspaceId") ?? session?.activeWorkspace.id ?? "";
      const [{ connections, canManageConnections }, projects] = await Promise.all([
        listWorkspaceConnections(session, workspaceId),
        listWorkspaceProjects(session, workspaceId, { includeArchived: false }),
      ]);
      return jsonResponse(
        {
          catalog: PROVIDER_CATALOG,
          connections,
          projects,
          canManageConnections,
        },
        200,
      );
    }

    if (pathname === "/api/connections/oauth/authorize" && method === "POST") {
      const session = await getWorkerSession(request);
      const body = (await request.json()) as {
        workspaceId?: string;
        providerKey?: string;
        displayName?: string;
        requestedScopes?: string[];
        redirectUri?: string;
        reconnectConnectionId?: string;
      };
      const workspaceId = body.workspaceId ?? session?.activeWorkspace.id ?? "";
      const providerKey = (body.providerKey ?? "").trim();
      const catalogEntry = getProviderCatalogEntry(providerKey);
      const redirectUri = body.redirectUri ?? `${url.origin}/api/connections/oauth/callback`;
      const requestedScopes =
        Array.isArray(body.requestedScopes) && body.requestedScopes.length > 0
          ? body.requestedScopes
          : [...(catalogEntry?.defaultScopes ?? [])];

      const authorization = await initiateOAuthAuthorization({
        session,
        workspaceId,
        providerKey,
        authorizeEndpointUrl:
          catalogEntry?.oauthAuthorizeUrl ?? "/api/connections/oauth/sandbox-authorize",
        requestedScopes,
        redirectUri,
        operation: body.reconnectConnectionId ? "reconsent" : "connect",
        targetConnectionId: body.reconnectConnectionId,
      });
      const oauthMode = isGoogleProviderKey(providerKey) ? resolveGoogleApiMode() : "sandbox";
      const finalAuthorization =
        isGoogleProviderKey(providerKey) && oauthMode === "live"
          ? {
              ...authorization,
              authorizationUrl: buildGoogleAuthorizeUrl(authorization.authorizationUrl, {
                loginHint: session?.user.email,
              }),
            }
          : authorization;
      return jsonResponse({ authorization: finalAuthorization, oauthMode }, 201);
    }

    if (pathname === "/api/connections/oauth/callback" && method === "GET") {
      const session = await getWorkerSession(request);
      if (!session) {
        return Response.redirect(new URL("/login", url.origin).toString(), 302);
      }
      const rawStateToken = url.searchParams.get("state") ?? "";
      const pending = await resolvePendingOAuthStateDetails(rawStateToken);
      const dest = new URL("/connections", url.origin);
      if (!pending) {
        dest.searchParams.set("oauth", "error");
        dest.searchParams.set("message", "OAuth authorization state was not found or expired.");
        return Response.redirect(dest.toString(), 302);
      }
      const callbackResult = await completeOAuthCallback({
        session,
        workspaceId: pending.workspaceId,
        providerKey: pending.providerKey,
        rawStateToken,
        redirectUri: pending.redirectUri,
        authorizationCode: url.searchParams.get("code") ?? "",
        oauthError: url.searchParams.get("error") ?? undefined,
        oauthErrorDescription: url.searchParams.get("error_description") ?? undefined,
        exchangeTokenFn: isGoogleProviderKey(pending.providerKey)
          ? createGoogleOAuthTokenExchangeHandler()
          : undefined,
      });
      try {
        await discoverAndPersistConnectionResources(
          session,
          pending.workspaceId,
          callbackResult.connectionId,
        );
      } catch {
        // Diagnostics remain available in the connection drawer
      }
      dest.searchParams.set("connectedId", callbackResult.connectionId);
      dest.searchParams.set("oauth", "connected");
      dest.searchParams.set("connectionId", callbackResult.connectionId);
      dest.searchParams.set("provider", pending.providerKey);
      return Response.redirect(dest.toString(), 302);
    }

    if (pathname === "/api/connections/oauth/callback" && method === "POST") {
      const session = await getWorkerSession(request);
      const body = (await request.json()) as {
        workspaceId?: string;
        providerKey?: string;
        displayName?: string;
        stateToken?: string;
        rawStateToken?: string;
        redirectUri?: string;
        authorizationCode?: string;
        grantedScopes?: string[];
        error?: string;
        errorDescription?: string;
        externalAccountId?: string;
        externalAccountLabel?: string;
      };
      const workspaceId = body.workspaceId ?? session?.activeWorkspace.id ?? "";
      const rawStateToken = body.rawStateToken ?? body.stateToken ?? "";
      const providerKey = body.providerKey ?? "avenor-sandbox";
      const redirectUri = body.redirectUri ?? `${url.origin}/api/connections/oauth/callback`;
      const googleExchange = isGoogleProviderKey(providerKey)
        ? createGoogleOAuthTokenExchangeHandler()
        : null;
      const callbackResult = await completeOAuthCallback({
        session,
        workspaceId,
        providerKey,
        displayName: body.displayName,
        rawStateToken,
        redirectUri,
        authorizationCode: body.authorizationCode ?? "sandbox_auth_code_verified",
        oauthError: body.error,
        oauthErrorDescription: body.errorDescription,
        exchangeTokenFn: async (params) => {
          const base = googleExchange
            ? await googleExchange(params)
            : await defaultSandboxTokenExchangeHandler(params);
          return {
            ...base,
            grantedScopes:
              Array.isArray(body.grantedScopes) && body.grantedScopes.length > 0
                ? body.grantedScopes
                : base.grantedScopes,
            externalAccountId: body.externalAccountId ?? base.externalAccountId,
            externalAccountLabel: body.externalAccountLabel ?? base.externalAccountLabel,
          };
        },
      });
      let discoveredResources: Awaited<ReturnType<typeof discoverAndPersistConnectionResources>> =
        [];
      try {
        discoveredResources = await discoverAndPersistConnectionResources(
          session,
          workspaceId,
          callbackResult.connectionId,
        );
      } catch {
        discoveredResources = [];
      }
      return jsonResponse({ callbackResult, discoveredResources }, 200);
    }

    if (pathname === "/api/connections/mappings") {
      const session = await getWorkerSession(request);
      if (method === "POST") {
        const body = (await request.json()) as {
          workspaceId?: string;
          connectedResourceId?: string;
          projectId?: string;
          environmentId?: string | null;
          mappingRole?: "PRIMARY" | "SECONDARY";
        };
        const workspaceId = body.workspaceId ?? session?.activeWorkspace.id ?? "";
        const mapping = await mapResourceToProjectEnvironment(session, workspaceId, body);
        return jsonResponse({ mapping }, 201);
      }
      if (method === "DELETE") {
        let workspaceId = url.searchParams.get("workspaceId") ?? "";
        let mappingId = url.searchParams.get("mappingId") ?? "";
        if (!mappingId) {
          const body = (await request.json().catch(() => ({}))) as {
            workspaceId?: string;
            mappingId?: string;
          };
          workspaceId = workspaceId || body.workspaceId || "";
          mappingId = mappingId || body.mappingId || "";
        }
        workspaceId = workspaceId || session?.activeWorkspace.id || "";
        const result = await unmapResourceFromProject(session, workspaceId, mappingId);
        return jsonResponse({ result }, 200);
      }
    }

    const connectionDetailMatch = pathname.match(/^\/api\/connections\/([^/]+)$/);
    if (connectionDetailMatch) {
      const session = await getWorkerSession(request);
      const connectionId = decodeURIComponent(connectionDetailMatch[1]);
      if (method === "GET") {
        const workspaceId =
          url.searchParams.get("workspaceId") ?? session?.activeWorkspace.id ?? "";
        const connection = await getWorkspaceConnectionDetail(session, workspaceId, connectionId);
        return jsonResponse({ connection }, 200);
      }
      if (method === "POST") {
        const body = (await request.json()) as {
          workspaceId?: string;
          action?: "discover" | "validate" | "refresh_token" | "disconnect";
          simulationScenario?: ReadOnlyProviderContext["simulationScenario"];
          simulateInvalidGrant?: boolean;
        };
        const workspaceId = body.workspaceId ?? session?.activeWorkspace.id ?? "";
        switch (body.action) {
          case "discover": {
            const discoveredResources = await discoverAndPersistConnectionResources(
              session,
              workspaceId,
              connectionId,
            );
            const connection = await getWorkspaceConnectionDetail(
              session,
              workspaceId,
              connectionId,
            );
            return jsonResponse({ discoveredResources, connection }, 200);
          }
          case "validate": {
            const healthSnapshot = await validateConnectionHealth(
              session,
              workspaceId,
              connectionId,
              {
                simulationScenario: body.simulationScenario,
              },
            );
            const connection = await getWorkspaceConnectionDetail(
              session,
              workspaceId,
              connectionId,
            );
            return jsonResponse({ healthSnapshot, connection }, 200);
          }
          case "refresh_token": {
            const access = await authorizeWorkspaceAccess({
              session,
              workspaceId,
              requiredPermission: "connection:manage",
            });
            const googleRefresh = createGoogleOAuthRefreshHandler();
            const refreshResult = await refreshConnectionOAuthToken({
              organizationId: access.organizationId,
              workspaceId,
              connectionId,
              actorUserId: access.session.user.id,
              refreshFn: async (params) => {
                if (body.simulateInvalidGrant) {
                  return defaultSandboxTokenRefreshHandler({
                    ...params,
                    refreshToken: "invalid_grant_revoked_token",
                  });
                }
                if (isGoogleProviderKey(params.providerKey)) {
                  return googleRefresh(params);
                }
                return defaultSandboxTokenRefreshHandler(params);
              },
            });
            sharedGoogleTelemetryCache.invalidateConnection(
              access.organizationId,
              workspaceId,
              connectionId,
            );
            const connection = await getWorkspaceConnectionDetail(
              session,
              workspaceId,
              connectionId,
            );
            return jsonResponse({ refreshResult, connection }, 200);
          }
          case "disconnect": {
            const access = await authorizeWorkspaceAccess({
              session,
              workspaceId,
              requiredPermission: "connection:manage",
            });
            const disconnectResult = await disconnectProviderConnection({
              session,
              workspaceId,
              connectionId,
            });
            sharedGoogleTelemetryCache.invalidateConnection(
              access.organizationId,
              workspaceId,
              connectionId,
            );
            const connection = await getWorkspaceConnectionDetail(
              session,
              workspaceId,
              connectionId,
            );
            return jsonResponse({ disconnectResult, connection }, 200);
          }
          default:
            throw new AppError({
              code: ERROR_CODES.VALIDATION_ERROR,
              message:
                'Unsupported connection action. Expected "discover", "validate", "refresh_token", or "disconnect".',
            });
        }
      }
    }
  } catch (error) {
    return errorResponse(error);
  }

  return jsonResponse(
    { error: { code: ERROR_CODES.NOT_FOUND, message: "API route not found." } },
    404,
  );
}

export default {
  async fetch(request: Request, env: CloudflareWorkerEnv): Promise<Response> {
    syncWorkerEnvToProcess(env);
    const url = new URL(request.url);

    if (url.pathname === "/register" || url.pathname === "/register/") {
      return Response.redirect(new URL(`/signup${url.search}`, url.origin).toString(), 308);
    }

    if (url.pathname.startsWith("/api/")) {
      return handleApiRequest(request, url);
    }

    if (env.ASSETS) {
      const assetResponse = await env.ASSETS.fetch(request);
      if (assetResponse.status !== 404) {
        return assetResponse;
      }

      if (/^\/projects\/[^/]+\/audience\/?$/.test(url.pathname)) {
        const fallbackUrl = new URL("/projects/__project_detail__/audience.html", url.origin);
        return env.ASSETS.fetch(new Request(fallbackUrl.toString(), request));
      }

      if (/^\/projects\/[^/]+\/search\/?$/.test(url.pathname)) {
        const fallbackUrl = new URL("/projects/__project_detail__/search.html", url.origin);
        return env.ASSETS.fetch(new Request(fallbackUrl.toString(), request));
      }

      if (/^\/projects\/[^/]+\/?$/.test(url.pathname) && url.pathname !== "/projects/new") {
        const fallbackUrl = new URL("/projects/__project_detail__.html", url.origin);
        return env.ASSETS.fetch(new Request(fallbackUrl.toString(), request));
      }

      const notFoundUrl = new URL("/404.html", url.origin);
      const notFoundAsset = await env.ASSETS.fetch(new Request(notFoundUrl.toString(), request));
      if (notFoundAsset.ok) {
        return new Response(notFoundAsset.body, {
          status: 404,
          headers: notFoundAsset.headers,
        });
      }

      return assetResponse;
    }

    return new Response("Avenor Cloudflare Worker is running.", { status: 200 });
  },
};
