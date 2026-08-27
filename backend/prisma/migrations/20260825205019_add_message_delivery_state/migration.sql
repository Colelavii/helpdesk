-- AlterTable
ALTER TABLE "message" ADD COLUMN     "deliveryError" TEXT,
ADD COLUMN     "sentAt" TIMESTAMP(3);
