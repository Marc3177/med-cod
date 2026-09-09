import { Body, Controller, Post, UseGuards } from "@nestjs/common";
import { FhirService } from "./fhir.service.js";
import { AuthGuard } from "../auth/auth.guard.js";
import { CurrentUser } from "../auth/current-user.decorator.js";
import type { AuthTokenPayload } from "../auth/auth.service.js";

/** FHIR R4 Bundle ingestion — the "real feed" that would replace manual
 *  document entry against a live EHR. Ingested resources are attached to
 *  the calling user's own facility (a real integration would use a
 *  facility-scoped service account, same idea). */
@Controller("fhir")
@UseGuards(AuthGuard)
export class FhirController {
  constructor(private readonly fhirService: FhirService) {}

  @Post("bundle")
  ingestBundle(@Body() bundle: unknown, @CurrentUser() user: AuthTokenPayload) {
    return this.fhirService.ingestBundle(bundle, user.facilityId);
  }
}
