import { Injectable, UnauthorizedException } from "@nestjs/common";
import bcrypt from "bcryptjs";
import jwt from "jsonwebtoken";
import { AppPrismaService } from "../../prisma/app-prisma.service.js";

export type AuthTokenPayload = {
  sub: number;
  email: string;
  role: string;
  facilityId: number;
};

const TOKEN_TTL = "12h";

function isAuthTokenPayload(value: unknown): value is AuthTokenPayload {
  return (
    typeof value === "object" &&
    value !== null &&
    typeof (value as any).sub === "number" &&
    typeof (value as any).email === "string" &&
    typeof (value as any).role === "string" &&
    typeof (value as any).facilityId === "number"
  );
}

@Injectable()
export class AuthService {
  constructor(private readonly prisma: AppPrismaService) {}

  async login(email: string, password: string): Promise<{ accessToken: string; user: AuthTokenPayload }> {
    const user = await this.prisma.user.findUnique({ where: { email } });
    if (!user) throw new UnauthorizedException("invalid email or password");

    const passwordMatches = await bcrypt.compare(password, user.passwordHash);
    if (!passwordMatches) throw new UnauthorizedException("invalid email or password");

    const payload: AuthTokenPayload = {
      sub: user.id,
      email: user.email,
      role: user.role,
      facilityId: user.facilityId,
    };

    const secret = process.env.JWT_SECRET;
    if (!secret) throw new Error("JWT_SECRET is not configured");

    const accessToken = jwt.sign(payload, secret, { expiresIn: TOKEN_TTL });
    return { accessToken, user: payload };
  }

  verifyToken(token: string): AuthTokenPayload {
    const secret = process.env.JWT_SECRET;
    if (!secret) throw new Error("JWT_SECRET is not configured");

    let decoded: unknown;
    try {
      decoded = jwt.verify(token, secret);
    } catch {
      throw new UnauthorizedException("invalid or expired token");
    }

    if (!isAuthTokenPayload(decoded)) {
      throw new UnauthorizedException("malformed token payload");
    }
    return decoded;
  }
}
