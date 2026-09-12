-- AlterTable
ALTER TABLE "users" ADD COLUMN     "avatarUrl" TEXT,
ADD COLUMN     "institutionalCode" TEXT;

-- CreateIndex
CREATE UNIQUE INDEX "users_institutionalCode_key" ON "users"("institutionalCode");
