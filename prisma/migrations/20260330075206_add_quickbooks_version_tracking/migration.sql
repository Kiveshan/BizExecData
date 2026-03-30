-- CreateTable
CREATE TABLE "quickbooks_version_history" (
    "id" SERIAL NOT NULL,
    "userid" INTEGER NOT NULL,
    "qbo_edition_id" TEXT,
    "subscription_status" TEXT,
    "subscribed_services" TEXT,
    "industry_type" TEXT,
    "checked_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "quickbooks_version_history_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "quickbooks_version_history_userid_key" ON "quickbooks_version_history"("userid");

-- AddForeignKey
ALTER TABLE "quickbooks_version_history" ADD CONSTRAINT "quickbooks_version_history_userid_fkey" FOREIGN KEY ("userid") REFERENCES "user_table"("userid") ON DELETE CASCADE ON UPDATE CASCADE;
