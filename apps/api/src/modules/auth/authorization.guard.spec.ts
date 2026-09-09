import { describe, expect, it } from "vitest";
import { ForbiddenException, UnauthorizedException } from "@nestjs/common";
import type { ExecutionContext } from "@nestjs/common";
import { Reflector } from "@nestjs/core";
import jwt from "jsonwebtoken";
import { AuthGuard } from "./auth.guard.js";
import { RolesGuard } from "./roles.guard.js";
import { AuthService, type AuthTokenPayload } from "./auth.service.js";
import { AppPrismaService } from "../../prisma/app-prisma.service.js";
import { CodingController } from "../coding/coding.controller.js";
import { QueriesController } from "../queries/queries.controller.js";
import { ProviderQueriesController } from "../queries/provider-queries.controller.js";
import { AuditorController } from "../qa/auditor.controller.js";
import { QaController } from "../qa/qa.controller.js";
import { ReportingController } from "../reporting/reporting.controller.js";
import { PatientsController } from "../patients/patients.controller.js";

/**
 * Cross-module authorization at the guard level — the boundary the P0
 * per-service suites can't see, since they call service methods directly
 * and never go through AuthGuard/RolesGuard.
 *
 * A full HTTP-level e2e attempt (NestFactory.create(AppModule) + supertest)
 * was tried first and abandoned: every request carrying a real Bearer token
 * failed with "Cannot read properties of undefined (reading 'verifyToken')"
 * inside AuthGuard — its constructor-injected AuthService came back
 * undefined. Confirmed NOT a real bug by hitting an actual `npm run dev`
 * server directly with curl and real JWTs: GET /audit/queue correctly
 * returned 403 for CODER and 200 (with real data) for AUDITOR. The failure
 * only reproduces when NestFactory.create(AppModule) runs inside Vitest
 * (both via @nestjs/testing's TestingModule and via NestFactory.create
 * directly), and survived adding `reflect-metadata` as an explicit
 * vitest setupFiles entry — so it's a real, reproducible limitation of
 * booting this app's full multi-module DI graph inside Vitest/Vite's
 * transform pipeline, not an application bug. See "Testing-tool notes" in
 * docs/TEST_REPORT.md.
 *
 * This file instead unit-tests the two real guard classes directly, with a
 * real AuthService (real JWT verification, no mocking) and, for RolesGuard,
 * real controller classes/methods — so the @Roles() metadata under test is
 * the actual decorator on the actual controller, not a stand-in. What this
 * doesn't cover — whether @UseGuards(...)/@Roles(...) is actually attached
 * to the route NestJS resolves for a given HTTP path — was instead verified
 * by direct inspection of all 18 controllers (recorded in TEST_REPORT.md)
 * and spot-checked live against a running dev server.
 */
function fakeContext(opts: {
  headers?: Record<string, string>;
  user?: AuthTokenPayload;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  handler: (...args: any[]) => unknown;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  controllerClass: new (...args: any[]) => unknown;
}): ExecutionContext {
  const request: { headers: Record<string, string>; user?: AuthTokenPayload } = {
    headers: opts.headers ?? {},
    ...(opts.user ? { user: opts.user } : {}),
  };
  return {
    switchToHttp: () => ({ getRequest: () => request, getResponse: () => ({}), getNext: () => undefined }),
    getHandler: () => opts.handler,
    getClass: () => opts.controllerClass,
  } as unknown as ExecutionContext;
}

describe("AuthGuard — real AuthService, real JWT verification", () => {
  const appPrisma = new AppPrismaService();
  const authService = new AuthService(appPrisma);
  const guard = new AuthGuard(authService);

  it("rejects a request with no Authorization header", () => {
    const ctx = fakeContext({ handler: () => undefined, controllerClass: CodingController });
    expect(() => guard.canActivate(ctx)).toThrow(UnauthorizedException);
  });

  it("rejects a request with a non-Bearer Authorization header", () => {
    const ctx = fakeContext({
      headers: { authorization: "Basic abc123" },
      handler: () => undefined,
      controllerClass: CodingController,
    });
    expect(() => guard.canActivate(ctx)).toThrow(UnauthorizedException);
  });

  it("rejects a request with a malformed/invalid JWT", () => {
    const ctx = fakeContext({
      headers: { authorization: "Bearer not-a-real-token" },
      handler: () => undefined,
      controllerClass: CodingController,
    });
    expect(() => guard.canActivate(ctx)).toThrow(UnauthorizedException);
  });

  it("rejects a JWT signed with the wrong secret (forged token)", () => {
    const forged = jwt.sign({ sub: 1, email: "x@x.com", role: "ADMIN", facilityId: 1 }, "wrong-secret", {
      expiresIn: "1h",
    });
    const ctx = fakeContext({
      headers: { authorization: `Bearer ${forged}` },
      handler: () => undefined,
      controllerClass: CodingController,
    });
    expect(() => guard.canActivate(ctx)).toThrow(UnauthorizedException);
  });

  it("accepts a real, correctly-signed token and attaches its payload to the request", () => {
    const token = jwt.sign(
      { sub: 1, email: "x@x.com", role: "CODER", facilityId: 1 },
      process.env.JWT_SECRET!,
      { expiresIn: "1h" }
    );
    const request: { headers: Record<string, string>; user?: AuthTokenPayload } = {
      headers: { authorization: `Bearer ${token}` },
    };
    const ctx = {
      switchToHttp: () => ({ getRequest: () => request }),
      getHandler: () => () => undefined,
      getClass: () => CodingController,
    } as unknown as ExecutionContext;

    expect(guard.canActivate(ctx)).toBe(true);
    expect(request.user).toMatchObject({ sub: 1, email: "x@x.com", role: "CODER", facilityId: 1 });
  });
});

describe("RolesGuard — real Reflector, real controller metadata", () => {
  const guard = new RolesGuard(new Reflector());

  function userWithRole(role: string): AuthTokenPayload {
    return { sub: 1, email: "x@x.com", role, facilityId: 1 };
  }

  describe("controllers with an actual @Roles() decorator", () => {
    it("AuditorController.approve requires AUDITOR: rejects CODER/PROVIDER, allows AUDITOR", () => {
      const handler = AuditorController.prototype.approve;
      for (const role of ["CODER", "PROVIDER", "SUPERVISOR", "ADMIN"]) {
        const ctx = fakeContext({ user: userWithRole(role), handler, controllerClass: AuditorController });
        expect(() => guard.canActivate(ctx), `role ${role} should be rejected`).toThrow(ForbiddenException);
      }
      const ctx = fakeContext({ user: userWithRole("AUDITOR"), handler, controllerClass: AuditorController });
      expect(guard.canActivate(ctx)).toBe(true);
    });

    it("ProviderQueriesController.respond requires PROVIDER: rejects CODER/AUDITOR, allows PROVIDER", () => {
      const handler = ProviderQueriesController.prototype.respond;
      for (const role of ["CODER", "AUDITOR", "SUPERVISOR", "ADMIN"]) {
        const ctx = fakeContext({ user: userWithRole(role), handler, controllerClass: ProviderQueriesController });
        expect(() => guard.canActivate(ctx), `role ${role} should be rejected`).toThrow(ForbiddenException);
      }
      const ctx = fakeContext({ user: userWithRole("PROVIDER"), handler, controllerClass: ProviderQueriesController });
      expect(guard.canActivate(ctx)).toBe(true);
    });

    it("ReportingController.getSummary requires SUPERVISOR or ADMIN: rejects CODER/PROVIDER/AUDITOR, allows both", () => {
      const handler = ReportingController.prototype.getSummary;
      for (const role of ["CODER", "PROVIDER", "AUDITOR"]) {
        const ctx = fakeContext({ user: userWithRole(role), handler, controllerClass: ReportingController });
        expect(() => guard.canActivate(ctx), `role ${role} should be rejected`).toThrow(ForbiddenException);
      }
      for (const role of ["SUPERVISOR", "ADMIN"]) {
        const ctx = fakeContext({ user: userWithRole(role), handler, controllerClass: ReportingController });
        expect(guard.canActivate(ctx)).toBe(true);
      }
    });
  });

  /**
   * Documented current behavior, not asserted as correct — see the
   * "Authorization decision: role scope of coding/query mutations" entry
   * this phase adds to Known Limitations. RolesGuard itself is doing
   * exactly what it should here: with no @Roles() metadata attached at
   * all, `getAllAndOverride` returns undefined/empty and every role
   * passes. That's a controller-design choice, not a guard bug.
   */
  describe("controllers with no @Roles() decorator — every role is currently accepted", () => {
    it("CodingController.saveDraft has no role restriction: AUDITOR and PROVIDER both pass RolesGuard", () => {
      const handler = CodingController.prototype.saveDraft;
      for (const role of ["CODER", "AUDITOR", "PROVIDER", "SUPERVISOR", "ADMIN"]) {
        const ctx = fakeContext({ user: userWithRole(role), handler, controllerClass: CodingController });
        expect(guard.canActivate(ctx), `role ${role} should pass RolesGuard`).toBe(true);
      }
    });

    it("QueriesController.create has no role restriction: PROVIDER and AUDITOR both pass RolesGuard", () => {
      const handler = QueriesController.prototype.create;
      for (const role of ["CODER", "AUDITOR", "PROVIDER", "SUPERVISOR", "ADMIN"]) {
        const ctx = fakeContext({ user: userWithRole(role), handler, controllerClass: QueriesController });
        expect(guard.canActivate(ctx), `role ${role} should pass RolesGuard`).toBe(true);
      }
    });

    it("QaController.listForEncounter (view-only) has no role restriction, by design (see its own doc comment)", () => {
      const handler = QaController.prototype.listForEncounter;
      for (const role of ["CODER", "AUDITOR", "PROVIDER", "SUPERVISOR", "ADMIN"]) {
        const ctx = fakeContext({ user: userWithRole(role), handler, controllerClass: QaController });
        expect(guard.canActivate(ctx), `role ${role} should pass RolesGuard`).toBe(true);
      }
    });

    it("PatientsController.getEncounter has no role restriction: every role can view a facility's own encounters", () => {
      const handler = PatientsController.prototype.getEncounter;
      for (const role of ["CODER", "AUDITOR", "PROVIDER", "SUPERVISOR", "ADMIN"]) {
        const ctx = fakeContext({ user: userWithRole(role), handler, controllerClass: PatientsController });
        expect(guard.canActivate(ctx), `role ${role} should pass RolesGuard`).toBe(true);
      }
    });
  });
});
