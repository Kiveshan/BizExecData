-- CreateTable
CREATE TABLE "quickbooks_oauth_token" (
    "id" SERIAL NOT NULL,
    "userid" INTEGER NOT NULL,
    "realm_id" TEXT,
    "access_token" TEXT NOT NULL,
    "refresh_token" TEXT NOT NULL,
    "expires_at" TIMESTAMP(3) NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "quickbooks_oauth_token_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "quickbooks_oauth_token_userid_key" ON "quickbooks_oauth_token"("userid");

-- AddForeignKey
ALTER TABLE "quickbooks_oauth_token" ADD CONSTRAINT "quickbooks_oauth_token_userid_fkey" FOREIGN KEY ("userid") REFERENCES "user_table"("userid") ON DELETE CASCADE ON UPDATE CASCADE;
