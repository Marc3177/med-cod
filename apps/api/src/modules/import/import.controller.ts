import { Controller, Post, Body } from "@nestjs/common";
import { ImportService } from "./import.service.js";

@Controller("import")
export class ImportController {
  constructor(private readonly importService: ImportService) {}

  @Post("icd-10-cm/validate")
  validateIcd10Cm(@Body() body: { rows: unknown[] }) {
    return this.importService.validateIcd10Cm(body.rows);
  }
}
