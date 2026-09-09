import { CanActivate, ExecutionContext, Injectable, UnauthorizedException } from "@nestjs/common";
import { AuthService } from "./auth.service.js";

@Injectable()
export class AuthGuard implements CanActivate {
  constructor(private readonly authService: AuthService) {}

  canActivate(context: ExecutionContext): boolean {
    const request = context.switchToHttp().getRequest();
    const header: string | undefined = request.headers["authorization"];
    if (!header?.startsWith("Bearer ")) {
      throw new UnauthorizedException("missing bearer token");
    }

    const token = header.slice("Bearer ".length);
    request.user = this.authService.verifyToken(token);
    return true;
  }
}
