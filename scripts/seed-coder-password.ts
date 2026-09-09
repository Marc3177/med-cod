/**
 * One-off: re-creates the seeded coder user with a real password hash,
 * after the User table was cleared to add the required passwordHash column.
 * Does not touch patients/encounters — those already exist from seed-app-db.ts.
 */
import bcrypt from "bcryptjs";
import { PrismaClient } from "../apps/api/node_modules/.prisma/app-client/index.js";

const prisma = new PrismaClient();

async function main() {
  const passwordHash = await bcrypt.hash("coder123", 10);
  const coder = await prisma.user.upsert({
    where: { email: "coder1@med-cod.test" },
    update: { passwordHash },
    create: { email: "coder1@med-cod.test", passwordHash, role: "CODER", facilityId: 1 },
  });
  console.log("seeded coder:", { id: coder.id, email: coder.email, password: "coder123" });
}

main()
  .catch((err) => {
    console.error(err);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
