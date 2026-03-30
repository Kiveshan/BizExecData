import { Router } from "express";
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
import  { createModuleLogger } from "../../utils/logger.js";

const sageRouteLogger = createModuleLogger("sage-routes");



const router = Router();

function requireSageSession(req, res, next) {
  if (req.session?.user?.userid) {
    return next();
  }
  return res.redirect("/sagelogin");
}

router.get("/sagelogin", (req, res) => {
  sageRouteLogger.debug("Serving sagelogin page");
  res.render("sagelogin");
});

router.post("/sagelogin", async (req, res) => {
  const prisma = getPrismaClient();
  try {
    const { email, password, confirmed } = req.body;
    const normalizedEmail = typeof email === "string" ? email.trim().toLowerCase() : email;
    sageRouteLogger.debug({ email: normalizedEmail }, "Sage login attempt");

    if (!normalizedEmail || !password) {
      sageRouteLogger.warn(
        { email: normalizedEmail, hasPassword: Boolean(password) },
        "Login/registration failed - missing email or password"
      );
      return res.render("sagelogin", {
        error: "Email and password are required",
        email: normalizedEmail,
      });
    }

    const user = await prisma.user_table.findFirst({
      where: { email: normalizedEmail },
    });

    if (user) {
      sageRouteLogger.debug(
        { email: normalizedEmail, userid: user.userid, hasPasswordHash: Boolean(user.password) },
        "Existing user found"
      );

      if (!user.password) {
        sageRouteLogger.error(
          { email: normalizedEmail, userid: user.userid },
          "User record missing password hash"
        );
        return res.render("sagelogin", {
          error: "Account is misconfigured. Please contact support for assistance.",
          email: normalizedEmail,
        });
      }

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
              "Your license has not been renewed, Please contact support for assistance.",
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
        sageRouteLogger.warn({ email: normalizedEmail }, "Login failed - invalid password");
        return res.render("sagelogin", {
          error: "Invalid password for existing account",
          email: normalizedEmail,
        });
      }
    }

    if (confirmed !== "true") {
      sageRouteLogger.debug({ email: normalizedEmail }, "Registration confirmation required");
      return res.render("sagelogin", {
        error: "Please confirm registration to continue",
        email: normalizedEmail,
      });
    }

    sageRouteLogger.info({ email: normalizedEmail }, "Validating Sage credentials for new user");
    const validationResult = await validateSageCredentials(normalizedEmail, password);

    if (!validationResult.isValid) {
      sageRouteLogger.warn(
        { email: normalizedEmail, error: validationResult.error },
        "Sage credentials validation failed"
      );
      return res.render("sagelogin", {
        error: validationResult.error || "Invalid Sage credentials.",
        email: normalizedEmail,
      });
    }

    const companyData = await getCompanyData(normalizedEmail, password);

    if (!companyData.isValid || companyData.noCompanies) {
      sageRouteLogger.warn(
        { email: normalizedEmail, noCompanies: companyData.noCompanies },
        "Company data retrieval failed"
      );
      return res.render("sagelogin", {
        error: companyData.noCompanies
          ? "No companies found for your Sage account."
          : "Could not retrieve company data from Sage.",
        email: normalizedEmail,
      });
    }

    sageRouteLogger.info(
      { email: normalizedEmail, companyId: companyData.companyId },
      "Creating new Sage user"
    );
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
        email: normalizedEmail,
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
    sageRouteLogger.info(
      { newUserId, email: normalizedEmail },
      "New Sage user registered successfully"
    );

    return res.render("sagelogin", {
      error:
        "Thank you for registering with BizExecData. Please wait for our admin to approve you",
    });
  } catch (err) {
    sageRouteLogger.error(
      { err, email: req.body?.email },
      "Error during login/registration"
    );
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
    return res.json({ complete: true, progress: 100 });
  }

  if (typeof status === 'object') {
    return res.json({ complete: status.complete, progress: status.progress, total: status.total });
  }

  res.json({ complete: status, progress: status ? 100 : 0 });
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

router.get("/sagecompany", requireSageSession, (req, res) => {
  sageRouteLogger.debug("Serving sagecompany page");
  res.render("sage_company");
});

router.get("/sage_revenue", requireSageSession, (req, res) => {
  sageRouteLogger.debug("Serving sage_revenue page");
  res.render("sage_revenue");
});

router.get("/sage_expenses", requireSageSession, (req, res) => {
  sageRouteLogger.debug("Serving sage_expenses page");
  res.render("sage_expenses");
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

router.post("/validate-sage-credentials", async (req, res) => {
  try {
    const { email, password } = req.body;
    const normalizedEmail = typeof email === "string" ? email.trim().toLowerCase() : email;

    if (!normalizedEmail || !password) {
      return res.status(400).json({ isValid: false, error: "Email and password are required" });
    }

    const result = await validateSageCredentials(normalizedEmail, password);
    if (!result?.isValid) {
      return res.status(401).json({ isValid: false, error: result?.error || "Invalid Sage credentials" });
    }

    res.json({ isValid: true });
  } catch (error) {
    sageRouteLogger.error({ error }, "Error validating Sage credentials");
    res.status(500).json({ isValid: false, error: "Could not validate Sage credentials" });
  }
});

router.get("/api/sagecompany", requireSageSession, getSageCompanyData);
router.get("/api/sageprofit", requireSageSession, getSageProfitData);
router.get("/api/sageexpenses", requireSageSession, getSageExpensesData);
router.get("/api/sagerevenue", requireSageSession, getSageRevenueData);
router.get("/api/sagecostofsales", requireSageSession, getSageCostOfSalesData);

export default router;
