import { Router } from "express";
import path from "path";
import { fileURLToPath } from "url";
import { getPrismaClient } from "../../config/prismaClient.js";
import { hash, compare } from "bcrypt";
import { encrypt } from "../../utils/crypto.js";
import {
  validateSageCredentials,
  getCompanyData,
  generateMonthlyDateRanges,
  processMonthlyData,
  extractionStatus,
  getSageCompanyData,
  getSageProfitData,
  getSageExpensesData,
  getSageRevenueData,
  getSageCostOfSalesData,
} from "./controller.js";
import logger, { createModuleLogger } from "../../utils/logger.js";

const sageRouteLogger = createModuleLogger("sage-routes");

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const router = Router();

router.get("/sagelogin", (req, res) => {
  sageRouteLogger.debug("Serving sagelogin page");
  res.render("sagelogin");
});

router.post("/sagelogin", async (req, res) => {
  const prisma = getPrismaClient();
  try {
    const { email, password, confirmed } = req.body;
    sageRouteLogger.debug({ email }, "Sage login attempt");

    const user = await prisma.user_table.findFirst({
      where: { email },
    });

    if (user) {
      sageRouteLogger.debug({ email, userid: user.userid }, "Existing user found");
      const passwordMatch = await compare(password, user.password);

      if (passwordMatch) {
        if (user.status == "pending") {
          sageRouteLogger.warn({ userid: user.userid }, "User login failed - status pending");
          return res.render("sagelogin", {
            error:
              "Your account is awaiting approval. Please wait for our admin to approve your account",
          });
        }

        const sage_license = await prisma.license_management.findFirst({
          where: { userid: String(user.sage_company_id) },
        });

        if (sage_license?.status == "Pending") {
          sageRouteLogger.warn({ userid: user.userid }, "User login failed - license pending");
          return res.render("sagelogin", {
            error:
              "Your license has not been renewed, Please contact our support team",
          });
        }

        req.session.user = {
          userid: user.userid,
          companyid: String(user.sage_company_id),
          email: user.email,
          password: encrypt(password),
        };
        sageRouteLogger.info({ userid: user.userid }, "User logged in successfully");

        if (user.first_time_insertion == true) {
          sageRouteLogger.info({ userid: user.userid }, "Redirecting to initial extraction");
          return res.redirect("/extract-profit-loss");
        }

        return res.redirect("/sagecompany");
      } else {
        sageRouteLogger.warn({ email }, "Login failed - invalid password");
        return res.render("sagelogin", {
          error: "Invalid password for existing account",
          email: email,
        });
      }
    }

    if (confirmed !== "true") {
      sageRouteLogger.debug({ email }, "Registration confirmation required");
      return res.render("sagelogin", {
        error: "Please confirm registration to continue",
        email: email,
      });
    }

    sageRouteLogger.info({ email }, "Validating Sage credentials for new user");
    const validationResult = await validateSageCredentials(email, password);

    if (!validationResult.isValid) {
      sageRouteLogger.warn({ email, error: validationResult.error }, "Sage credentials validation failed");
      return res.render("sagelogin", {
        error: validationResult.error || "Invalid Sage credentials.",
        email: email,
      });
    }

    const companyData = await getCompanyData(email, password);

    if (!companyData.isValid || companyData.noCompanies) {
      sageRouteLogger.warn({ email, noCompanies: companyData.noCompanies }, "Company data retrieval failed");
      return res.render("sagelogin", {
        error: companyData.noCompanies
          ? "No companies found for your Sage account."
          : "Could not retrieve company data from Sage.",
        email: email,
      });
    }

    sageRouteLogger.info({ email, companyId: companyData.companyId }, "Creating new Sage user");
    const saltRounds = 10;
    const hashedPassword = await hash(password, saltRounds);

    const full_address =
      companyData.companyData.CompanyInfo01 +
      "," +
      companyData.companyData.CompanyInfo02 +
      "," +
      companyData.companyData.CompanyInfo03 +
      "," +
      companyData.companyData.CompanyInfo04 +
      "," +
      companyData.companyData.CompanyInfo05;

    const createdUser = await prisma.user_table.create({
      data: {
        firstname: "N/A",
        surname: "N/A",
        sage_company_id: BigInt(companyData.companyData.ID),
        company_name: companyData.companyData.Name,
        telephone: companyData.companyData.Telephone,
        address: full_address,
        company_services: "N/A",
        first_time_insertion: true,
        accounting_software: "Sage",
        email,
        password: hashedPassword,
      },
      select: {
        sage_company_id: true,
      },
    });

    const newUserId = createdUser.sage_company_id;
    const currentDate = new Date();

    await prisma.license_management.create({
      data: {
        owner_name: "N/A",
        company_name: companyData.companyData.Name,
        status: "Pending",
        date_submitted: currentDate,
        userid: String(newUserId),
      },
    });
    sageRouteLogger.info({ newUserId, email }, "New Sage user registered successfully");

    return res.render("sagelogin", {
      error:
        "Thank you for registering with BizExecData. Please wait for our admin to approve you",
    });
  } catch (err) {
    sageRouteLogger.error({ err, email: req.body.email }, "Error during login/registration");
    res.render("sagelogin", {
      error: "An error occurred during login/registration. Please try again.",
      email: req.body.email,
    });
  }
});

router.get("/extract-profit-loss", (req, res) => {
  if (!req.session.user) {
    sageRouteLogger.warn("Unauthorized access to extract-profit-loss page");
    return res.redirect("/sagelogin");
  }
  sageRouteLogger.debug({ userid: req.session.user.userid }, "Serving extract-profit-loss page");
  res.render("profit-loss-loading", {
    source: "sage",
    title: "Extracting Sage Data",
    description: "We're extracting your profit and loss data from Sage.",
  });
});

router.get("/check-extraction-complete", (req, res) => {
  if (!req.session.user) {
    sageRouteLogger.warn("Unauthorized check-extraction-complete request");
    return res.status(401).json({
      complete: false,
      error: "Not authenticated",
    });
  }

  const userid = req.session.user.userid;
  const status = extractionStatus.sage[userid];
  sageRouteLogger.debug({ userid, status }, "Extraction status checked");

  if (status === undefined) {
    return res.json({ complete: true });
  }

  res.json({ complete: status });
});

router.post("/start-profit-loss-process", async (req, res) => {
  try {
    if (!req.session.user) {
      sageRouteLogger.warn("Unauthorized start-profit-loss-process request");
      return res.status(401).json({
        success: false,
        error: "Not authenticated",
      });
    }

    const prisma = getPrismaClient();
    const userid = req.session.user.userid;

    const user = await prisma.user_table.findUnique({
      where: { userid },
      select: { first_time_insertion: true },
    });

    const isInitialExtraction = user?.first_time_insertion ?? true;
    sageRouteLogger.info({ userid, isInitialExtraction }, "Starting Sage data extraction");

    const companyid = req.session.user.companyid;
    const email = req.session.user.email;
    const encryptedPassword = req.session.user.password;

    const dateRanges = generateMonthlyDateRanges(isInitialExtraction, 0);
    processMonthlyData(userid, dateRanges, companyid, email, encryptedPassword);

    res.json({
      success: true,
      message: "Data extraction started",
    });
  } catch (error) {
    sageRouteLogger.error({ error }, "Error starting profit and loss process");
    res.status(500).json({
      success: false,
      error: "Failed to start profit and loss process: " + error.message,
    });
  }
});

router.get("/getProfitandLoss", async (req, res) => {
  if (!req.session.user) {
    sageRouteLogger.warn("Unauthorized getProfitandLoss request");
    return res.redirect("/sagelogin");
  }
  sageRouteLogger.debug({ userid: req.session.user.userid }, "Redirecting to extract-profit-loss");
  res.redirect("/extract-profit-loss");
});

router.get("/sagecompany", (req, res) => {
  sageRouteLogger.debug("Serving sagecompany page");
  res.sendFile(path.join(__dirname, "..", "..", "..", "public", "sage_company.html"));
});

router.post("/check-user-exists", async (req, res) => {
  const prisma = getPrismaClient();
  try {
    const { email } = req.body;
    const existing = await prisma.user_table.findFirst({
      where: { email },
      select: { userid: true },
    });
    sageRouteLogger.debug({ email, exists: !!existing }, "Checked if user exists");
    res.json({ exists: !!existing });
  } catch (err) {
    sageRouteLogger.error({ err, email: req.body.email }, "Error checking if user exists");
    res.json({ exists: false, error: err.message });
  }
});

router.get("/api/sagecompany", getSageCompanyData);
router.get("/api/sageprofit", getSageProfitData);
router.get("/api/sageexpenses", getSageExpensesData);
router.get("/api/sagerevenue", getSageRevenueData);
router.get("/api/sagecostofsales", getSageCostOfSalesData);

export default router;
