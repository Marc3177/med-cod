/** One-off: adds a seeded PROVIDER-role user for testing the query workflow. */
import bcrypt from "bcryptjs";
import { PrismaClient } from "../apps/api/node_modules/.prisma/app-client/index.js";

const prisma = new PrismaClient();

async function main() {
  const passwordHash = await bcrypt.hash("provider123", 10);
  const provider = await prisma.user.upsert({
    where: { email: "provider1@med-cod.test" },
    update: { passwordHash },
    create: { email: "provider1@med-cod.test", passwordHash, role: "PROVIDER", facilityId: 1 },
  });
  console.log("seeded provider:", { id: provider.id, email: provider.email, password: "provider123" });
}

main()
  .catch((err) => {
    console.error(err);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
