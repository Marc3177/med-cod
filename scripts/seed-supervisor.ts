/** One-off: adds a seeded SUPERVISOR-role user for testing the reporting dashboard. */
import bcrypt from "bcryptjs";
import { PrismaClient } from "../apps/api/node_modules/.prisma/app-client/index.js";

const prisma = new PrismaClient();

async function main() {
  const passwordHash = await bcrypt.hash("supervisor123", 10);
  const supervisor = await prisma.user.upsert({
    where: { email: "supervisor1@med-cod.test" },
    update: { passwordHash },
    create: { email: "supervisor1@med-cod.test", passwordHash, role: "SUPERVISOR", facilityId: 1 },
  });
  console.log("seeded supervisor:", { id: supervisor.id, email: supervisor.email, password: "supervisor123" });
}

main()
  .catch((err) => {
    console.error(err);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
