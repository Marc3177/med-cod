import { CanActivate, ExecutionContext, ForbiddenException, Injectable } from "@nestjs/common";
import { Reflector } from "@nestjs/core";
import { ROLES_KEY } from "./roles.decorator.js";
import type { AuthTokenPayload } from "./auth.service.js";

/**
 * Must run AFTER AuthGuard in the @UseGuards(...) list — it reads
 * request.user, which only AuthGuard sets. A route with no @Roles()
 * decorator is allowed for any authenticated user (role-agnostic).
 */
@Injectable()
export class RolesGuard implements CanActivate {
  constructor(private readonly reflector: Reflector) {}

  canActivate(context: ExecutionContext): boolean {
    const requiredRoles = this.reflector.getAllAndOverride<string[]>(ROLES_KEY, [
      context.getHandler(),
      context.getClass(),
    ]);
    if (!requiredRoles || requiredRoles.length === 0) return true;

    const user: AuthTokenPayload = context.switchToHttp().getRequest().user;
    if (!requiredRoles.includes(user.role)) {
      throw new ForbiddenException(`requires one of roles: ${requiredRoles.join(", ")}`);
    }
    return true;
  }
}
