import { Router } from "express";
import path from "path";
import { fileURLToPath } from "url";
import { connectDb, closeDb } from "../../config/database.js";
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
  let db;
  try {
    db = await connectDb();
    const { email, password, confirmed } = req.body;
    sageRouteLogger.debug({ email }, "Sage login attempt");

    const result = await db.query("SELECT * FROM user_table WHERE email = $1", [
      email,
    ]);

    if (result.rows.length > 0) {
      const user = result.rows[0];
      sageRouteLogger.debug({ email, userid: user.userid }, "Existing user found");
      const passwordMatch = await compare(password, user.password);

      if (passwordMatch) {
        if (result.rows[0].status == "pending") {
          sageRouteLogger.warn({ userid: user.userid }, "User login failed - status pending");
          return res.render("sagelogin", {
            error:
              "Your account is awaiting approval. Please wait for our admin to approve your account",
          });
        }

        const sage_license = await db.query(
          `SELECT * FROM license_management WHERE userid = $1`,
          [result.rows[0].sage_company_id]
        );

        if (sage_license.rows[0].status == "Pending") {
          sageRouteLogger.warn({ userid: user.userid }, "User login failed - license pending");
          return res.render("sagelogin", {
            error:
              "Your license has not been renewed, Please contact our support team",
          });
        }

        req.session.user = {
          userid: user.userid,
          companyid: user.sage_company_id,
          email: user.email,
          password: encrypt(password),
        };
        sageRouteLogger.info({ userid: user.userid }, "User logged in successfully");

        if (result.rows[0].first_time_insertion == true) {
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

    const insertResult = await db.query(
      `
      INSERT INTO user_table (
        firstname, surname, sage_company_id, company_name, telephone, address, 
        company_services, first_time_insertion, accounting_software, email, password
      ) VALUES (
        'N/A', 'N/A', $1, $2, $3, $4, 'N/A', $5, 'Sage', $6, $7
      ) RETURNING sage_company_id`,
      [
        companyData.companyData.ID,
        companyData.companyData.Name,
        companyData.companyData.Telephone,
        full_address,
        true,
        email,
        hashedPassword,
      ]
    );

    const newUser = insertResult.rows[0];
    const newUserId = newUser.sage_company_id;
    const currentDate = new Date();
    await db.query(
      `
      INSERT INTO license_management(owner_name, company_name, status, date_submitted, userid)
      VALUES ('N/A', $1, 'Pending', $2, $3)`,
      [companyData.companyData.Name, currentDate, newUserId]
    );
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
  } finally {
    if (db) {
      await closeDb(db);
    }
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
  let db;
  try {
    if (!req.session.user) {
      sageRouteLogger.warn("Unauthorized start-profit-loss-process request");
      return res.status(401).json({
        success: false,
        error: "Not authenticated",
      });
    }

    db = await connectDb();
    const userid = req.session.user.userid;
    
    const userResult = await db.query(
      "SELECT first_time_insertion FROM user_table WHERE userid = $1",
      [userid]
    );
    
    const isInitialExtraction = userResult.rows.length > 0 ? userResult.rows[0].first_time_insertion : true;
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
  } finally {
    if (db) {
      await closeDb(db);
    }
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
  let db;
  try {
    db = await connectDb();
    const { email } = req.body;
    const result = await db.query("SELECT * FROM user_table WHERE email = $1", [
      email,
    ]);
    sageRouteLogger.debug({ email, exists: result.rows.length > 0 }, "Checked if user exists");
    res.json({ exists: result.rows.length > 0 });
  } catch (err) {
    sageRouteLogger.error({ err, email: req.body.email }, "Error checking if user exists");
    res.json({ exists: false, error: err.message });
  } finally {
    if (db) {
      await closeDb(db);
    }
  }
});

router.get("/api/sagecompany", getSageCompanyData);
router.get("/api/sageprofit", getSageProfitData);
router.get("/api/sageexpenses", getSageExpensesData);
router.get("/api/sagerevenue", getSageRevenueData);
router.get("/api/sagecostofsales", getSageCostOfSalesData);

export default router;
