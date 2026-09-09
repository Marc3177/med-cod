/** One-off: adds a seeded AUDITOR-role user for testing the QA workflow. */
import bcrypt from "bcryptjs";
import { PrismaClient } from "../apps/api/node_modules/.prisma/app-client/index.js";

const prisma = new PrismaClient();

async function main() {
  const passwordHash = await bcrypt.hash("auditor123", 10);
  const auditor = await prisma.user.upsert({
    where: { email: "auditor1@med-cod.test" },
    update: { passwordHash },
    create: { email: "auditor1@med-cod.test", passwordHash, role: "AUDITOR", facilityId: 1 },
  });
  console.log("seeded auditor:", { id: auditor.id, email: auditor.email, password: "auditor123" });
}

main()
  .catch((err) => {
    console.error(err);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
