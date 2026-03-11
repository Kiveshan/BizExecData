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

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const router = Router();

router.get("/sagelogin", (req, res) => {
  res.render("sagelogin");
});

router.post("/sagelogin", async (req, res) => {
  let db;
  try {
    db = await connectDb();
    const { email, password, confirmed } = req.body;

    const result = await db.query("SELECT * FROM user_table WHERE email = $1", [
      email,
    ]);

    if (result.rows.length > 0) {
      const user = result.rows[0];
      const passwordMatch = await compare(password, user.password);

      if (passwordMatch) {
        if (result.rows[0].status == "pending") {
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

        if (result.rows[0].first_time_insertion == false) {
          return res.redirect("/extract-profit-loss");
        }

        return res.redirect("/sagecompany");
      } else {
        return res.render("sagelogin", {
          error: "Invalid password for existing account",
          email: email,
        });
      }
    }

    if (confirmed !== "true") {
      return res.render("sagelogin", {
        error: "Please confirm registration to continue",
        email: email,
      });
    }

    const validationResult = await validateSageCredentials(email, password);

    if (!validationResult.isValid) {
      return res.render("sagelogin", {
        error: validationResult.error || "Invalid Sage credentials.",
        email: email,
      });
    }

    const companyData = await getCompanyData(email, password);

    if (!companyData.isValid || companyData.noCompanies) {
      return res.render("sagelogin", {
        error: companyData.noCompanies
          ? "No companies found for your Sage account."
          : "Could not retrieve company data from Sage.",
        email: email,
      });
    }

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
        false,
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

    return res.render("sagelogin", {
      error:
        "Thank you for registering with BizExecData. Please wait for our admin to approve you",
    });
  } catch (err) {
    console.error("Error during login/registration:", err);
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
    return res.redirect("/sagelogin");
  }
  res.render("profit-loss-loading", {
    source: "sage",
    title: "Extracting Sage Data",
    description: "We're extracting your profit and loss data from Sage.",
  });
});

router.get("/check-extraction-complete", (req, res) => {
  if (!req.session.user) {
    return res.status(401).json({
      complete: false,
      error: "Not authenticated",
    });
  }

  const userid = req.session.user.userid;

  if (extractionStatus.sage[userid] === undefined) {
    return res.json({ complete: true });
  }

  res.json({ complete: extractionStatus.sage[userid] });
});

router.post("/start-profit-loss-process", async (req, res) => {
  try {
    if (!req.session.user) {
      return res.status(401).json({
        success: false,
        error: "Not authenticated",
      });
    }

    const companyid = req.session.user.companyid;
    const userid = req.session.user.userid;
    const email = req.session.user.email;
    const encryptedPassword = req.session.user.password;

    const dateRanges = generateMonthlyDateRanges(2024, 0);
    processMonthlyData(userid, dateRanges, companyid, email, encryptedPassword);

    res.json({
      success: true,
      message: "Data extraction started",
    });
  } catch (error) {
    console.error("Error starting profit and loss process:", error);
    res.status(500).json({
      success: false,
      error: "Failed to start profit and loss process: " + error.message,
    });
  }
});

router.get("/getProfitandLoss", async (req, res) => {
  if (!req.session.user) {
    return res.redirect("/sagelogin");
  }
  res.redirect("/extract-profit-loss");
});

router.get("/sagecompany", (req, res) => {
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
    res.json({ exists: result.rows.length > 0 });
  } catch (err) {
    console.error("Error checking if user exists:", err);
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
