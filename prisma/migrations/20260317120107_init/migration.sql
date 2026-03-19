-- CreateTable
CREATE TABLE "company_calcs" (
    "calcid" SERIAL NOT NULL,
    "userid" INTEGER,
    "grossprofit" DECIMAL(65,30),
    "opexpenses" DECIMAL(65,30),
    "netprofit" DECIMAL(65,30),
    "sumofsales" DECIMAL(65,30),
    "sumofcost" DECIMAL(65,30),
    "date" DATE,

    CONSTRAINT "company_calcs_pkey" PRIMARY KEY ("calcid")
);

-- CreateTable
CREATE TABLE "costofsales" (
    "costofsalesid" SERIAL NOT NULL,
    "costofsales" DECIMAL(65,30),
    "date" DATE,
    "userid" INTEGER,
    "category" TEXT,
    "transaction_id" INTEGER,

    CONSTRAINT "costofsales_pkey" PRIMARY KEY ("costofsalesid")
);

-- CreateTable
CREATE TABLE "excel_companydata" (
    "id" SERIAL NOT NULL,
    "userid" INTEGER,
    "category" TEXT,
    "subcategory" TEXT,
    "date" DATE,
    "amount" DECIMAL(65,30),

    CONSTRAINT "excel_companydata_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "expenses" (
    "expenseid" SERIAL NOT NULL,
    "category" TEXT,
    "expenses" DECIMAL(65,30),
    "date" DATE,
    "userid" INTEGER,
    "transaction_id" INTEGER,

    CONSTRAINT "expenses_pkey" PRIMARY KEY ("expenseid")
);

-- CreateTable
CREATE TABLE "license_management" (
    "licenseid" SERIAL NOT NULL,
    "owner_name" TEXT,
    "company_name" TEXT,
    "status" TEXT,
    "date_submitted" DATE,
    "expiration_date" DATE,
    "userid" TEXT,

    CONSTRAINT "license_management_pkey" PRIMARY KEY ("licenseid")
);

-- CreateTable
CREATE TABLE "revenue" (
    "revenue_id" SERIAL NOT NULL,
    "revenue" DECIMAL(65,30),
    "date" DATE,
    "userid" INTEGER,
    "category" TEXT,
    "transaction_id" INTEGER,

    CONSTRAINT "revenue_pkey" PRIMARY KEY ("revenue_id")
);

-- CreateTable
CREATE TABLE "roles" (
    "roleid" SERIAL NOT NULL,
    "rolename" VARCHAR(100) NOT NULL,

    CONSTRAINT "roles_pkey" PRIMARY KEY ("roleid")
);

-- CreateTable
CREATE TABLE "sage_company_calcs" (
    "sage_calc_id" SERIAL NOT NULL,
    "userid" INTEGER,
    "grossprofit" DECIMAL(65,30),
    "opexpenses" DECIMAL(65,30),
    "netprofit" DECIMAL(65,30),
    "sumofsales" DECIMAL(65,30),
    "sumofcost" DECIMAL(65,30),
    "date" DATE,

    CONSTRAINT "sage_company_calcs_pkey" PRIMARY KEY ("sage_calc_id")
);

-- CreateTable
CREATE TABLE "sage_costofsales" (
    "costofsalesid" SERIAL NOT NULL,
    "userid" INTEGER,
    "category" TEXT,
    "costofsales" DECIMAL(65,30),
    "date" DATE,

    CONSTRAINT "sage_costofsales_pkey" PRIMARY KEY ("costofsalesid")
);

-- CreateTable
CREATE TABLE "sage_expenses" (
    "expenseid" SERIAL NOT NULL,
    "userid" INTEGER,
    "category" TEXT,
    "amount" DECIMAL(65,30),
    "date" DATE,

    CONSTRAINT "sage_expenses_pkey" PRIMARY KEY ("expenseid")
);

-- CreateTable
CREATE TABLE "sage_revenue" (
    "revenueid" SERIAL NOT NULL,
    "userid" INTEGER,
    "category" TEXT,
    "revenue" DECIMAL(65,30),
    "date" DATE,

    CONSTRAINT "sage_revenue_pkey" PRIMARY KEY ("revenueid")
);

-- CreateTable
CREATE TABLE "user_table" (
    "userid" SERIAL NOT NULL,
    "firstname" VARCHAR(50) NOT NULL,
    "surname" VARCHAR(50) NOT NULL,
    "company_name" VARCHAR(100),
    "email" VARCHAR(100),
    "address" TEXT,
    "telephone" VARCHAR(20),
    "password" TEXT,
    "accounting_software" VARCHAR(50),
    "company_services" TEXT,
    "created_at" TIMESTAMP(6) DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(6) DEFAULT CURRENT_TIMESTAMP,
    "roleid" INTEGER,
    "status" VARCHAR(50) DEFAULT 'pending',
    "first_time_insertion" BOOLEAN,
    "company_id" BIGINT,
    "xero_company_id" UUID,
    "sage_company_id" BIGINT,

    CONSTRAINT "user_table_pkey" PRIMARY KEY ("userid")
);

-- CreateTable
CREATE TABLE "xero_company_calcs" (
    "xero_calc_id" SERIAL NOT NULL,
    "userid" INTEGER,
    "grossprofit" DECIMAL(65,30),
    "opexpenses" DECIMAL(65,30),
    "netprofit" DECIMAL(65,30),
    "sumofsales" DECIMAL(65,30),
    "sumofcost" DECIMAL(65,30),
    "date" DATE,

    CONSTRAINT "xero_company_calcs_pkey" PRIMARY KEY ("xero_calc_id")
);

-- CreateTable
CREATE TABLE "xero_costofsales" (
    "costofsalesid" SERIAL NOT NULL,
    "userid" INTEGER,
    "category" TEXT,
    "costofsales" DECIMAL(65,30),
    "date" DATE,

    CONSTRAINT "xero_costofsales_pkey" PRIMARY KEY ("costofsalesid")
);

-- CreateTable
CREATE TABLE "xero_expenses" (
    "expenseid" SERIAL NOT NULL,
    "userid" INTEGER,
    "category" TEXT,
    "amount" DECIMAL(65,30),
    "date" DATE,

    CONSTRAINT "xero_expenses_pkey" PRIMARY KEY ("expenseid")
);

-- CreateTable
CREATE TABLE "xero_revenue" (
    "revenueid" SERIAL NOT NULL,
    "userid" INTEGER,
    "category" TEXT,
    "revenue" DECIMAL(65,30),
    "date" DATE,

    CONSTRAINT "xero_revenue_pkey" PRIMARY KEY ("revenueid")
);

-- CreateIndex
CREATE UNIQUE INDEX "user_table_email_key" ON "user_table"("email");

-- AddForeignKey
ALTER TABLE "company_calcs" ADD CONSTRAINT "company_calcs_userid_fkey" FOREIGN KEY ("userid") REFERENCES "user_table"("userid") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "costofsales" ADD CONSTRAINT "costofsales_userid_fkey" FOREIGN KEY ("userid") REFERENCES "user_table"("userid") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "excel_companydata" ADD CONSTRAINT "excel_companydata_userid_fkey" FOREIGN KEY ("userid") REFERENCES "user_table"("userid") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "expenses" ADD CONSTRAINT "expenses_userid_fkey" FOREIGN KEY ("userid") REFERENCES "user_table"("userid") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "revenue" ADD CONSTRAINT "revenue_userid_fkey" FOREIGN KEY ("userid") REFERENCES "user_table"("userid") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "sage_company_calcs" ADD CONSTRAINT "sage_company_calcs_userid_fkey" FOREIGN KEY ("userid") REFERENCES "user_table"("userid") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "sage_costofsales" ADD CONSTRAINT "sage_costofsales_userid_fkey" FOREIGN KEY ("userid") REFERENCES "user_table"("userid") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "sage_expenses" ADD CONSTRAINT "sage_expenses_userid_fkey" FOREIGN KEY ("userid") REFERENCES "user_table"("userid") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "sage_revenue" ADD CONSTRAINT "sage_revenue_userid_fkey" FOREIGN KEY ("userid") REFERENCES "user_table"("userid") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "user_table" ADD CONSTRAINT "user_table_roleid_fkey" FOREIGN KEY ("roleid") REFERENCES "roles"("roleid") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "xero_company_calcs" ADD CONSTRAINT "xero_company_calcs_userid_fkey" FOREIGN KEY ("userid") REFERENCES "user_table"("userid") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "xero_costofsales" ADD CONSTRAINT "xero_costofsales_userid_fkey" FOREIGN KEY ("userid") REFERENCES "user_table"("userid") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "xero_expenses" ADD CONSTRAINT "xero_expenses_userid_fkey" FOREIGN KEY ("userid") REFERENCES "user_table"("userid") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "xero_revenue" ADD CONSTRAINT "xero_revenue_userid_fkey" FOREIGN KEY ("userid") REFERENCES "user_table"("userid") ON DELETE CASCADE ON UPDATE CASCADE;
