import {
  authenticateUser,
  authorizeWorkspaceAccess,
  completeOAuthCallback,
  completeUserOnboarding,
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
  listWorkspaceProjects,
  refreshConnectionOAuthToken,
  registerUserWithDefaultOwnership,
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
import { AppError, ERROR_CODES, type ReadOnlyProviderContext, toAppError } from "@avenor/types";
import {
  discoverAndPersistConnectionResources,
  getWorkspaceConnectionDetail,
  listWorkspaceConnections,
  mapResourceToProjectEnvironment,
  unmapResourceFromProject,
  validateConnectionHealth,
} from "../src/lib/connections";
import { getProviderCatalogEntry, PROVIDER_CATALOG } from "../src/lib/providers";

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
        const body = await request.json();
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
      return jsonResponse({ authorization }, 201);
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
          const base = await defaultSandboxTokenExchangeHandler(params);
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
            const refreshResult = await refreshConnectionOAuthToken({
              organizationId: access.organizationId,
              workspaceId,
              connectionId,
              actorUserId: access.session.user.id,
              ...(body.simulateInvalidGrant
                ? {
                    refreshFn: async (params) =>
                      defaultSandboxTokenRefreshHandler({
                        ...params,
                        refreshToken: "invalid_grant_revoked_token",
                      }),
                  }
                : {}),
            });
            const connection = await getWorkspaceConnectionDetail(
              session,
              workspaceId,
              connectionId,
            );
            return jsonResponse({ refreshResult, connection }, 200);
          }
          case "disconnect": {
            const disconnectResult = await disconnectProviderConnection({
              session,
              workspaceId,
              connectionId,
            });
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
