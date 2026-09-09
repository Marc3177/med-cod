import { createParamDecorator, ExecutionContext } from "@nestjs/common";
import type { AuthTokenPayload } from "./auth.service.js";

export const CurrentUser = createParamDecorator((_data: unknown, ctx: ExecutionContext): AuthTokenPayload => {
  const request = ctx.switchToHttp().getRequest();
  return request.user;
});
