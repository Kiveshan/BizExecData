// Import necessary modules using ES module syntax
import express from "express";
import pg from "pg";
import dotenv from "dotenv";
import path from "path";
import { fileURLToPath } from "url";
import OAuthClient from "intuit-oauth";
import bodyParser from "body-parser";
import flash from "express-flash";
import session from "express-session";
import methodOverride from "method-override";
import passport from "passport";
import initializePassport from "./passport-config.js";
import { hash, compare } from "bcrypt";
import jsonpath from "jsonpath";
import _ from "lodash";
import fileUpload from "express-fileupload"; // New library for file upload
import xlsx from "xlsx";
import fs from "fs";
import { XeroClient } from "xero-node";

// Initialize express and dotenv
dotenv.config();
const app = express();
const port = process.env.PORT || 3000;

app.use(express.json());
app.set("view engine", "ejs");

// PostgreSQL connection settings
async function connectDb() {
  const db = new pg.Client({
    user: process.env.RDS_USERNAME || "postgres",
    host: process.env.RDS_HOSTNAME || "localhost",
    database: process.env.RDS_DB_NAME || "BizExecData",
    password: process.env.RDS_PASSWORD || "123456",
    port: process.env.RDS_PORT || 5433,
    ssl: process.env.DB_SSL ? { rejectUnauthorized: false } : false,
  });
  await db.connect();
  return db;
}

async function closeDb(db) {
  await db.end();
}

dotenv.config();

// Static files middleware
app.use(express.static("public"));

initializePassport(passport);

// Middleware
app.use(bodyParser.urlencoded({ extended: true }));
app.use(express.static("public"));
app.use(flash());
app.use(
  session({
    secret: process.env.SESSION_SECRET,
    resave: false,
    saveUninitialized: false,
  })
);
app.use(passport.initialize());
app.use(passport.session());
app.use(methodOverride("_method"));

const authenticateToken = (req, res, next) => {
  const token = req.headers["authorization"];
  if (!token) return res.sendStatus(401);

  jwt.verify(token, process.env.JWT_SECRET, (err, user) => {
    if (err) return res.sendStatus(403);
    req.user = user;
    next();
  });
};

// Middleware to check if the user is an admin
const isAdmin = (req, res, next) => {
  if (req.user.roleid !== 10) return res.sendStatus(403);
  next();
};

// Helper to get __dirname equivalent in ESM
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const authurl = "/callback";
let oauth2_token_json = null;

////////////
async function checkAuthenticated(req, res, next) {
  if (req.isAuthenticated()) {
    return next();
  }
  res.redirect("/login");
}

function checkNotAuthenticated(req, res, next) {
  if (req.isAuthenticated()) {
    return res.redirect("/dashboard");
  }
  next();
}

// Define the registration route
app.post("/register1", async (req, res) => {
  const { email, password } = req.body;

  try {
    if (!email || !password) {
      throw new Error("Email and password are required");
    }
    const user = await createUser({ email, password });
    res.redirect("/login");
  } catch (error) {
    console.error("Registration error:", error);
    res
      .status(400)
      .send(
        `<html><body><h1>Error: ${error.message}</h1><p>Please go back and try again.</p></body></html>`
      );
  }
});

// Login Function
async function login(req, res, next) {
  const db = await connectDb();

  passport.authenticate("local", async (err, user, info) => {
    try {
      if (err || !user) {
        return res.render("login", {
          error: "Account does not exsist please register",
        });
      }

      // Assuming you have a function that retrieves a user by their email
      const loggedInUser = await findUserByEmail(user.email);

      const exsistingLicense = await db.query(
        `SELECT * FROM license_management WHERE userid = $1`,
        [user.userid]
      );

      // Check if the user is an admin
      if (loggedInUser.roleid === 3) {
        // Admin users bypass the status and licensing checks
        req.login(user, async (err) => {
          if (err) {
            return next(err);
          }

          // Store user info in session for admins
          req.session.roleid = loggedInUser.roleid;
          req.session.userid = loggedInUser.userid;

          return res.redirect("/dashboard"); // Redirect to the dashboard
        });
      } else {
        // Regular users need to go through the checks
        // Check if the user's status is approved
        if (loggedInUser.status !== "approved") {
          return res.render("login", {
            error: "Please wait for our admin to approve you.",
          });
        }

        // Check if the existing license is paid
        if (
          exsistingLicense.rows.length === 0 ||
          exsistingLicense.rows[0].status !== "Paid"
        ) {
          return res.render("login", {
            error: "Please ensure you purchase licensing for the software.",
          });
        }

        req.login(user, async (err) => {
          if (err) {
            return next(err);
          }

          // Store user info in session for regular users
          req.session.roleid = loggedInUser.roleid;
          req.session.userid = loggedInUser.userid;

          return res.redirect("/dashboard"); // Redirect to the dashboard
        });
      }
    } catch (error) {
      return next(error);
    } finally {
      await closeDb(db); // Ensure the connection is closed
    }
  })(req, res, next);
}

// Logout Function
async function logout(req, res) {
  req.logout(function (err) {
    if (err) {
      console.error("Error logging out:", err);
      res.status(500).send("Internal Server Error");
      return;
    }
    res.redirect("/index");
  });
}

export async function findUserByEmail(email) {
  const db = await connectDb();
  try {
    const query = {
      text: "SELECT * FROM user_table WHERE email = $1",
      values: [email],
    };
    const result = await db.query(query);
    return result.rows[0];
  } catch (error) {
    console.error("Error finding user by email:", error);
    throw error;
  } finally {
    await closeDb(db);
  }
}

export async function findUserById(userid) {
  const db = await connectDb();
  try {
    const query = {
      text: "SELECT * FROM user_table WHERE userid = $1",
      values: [userid],
    };
    const result = await db.query(query);
    return result.rows[0];
  } catch (error) {
    console.error("Error finding user by userid:", error);
    throw error;
  } finally {
    await closeDb(db);
  }
}

export async function findRoleIdByRoleName(rolename) {
  const db = await connectDb();
  try {
    const query = {
      text: "SELECT roleid FROM roles WHERE rolename = $1",
      values: [rolename],
    };
    const result = await db.query(query);
    return result.rows[0]?.roleid;
  } catch (error) {
    console.error("Error finding role by rolename:", error);
    throw error;
  } finally {
    await closeDb(db);
  }
}

// Generic dashboard route to handle different roles
app.get("/dashboard", checkAuthenticated, async (req, res) => {
  const roleId = req.session.roleid;
  switch (roleId) {
    case 1:
      res.redirect("/company");
      break;
    case 2:
      res.redirect("/company");
      break;
    case 3:
      res.redirect("/adminmenu");
      break;
    case 4:
      res.redirect("/excel_dashboard");
      break;
    default:
      res.redirect("/login");
  }
});

app.get("/login", checkNotAuthenticated, (req, res) => {
  res.render("login.ejs");
});

app.get("/register1", checkNotAuthenticated, (req, res) => {
  res.render("register1.ejs");
});

app.get("/forgot-password", checkNotAuthenticated, (req, res) => {
  res.render("forgot-password.ejs");
});

app.get("/StudentDashboard", checkAuthenticated, (req, res) => {
  res.render("newstudentdash.ejs");
});

app.get("/adminDashboard", checkAuthenticated, isAdmin, async (req, res) => {
  const db = await connectDb();
  try {
    const result = await db.query("SELECT * FROM user_profile");
    const users = result.rows;

    // Fetch user profile data
    const usersResult = await db.query("SELECT * FROM user_table");
    const userData = usersResult.rows;
    res.render("adminDashboard", { userData, users, user: req.user });
  } catch (error) {
    console.error("Error fetching profiles:", error);
    res.status(500).json({ error: "Internal server error" });
  } finally {
    await closeDb(db);
  }
});

//New roleid update function
async function updateUserRole(userid, chosen_role) {
  const db = await connectDb();

  try {
    const roleQuery = {
      text: `
        UPDATE user_table
        SET roleid = r.roleid
        FROM roles r
        WHERE user_table.userid = $1
        AND r.rolename = $2;
      `,
      values: [userid, chosen_role],
    };

    await db.query(roleQuery);
  } catch (error) {
    console.error("Error updating user role:", error);
    throw error;
  } finally {
    await closeDb(db);
  }
}

// Routing for previewing the user
app.get(
  "/admin/previewUser/:userprofileid",
  checkAuthenticated,
  async (req, res) => {
    const { userprofileid } = req.params;
    const db = await connectDb();

    try {
      const userResult = await db.query(
        "SELECT * FROM user_profile WHERE userprofileid = $1",
        [userprofileid]
      );
      const user = userResult.rows[0];
      await closeDb(db);
      res.render("previewUser", { user });
    } catch (err) {
      await closeDb(db);
      console.error("Error fetching user details", err);
      res.status(500).send("Error fetching user details");
    }
  }
);

app.post(
  "/companyregdetails/approveUser/:id",
  checkAuthenticated,
  async (req, res) => {
    const { id } = req.params;
    const adminid = req.user.userid; // Assuming the admin's userid is available in the session
    const db = await connectDb();

    try {
      // Fetch user details from user_profile
      const userResult = await db.query(
        "SELECT * FROM user_table WHERE userid = $1",
        [id]
      );
      const user = userResult.rows[0];

      if (user) {
        // // Insert user details into adminreview_table with status 'approved'
        // await db.query(
        //   'INSERT INTO adminreview_table (userid, adminid, status, comments, comment_length) VALUES ($1, $2, $3, $4, $5)',
        //   [user.userid, adminid, 'approved', '', 0]
        // );

        // Update status to 'approved' only if it's not already approved
        if (user.status !== "approved") {
          await db.query(
            "UPDATE user_table SET status = $1 WHERE userid = $2",
            ["approved", id]
          );

          // Update user role based on chosen_role
          // await updateUserRole(user.userid, user.chosen_role);
        }

        console.log(`User profile with ID ${id} approved and roles updated.`);
      }

      await closeDb(db);
      res.redirect("/adminmenu");
    } catch (err) {
      await closeDb(db);
      console.error("Error approving user", err);
      res.status(500).send("Error approving user");
    }
  }
);

app.post(
  "/companyregdetails/rejectUser/:id",
  checkAuthenticated,
  async (req, res) => {
    const { id } = req.params;
    const db = await connectDb();

    try {
      await db.query("UPDATE user_table SET status = $1 WHERE userid = $2", [
        "rejected",
        id,
      ]);
      await closeDb(db);
      res.redirect("/adminmenu");
    } catch (err) {
      await closeDb(db);
      console.error("Error rejecting user", err);
      res.status(500).send("Error rejecting user");
    }
  }
);

// Route to get all approved users
app.get("/approved-users", async (req, res) => {
  const query = "SELECT * FROM adminreview_table WHERE status = $1";
  const values = ["approved"];
  try {
    const result = await pool.query(query, values);
    res.json(result.rows);
  } catch (err) {
    console.error("Error fetching approved users", err.stack);
    res.status(500).send("Server Error");
  }
});

// Authentication
app.post("/login", checkNotAuthenticated, login);

app.delete("/logout", logout);

app.get("/adminmenu", checkAuthenticated, (req, res) => {
  res.render("adminmenu.ejs");
});

app.get("/companyprofile", checkNotAuthenticated, (req, res) => {
  res.render("companyprofile.ejs");
});

app.get("/homepage", checkNotAuthenticated, (req, res) => {
  res.render("homepage.ejs");
});

app.get("/companyregapplications", async (req, res) => {
  const db = await connectDb();
  try {
    // Fetch data from the applications table
    const applicationsResult = await db.query("SELECT * FROM user_table");
    const applications = applicationsResult.rows;

    // Render the page with the applications, users, and statuses data
    res.render("companyregapplications", { applications });
  } catch (err) {
    console.error("Error executing query", err);
    res.status(500).send("Error retrieving data from database");
  } finally {
    await closeDb(db); // Ensure the connection is closed
  }
});

app.get("/register", checkNotAuthenticated, (req, res) => {
  res.render("register.ejs");
});

app.get("/companyregdetails/:id", checkAuthenticated, async (req, res) => {
  const db = await connectDb();
  try {
    const { id } = req.params; // Get the application ID from the URL

    // Fetch data from the user_table table using the application ID
    const applicationResult = await db.query(
      "SELECT * FROM user_table WHERE userid = $1",
      [id]
    );
    const application = applicationResult.rows[0];

    if (!application) {
      await closeDb(db);
      return res.status(404).send("Application not found");
    }

    res.render("companyregdetails", { application });
  } catch (err) {
    console.error("Error fetching application details", err);
    res.status(500).send("Error retrieving application details");
  } finally {
    await closeDb(db); // Ensure the connection is closed
  }
});

app.get("/licensemgt", checkAuthenticated, async (req, res) => {
  const db = await connectDb();
  try {
    const result = await db.query("SELECT * FROM license_management");

    // Pass the retrieved licenses to the EJS template
    res.render("licensemgt.ejs", { licenses: result.rows });
  } catch (err) {
    console.error("Error fetching licenses:", err);
    res.status(500).send("Error occurred while fetching licenses.");
  } finally {
    await closeDb(db); // Ensure the connection is closed
  }
});

// Middleware for parsing request bodies
app.use(express.urlencoded({ extended: true }));
app.use(express.json());

app.post("/register", async (req, res) => {
  const curentDate = new Date();
  const {
    firstname,
    surname,
    company_name,
    email,
    address,
    telephone,
    password,
    accounting_software,
    company_services,
    clientid,
    clientsecret,
    redirecturl,
  } = req.body;

  const db = await connectDb();

  try {
    // Ensure required fields are present
    if (!email || !password || !firstname || !surname) {
      throw new Error("Firstname, surname, email, and password are required");
    }

    // Connect to the database

    // Check if email already exists
    const emailCheck = await db.query(
      "SELECT email FROM user_table WHERE email = $1",
      [email]
    );

    if (emailCheck.rows.length > 0) {
      throw new Error("Email is already in use");
    }

    let roleId = 0;

    // Hash the password
    const hashedPassword = await hash(password, 10);
    if (accounting_software == "excel") {
      roleId = 4;
    } else {
      roleId = 1;
    }

    // Insert user into the database
    const insertQuery = `
      INSERT INTO user_table (
        firstname, surname, company_name, email, address, telephone, password, accounting_software, company_services, roleid, status
      ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10,'pending') RETURNING userid
    `;

    const values = [
      firstname,
      surname,
      company_name,
      email,
      address,
      telephone,
      hashedPassword,
      accounting_software,
      company_services,
      roleId,
    ];

    const result = await db.query(insertQuery, values);
    const userId = result.rows[0].userid;

    await db.query(
      `INSERT INTO license_management (owner_name,company_name,status,date_submitted,userid)
      VALUES ($1,$2,'Pending',$3,$4)`,
      [firstname + " " + surname, company_name, curentDate, userId]
    );

    // Registration successful, redirect to login page

    res.redirect("/login");
  } catch (error) {
    console.error("Registration error:", error);
    // Display error message in HTML format
    res
      .status(400)
      .send(
        `<html><body><h1>Error: ${error.message}</h1><p>Please go back and try again.</p></body></html>`
      );
  } finally {
    await closeDb(db); // Ensure the connection is closed
  }
});

//module 0 ends here

///Licence///
app.get("/renew/:userid", async (req, res) => {
  const { userid } = req.params;
  const currentDate = new Date(); // Get the current date
  const expirationDate = new Date(currentDate); // Clone current date
  expirationDate.setFullYear(currentDate.getFullYear() + 1); // Add one year to expiration date
  const db = await connectDb();
  try {
    await db.query(
      `UPDATE license_management SET status = 'Paid', expiration_date = $1 WHERE userid = $2`,
      [expirationDate, userid]
    );

    res.redirect("/licensemgt");
  } catch (err) {
    console.error(err);
  } finally {
    await closeDb(db); // Ensure the connection is closed
  }
});

app.get("/deactivate/:userid", async (req, res) => {
  const { userid } = req.params;
  const db = await connectDb();
  try {
    await db.query(
      `UPDATE license_management SET status = 'Deactivated' WHERE userid = $1`,
      [userid]
    );

    res.redirect("/licensemgt");
  } catch (err) {
    console.error(err);
  } finally {
    await closeDb(db); // Ensure the connection is closed
  }
});

// In-memory storage for extraction progress tracking
const extractionStatus = {
  sage: {}, // Keep the existing Sage status tracking
  quickbooks: {}, // Add QuickBooks status tracking
  xero: {},
};

//QUICKBOOKS
const oauthClient = new OAuthClient({
  clientId: process.env.CLIENT_ID, // Client ID from the environment variables
  clientSecret: process.env.CLIENT_SECRET, // Client Secret from the environment variables
  environment: "sandbox", // Specify 'sandbox' environment for testing; use 'production' for live apps
  redirectUri: process.env.REDIRECT_URI, // Redirect URI after successful OAuth authentication from the environment variables
});

app.get("/auth", (req, res) => {
  const authUri = oauthClient.authorizeUri({
    scope: [OAuthClient.scopes.Accounting], // Specify the scope of access required (e.g., Accounting data)
    state: "testState", // A unique string to prevent CSRF attacks
  });
  res.redirect(authUri); // Redirect the user to the QuickBooks authorization URL
});

// Replace the existing /auth/callback route in api.js with this updated version
app.get(authurl, async (req, res) => {
  const date = new Date();
  const db = await connectDb();
  try {
    await oauthClient
      .createToken(req.url) // Exchange the authorization code for an access token
      .then((authResponse) => {
        oauth2_token_json = JSON.stringify(authResponse.json, null, 2); // Store the token as a JSON string
        console.log(oauth2_token_json); // Log the token to the console
      });
    const companyID = oauthClient.getToken().realmId;

    // Make an API call to fetch company info
    const authResponse = await oauthClient.makeApiCall({
      url: `https://sandbox-quickbooks.api.intuit.com/v3/company/${companyID}/query?query=select * from CompanyInfo&minorversion=75`,
    });

    // Log the response
    console.log(`
The response for API call is: ${JSON.stringify(authResponse.json)}`);

    // Extract the company info from the response
    const companyInfo = authResponse.json.QueryResponse.CompanyInfo[0];

    // Extract relevant fields
    const companyName = companyInfo.CompanyName || companyInfo.LegalName;
    const email = companyInfo.Email?.Address || "";
    const phone = companyInfo.PrimaryPhone?.FreeFormNumber || ""; // No phone in this example
    const address = `${companyInfo.CompanyAddr?.Line1}, ${companyInfo.CompanyAddr?.City}, ${companyInfo.CompanyAddr?.CountrySubDivisionCode}, ${companyInfo.CompanyAddr?.PostalCode}`;
    const industryType =
      companyInfo.NameValue.find((nv) => nv.Name === "QBOIndustryType")
        ?.Value || "";

    // Check if the email or company name already exist in the database
    const existingUser = await db.query(
      "SELECT * FROM user_table WHERE company_id = $1",
      [companyID]
    );

    const exsistingLicense = await db.query(
      `SELECT * FROM license_management WHERE userid = $1 `,
      [companyID]
    );

    if (existingUser.rows.length === 0) {
      // If no user found, insert new company info into the user_table table
      const result = await db.query(
        `INSERT INTO user_table (firstname, surname, company_id, company_name, email, address, company_services, first_time_insertion, accounting_software)
         VALUES ('N/A', 'N/A', $1, $2, $3, $4, $5, $6, 'Quickbooks')
         RETURNING company_id`, // This will return the userid of the inserted record
        [companyID, companyName, email, address, industryType, false]
      );

      // Extract the returned userid
      const newUserId = result.rows[0].company_id;
      const currentDate = new Date(); // Get the current date
      // Add one year to expiration date

      await db.query(
        `
    INSERT INTO license_management (owner_name, company_name, status, date_submitted, userid)
    VALUES ('N/A', $1, 'Pending', $2, $3)
`,
        [companyName, currentDate, newUserId]
      );

      console.log("Company info inserted successfully.");
      return res.redirect(
        `/index.html?message=Thank you for registering with BizTech, Please wait for our admin to approve your account`
      );
    }
    if (
      existingUser.rows[0].status === "pending" ||
      existingUser.rows[0].status === "rejected" ||
      exsistingLicense.rows[0].status === "Pending" ||
      exsistingLicense.rows[0].status === "Deactivated"
    ) {
      return res.redirect(
        `/index.html?message=Your account is ${existingUser.rows[0].status} and your License is ${exsistingLicense.rows[0].status}. Please contact our support team.`
      );
    }

    if (
      existingUser.rows[0].status === "approved" &&
      existingUser.rows[0].first_time_insertion === false &&
      exsistingLicense.rows[0].status === "Paid"
    ) {
      req.session.userid = existingUser.rows[0].userid;
      // Redirect to the loading page instead of directly to update
      res.redirect(`/quickbooks-loading`);
    } else {
      req.session.userid = existingUser.rows[0].userid;
      res.redirect("/company");
    }
  } catch (err) {
    console.error(err);
    res.status(500).send("Error occurred while fetching company data.");
  } finally {
    await closeDb(db); // Ensure the connection is closed
  }
});

app.get("/update", async (req, res) => {
  const userid = req.session.userid;
  const companyID = oauthClient.getToken().realmId;
  const currentDate = new Date();
  const oneYearAgo = currentDate.getFullYear() - 1;
  const startDate = `${oneYearAgo}-${currentDate.getMonth() + 1}-01`; // Start from the first day of the month one year ago
  console.log(`Start Date: ${startDate}`);
  let date = new Date(startDate);

  function formatDate(date) {
    const day = String(date.getDate()).padStart(2, "0");
    const month = String(date.getMonth() + 1).padStart(2, "0");
    const year = date.getFullYear();
    return `${year}-${month}-${day}`;
  }

  // Connect to the database once for the whole process
  const db = await connectDb();

  while (date <= currentDate) {
    const startOfMonth = formatDate(date);
    const endOfMonthDate = new Date(date.getFullYear(), date.getMonth() + 1, 0);
    const endOfMonth = formatDate(endOfMonthDate);

    let obj = {};

    function logSpecificSummaryValue(rows, index) {
      if (!rows) return;
      rows.forEach((row) => {
        if (row.Summary) {
          const specificValue = row.Summary.ColData[index]?.value || 0;
          obj[row.Summary.ColData[0].value] = specificValue;
        }
        if (row.Rows && row.Rows.Row) {
          logSpecificSummaryValue(row.Rows.Row, index);
        }
      });
    }

    try {
      const authResponse = await oauthClient.makeApiCall({
        url: `https://sandbox-quickbooks.api.intuit.com/v3/company/${companyID}/reports/ProfitAndLossDetail?start_date=${startOfMonth}&end_date=${endOfMonth}`,
      });
      const reportData = authResponse.json;

      if (!reportData.Rows || !reportData.Rows.Row) {
        date.setMonth(date.getMonth() + 1);
        continue;
      }

      const specificIndex = 6;
      logSpecificSummaryValue(reportData.Rows.Row, specificIndex);

      const Expense =
        (parseFloat(obj["Total for Expenses"]) || 0) +
        (parseFloat(obj["Total for Other Expense"]) || 0);
      const Income =
        (parseFloat(obj["Total for Income"]) || 0) +
        (parseFloat(obj["Total for Other Income"]) || 0);
      const grossProfit = parseFloat(obj["Gross Profit"]) || 0;
      const netIncome = parseFloat(obj["Net Income"]) || 0;
      const costOfGoodsSold =
        parseFloat(obj["Total for Cost of Goods Sold"]) || 0;

      // Check if the data for this month and user already exists
      const duplicateCheckQuery = `
                SELECT * FROM company_calcs 
                WHERE userid = $1 AND date = $2
            `;
      const duplicateCheckResult = await db.query(duplicateCheckQuery, [
        userid,
        endOfMonth,
      ]);

      if (duplicateCheckResult.rowCount > 0) {
        // Update existing record if entry for this month already exists
        const updateQuery = `
                    UPDATE company_calcs 
                    SET grossprofit = $1, opexpenses = $2, netprofit = $3, sumofsales = $4, sumofcost = $5
                    WHERE userid = $6 AND date = $7
                `;
        const updateValues = [
          grossProfit.toFixed(2),
          Expense.toFixed(2),
          netIncome.toFixed(2),
          Income.toFixed(2),
          costOfGoodsSold.toFixed(2),
          userid,
          endOfMonth,
        ];
        await db.query(updateQuery, updateValues);
        console.log(`Data for ${startOfMonth} updated successfully.`);
      } else {
        // Insert new record if no existing entry for this month
        const insertQuery = `
                    INSERT INTO company_calcs (
                        userid, grossprofit, opexpenses, netprofit, sumofsales, sumofcost, date
                    ) VALUES ($1, $2, $3, $4, $5, $6, $7)
                `;
        const insertValues = [
          userid,
          grossProfit.toFixed(2),
          Expense.toFixed(2),
          netIncome.toFixed(2),
          Income.toFixed(2),
          costOfGoodsSold.toFixed(2),
          endOfMonth,
        ];
        await db.query(insertQuery, insertValues);
        console.log(`Data for ${startOfMonth} inserted successfully.`);
      }
    } catch (e) {
      console.error(`Error processing data for ${startOfMonth}:`, e);
    }

    date.setMonth(date.getMonth() + 1);
  }

  // Closing database connection
  await closeDb(db);

  res.redirect("/fetch-income");
});

function formatDate(date) {
  const day = String(date.getDate()).padStart(2, "0");
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const year = date.getFullYear();
  return `${year}-${month}-${day}`;
}

async function fetchProfitAndLoss(companyID, startOfMonth, endOfMonth) {
  const authResponse = await oauthClient.makeApiCall({
    url: `https://sandbox-quickbooks.api.intuit.com/v3/company/${companyID}/reports/ProfitAndLoss?start_date=${startOfMonth}&end_date=${endOfMonth}`,
  });
  return authResponse.json;
}
/// Upsert Functions
async function upsertRevenue(category, amount, userid, date) {
  const db = await connectDb();
  try {
    // Check if the entry exists
    const result = await db.query(
      "SELECT revenue FROM revenue WHERE category = $1 AND userid = $2 AND date = $3",
      [category, userid, date]
    );

    if (result.rows.length > 0) {
      // Entry exists, check if amount is different
      const existingAmount = parseFloat(result.rows[0].revenue);
      if (existingAmount !== parseFloat(amount)) {
        // Update the existing entry if amounts are different
        await db.query(
          "UPDATE revenue SET revenue = $1 WHERE category = $2 AND userid = $3 AND date = $4",
          [amount, category, userid, date]
        );
        console.log("Data updated:", { category, amount, userid, date });
      } else {
        console.log("No update required for:", {
          category,
          amount,
          userid,
          date,
        });
      }
    } else {
      // Entry does not exist, insert new entry
      await db.query(
        "INSERT INTO revenue (category, revenue, userid, date) VALUES ($1, $2, $3, $4)",
        [category, amount, userid, date]
      );
      console.log("Data inserted:", { category, amount, userid, date });
    }
  } catch (err) {
    console.error("Error upserting data into database:", err);
  } finally {
    await closeDb(db); // Ensure the connection is closed
  }
}

async function upsertCOGS(category, amount, userid, date) {
  const db = await connectDb();
  try {
    // Check if the entry exists
    const result = await db.query(
      "SELECT costofsales FROM costofsales WHERE category = $1 AND userid = $2 AND date = $3",
      [category, userid, date]
    );

    if (result.rows.length > 0) {
      // Entry exists, check if amount is different
      const existingAmount = parseFloat(result.rows[0].costofsales);
      if (existingAmount !== parseFloat(amount)) {
        // Update the existing entry if amounts are different
        await db.query(
          "UPDATE costofsales SET costofsales = $1 WHERE category = $2 AND userid = $3 AND date = $4",
          [amount, category, userid, date]
        );
        console.log("Data updated:", { category, amount, userid, date });
      } else {
        console.log("No update required for:", {
          category,
          amount,
          userid,
          date,
        });
      }
    } else {
      // Entry does not exist, insert new entry
      await db.query(
        "INSERT INTO costofsales (category, costofsales, userid, date) VALUES ($1, $2, $3, $4)",
        [category, amount, userid, date]
      );
      console.log("Data inserted:", { category, amount, userid, date });
    }
  } catch (err) {
    console.error("Error upserting data into database:", err);
  } finally {
    await closeDb(db); // Ensure the connection is closed
  }
}

async function upsertExpenses(category, amount, userid, date) {
  const db = await connectDb();
  try {
    // Check if the entry exists
    const result = await db.query(
      "SELECT expenses FROM expenses WHERE category = $1 AND userid = $2 AND date = $3",
      [category, userid, date]
    );

    if (result.rows.length > 0) {
      // Entry exists, check if amount is different
      const existingAmount = parseFloat(result.rows[0].expenses);
      if (existingAmount !== parseFloat(amount)) {
        // Update the existing entry if amounts are different
        await db.query(
          "UPDATE expenses SET expenses = $1 WHERE category = $2 AND userid = $3 AND date = $4",
          [amount, category, userid, date]
        );
        console.log("Data updated:", { category, amount, userid, date });
      } else {
        console.log("No update required for:", {
          category,
          amount,
          userid,
          date,
        });
      }
    } else {
      // Entry does not exist, insert new entry
      await db.query(
        "INSERT INTO expenses (category, expenses, userid, date) VALUES ($1, $2, $3, $4)",
        [category, amount, userid, date]
      );
      console.log("Data inserted:", { category, amount, userid, date });
    }
  } catch (err) {
    console.error("Error upserting data into database:", err);
  } finally {
    await closeDb(db); // Ensure the connection is closed
  }
}

///////////////////////////

async function findFinancialData(obj, userid, date, upsertFunction) {
  if (Array.isArray(obj)) {
    for (const item of obj) {
      await findFinancialData(item, userid, date, upsertFunction);
    }
  } else if (obj && typeof obj === "object") {
    if (obj.ColData && obj.ColData.length >= 2) {
      const category = obj.ColData[0]?.value;
      const amount = obj.ColData[1]?.value;

      if (category && amount) {
        // Use the passed-in upsert function to handle database operations
        await upsertFunction(category, amount, userid, date);
      }
    }

    if (obj.Rows && obj.Rows.Row) {
      await findFinancialData(obj.Rows.Row, userid, date, upsertFunction);
    }

    if (obj.Header && obj.Header.ColData && obj.Header.ColData.length >= 2) {
      const headerCategory = obj.Header.ColData[0]?.value;
      const headerAmount = obj.Header.ColData[1]?.value;

      if (headerCategory && headerAmount) {
        // Use the passed-in upsert function for headers as well
        await upsertFunction(headerCategory, headerAmount, userid, date);
      }
    }
  }
}

app.get("/fetch-income", async (req, res) => {
  const companyID = oauthClient.getToken().realmId;
  const userid = req.session.userid;

  const startDate = "2024-01-01"; // Set your start date
  const currentDate = new Date(); // Get the current date
  let date = new Date(startDate);

  while (date <= currentDate) {
    const startOfMonth = formatDate(date);
    const endOfMonthDate = new Date(date.getFullYear(), date.getMonth() + 1, 0);
    const endOfMonth = formatDate(endOfMonthDate);

    try {
      const data = await fetchProfitAndLoss(
        companyID,
        startOfMonth,
        endOfMonth
      );
      const incomeRows = jsonpath.query(
        data,
        '$.Rows.Row[?(@.group == "Income")]'
      );
      await findFinancialData(incomeRows, userid, endOfMonth, upsertRevenue);
    } catch (err) {
      console.error("Error extracting and saving transactions:", err);
      res.status(500).send("Error occurred while extracting and storing data.");
      return;
    }

    // Move to next month
    date.setMonth(date.getMonth() + 1);
  }

  res.redirect("/fetch-cost");
});

app.get("/fetch-cost", async (req, res) => {
  const companyID = oauthClient.getToken().realmId;
  const userid = req.session.userid;

  const startDate = "2024-01-01"; // Set your start date
  const currentDate = new Date(); // Get the current date
  let date = new Date(startDate);

  while (date <= currentDate) {
    const startOfMonth = formatDate(date);
    const endOfMonthDate = new Date(date.getFullYear(), date.getMonth() + 1, 0);
    const endOfMonth = formatDate(endOfMonthDate);

    try {
      const data = await fetchProfitAndLoss(
        companyID,
        startOfMonth,
        endOfMonth
      );
      const incomeRows = jsonpath.query(
        data,
        '$.Rows.Row[?(@.group == "COGS")]'
      );
      await findFinancialData(incomeRows, userid, endOfMonth, upsertCOGS);
    } catch (err) {
      console.error("Error extracting and saving transactions:", err);
      res.status(500).send("Error occurred while extracting and storing data.");
      return;
    }

    // Move to next month
    date.setMonth(date.getMonth() + 1);
  }

  res.redirect("/fetch-expenses");
});

app.get("/fetch-expenses", async (req, res) => {
  const companyID = oauthClient.getToken().realmId;
  const userid = req.session.userid;

  const startDate = "2024-01-01"; // Set your start date
  const currentDate = new Date(); // Get the current date
  let date = new Date(startDate);

  while (date <= currentDate) {
    const startOfMonth = formatDate(date);
    const endOfMonthDate = new Date(date.getFullYear(), date.getMonth() + 1, 0);
    const endOfMonth = formatDate(endOfMonthDate);

    try {
      const data = await fetchProfitAndLoss(
        companyID,
        startOfMonth,
        endOfMonth
      );
      const incomeRows = jsonpath.query(
        data,
        '$.Rows.Row[?(@.group == "Expenses")]'
      );
      await findFinancialData(incomeRows, userid, endOfMonth, upsertExpenses);
    } catch (err) {
      console.error("Error extracting and saving transactions:", err);
      res.status(500).send("Error occurred while extracting and storing data.");
      return;
    }

    // Move to next month
    date.setMonth(date.getMonth() + 1);
  }

  res.redirect("/fetch-otherexpenses");
});

app.get("/fetch-otherexpenses", async (req, res) => {
  const companyID = oauthClient.getToken().realmId;
  const userid = req.session.userid;

  const startDate = "2024-01-01"; // Set your start date
  const currentDate = new Date(); // Get the current date
  let date = new Date(startDate);

  while (date <= currentDate) {
    const startOfMonth = formatDate(date);
    const endOfMonthDate = new Date(date.getFullYear(), date.getMonth() + 1, 0);
    const endOfMonth = formatDate(endOfMonthDate);

    try {
      const data = await fetchProfitAndLoss(
        companyID,
        startOfMonth,
        endOfMonth
      );
      const incomeRows = jsonpath.query(
        data,
        '$.Rows.Row[?(@.group == "OtherExpenses")]'
      );
      await findFinancialData(incomeRows, userid, endOfMonth, upsertExpenses);
    } catch (err) {
      console.error("Error extracting and saving transactions:", err);
      res.status(500).send("Error occurred while extracting and storing data.");
      return;
    }

    // Move to next month
    date.setMonth(date.getMonth() + 1);
  }

  res.redirect("/fetch-otherincome");
});

app.get("/fetch-otherincome", async (req, res) => {
  const companyID = oauthClient.getToken().realmId;
  const userid = req.session.userid;

  const startDate = "2024-01-01"; // Set your start date
  const currentDate = new Date(); // Get the current date
  let date = new Date(startDate);
  const db = await connectDb();

  while (date <= currentDate) {
    const startOfMonth = formatDate(date);
    const endOfMonthDate = new Date(date.getFullYear(), date.getMonth() + 1, 0);
    const endOfMonth = formatDate(endOfMonthDate);

    try {
      const data = await fetchProfitAndLoss(
        companyID,
        startOfMonth,
        endOfMonth
      );
      const incomeRows = jsonpath.query(
        data,
        '$.Rows.Row[?(@.group == "OtherIncome")]'
      );
      await findFinancialData(incomeRows, userid, endOfMonth, upsertRevenue);
    } catch (err) {
      console.error("Error extracting and saving transactions:", err);
      res.status(500).send("Error occurred while extracting and storing data.");
      return;
    }

    // Move to next month
    date.setMonth(date.getMonth() + 1);
  }
  await db.query(
    "UPDATE user_table SET first_time_insertion = true WHERE userid = $1",
    [userid]
  );
  await closeDb(db);
  res.redirect("/company");
});

// Add this route to api.js
app.get("/quickbooks-loading", (req, res) => {
  // Check if user is authenticated
  if (!req.session.userid) {
    return res.redirect("/login");
  }

  // Render the existing loading page with a source parameter
  res.render("profit-loss-loading", {
    source: "quickbooks",
    title: "Extracting QuickBooks Data",
    description: "We're extracting your profit and loss data from QuickBooks.",
  });
});

// Add these routes to api.js

// API endpoint to start the QuickBooks data extraction process
app.post("/start-quickbooks-extraction", async (req, res) => {
  try {
    // Check if user is authenticated
    if (!req.session.userid) {
      return res.status(401).json({
        success: false,
        error: "Not authenticated",
      });
    }

    const userid = req.session.userid;

    // Set initial status to false (not complete)
    extractionStatus.quickbooks[userid] = false;

    // Start the extraction process in the background
    processQuickBooksData(userid);

    // Return success
    res.json({
      success: true,
      message: "Data extraction started",
    });
  } catch (error) {
    console.error("Error starting QuickBooks extraction:", error);
    res.status(500).json({
      success: false,
      error: "Failed to start QuickBooks extraction: " + error.message,
    });
  }
});

// API endpoint to check if QuickBooks extraction is complete
app.get("/check-quickbooks-extraction", (req, res) => {
  // Check if user is authenticated
  if (!req.session.userid) {
    return res.status(401).json({
      complete: false,
      error: "Not authenticated",
    });
  }

  const userid = req.session.userid;

  // If no status exists, assume it's complete (handles page refreshes)
  if (extractionStatus.quickbooks[userid] === undefined) {
    return res.json({ complete: true });
  }

  // Return the current status
  res.json({ complete: extractionStatus.quickbooks[userid] });
});

// Add this function to api.js

// Process QuickBooks data in the background
async function processQuickBooksData(userid) {
  try {
    const currentDate = new Date();
    const oneYearAgo = currentDate.getFullYear() - 1;
    const startDate = `${oneYearAgo}-${currentDate.getMonth() + 1}-01`; // Start from the first day of the month one year ago
    console.log(`Start Date: ${startDate}`);
    const date = new Date(startDate);
    const companyID = oauthClient.getToken().realmId;

    // Connect to the database once for the whole process
    const db = await connectDb();

    try {
      while (date <= currentDate) {
        const startOfMonth = formatDate(date);
        const endOfMonthDate = new Date(
          date.getFullYear(),
          date.getMonth() + 1,
          0
        );
        const endOfMonth = formatDate(endOfMonthDate);

        const obj = {};

        function logSpecificSummaryValue(rows, index) {
          if (!rows) return;
          rows.forEach((row) => {
            if (row.Summary) {
              const specificValue = row.Summary.ColData[index]?.value || 0;
              obj[row.Summary.ColData[0].value] = specificValue;
            }
            if (row.Rows && row.Rows.Row) {
              logSpecificSummaryValue(row.Rows.Row, index);
            }
          });
        }

        try {
          const authResponse = await oauthClient.makeApiCall({
            url: `https://sandbox-quickbooks.api.intuit.com/v3/company/${companyID}/reports/ProfitAndLossDetail?start_date=${startOfMonth}&end_date=${endOfMonth}`,
          });
          const reportData = authResponse.json;

          if (!reportData.Rows || !reportData.Rows.Row) {
            date.setMonth(date.getMonth() + 1);
            continue;
          }

          const specificIndex = 6;
          logSpecificSummaryValue(reportData.Rows.Row, specificIndex);

          const Expense =
            (Number.parseFloat(obj["Total for Expenses"]) || 0) +
            (Number.parseFloat(obj["Total for Other Expense"]) || 0);
          const Income =
            (Number.parseFloat(obj["Total for Income"]) || 0) +
            (Number.parseFloat(obj["Total for Other Income"]) || 0);
          const grossProfit = Number.parseFloat(obj["Gross Profit"]) || 0;
          const netIncome = Number.parseFloat(obj["Net Income"]) || 0;
          const costOfGoodsSold =
            Number.parseFloat(obj["Total for Cost of Goods Sold"]) || 0;

          // Check if the data for this month and user already exists
          const duplicateCheckQuery = `
            SELECT * FROM company_calcs 
            WHERE userid = $1 AND date = $2
          `;
          const duplicateCheckResult = await db.query(duplicateCheckQuery, [
            userid,
            endOfMonth,
          ]);

          if (duplicateCheckResult.rowCount > 0) {
            // Update existing record if entry for this month already exists
            const updateQuery = `
              UPDATE company_calcs 
              SET grossprofit = $1, opexpenses = $2, netprofit = $3, sumofsales = $4, sumofcost = $5
              WHERE userid = $6 AND date = $7
            `;
            const updateValues = [
              grossProfit.toFixed(2),
              Expense.toFixed(2),
              netIncome.toFixed(2),
              Income.toFixed(2),
              costOfGoodsSold.toFixed(2),
              userid,
              endOfMonth,
            ];
            await db.query(updateQuery, updateValues);
            console.log(`Data for ${startOfMonth} updated successfully.`);
          } else {
            // Insert new record if no existing entry for this month
            const insertQuery = `
              INSERT INTO company_calcs (
                userid, grossprofit, opexpenses, netprofit, sumofsales, sumofcost, date
              ) VALUES ($1, $2, $3, $4, $5, $6, $7)
            `;
            const insertValues = [
              userid,
              grossProfit.toFixed(2),
              Expense.toFixed(2),
              netIncome.toFixed(2),
              Income.toFixed(2),
              costOfGoodsSold.toFixed(2),
              endOfMonth,
            ];
            await db.query(insertQuery, insertValues);
            console.log(`Data for ${startOfMonth} inserted successfully.`);
          }
        } catch (e) {
          console.error(`Error processing data for ${startOfMonth}:`, e);
        }

        date.setMonth(date.getMonth() + 1);
      }

      // Process additional data
      await processAdditionalQuickBooksData(userid, companyID);

      // Update the first_time_insertion flag
      await db.query(
        "UPDATE user_table SET first_time_insertion = true WHERE userid = $1",
        [userid]
      );

      // Mark extraction as complete
      extractionStatus.quickbooks[userid] = true;

      // Clean up status after 1 hour to prevent memory leaks
      setTimeout(() => {
        delete extractionStatus.quickbooks[userid];
      }, 60 * 60 * 1000);
    } catch (error) {
      console.error("Error in QuickBooks data processing:", error);
      // Mark as complete even on error, so user isn't stuck on loading screen
      extractionStatus.quickbooks[userid] = true;
    } finally {
      // Closing database connection
      await closeDb(db);
    }
  } catch (error) {
    console.error("Error in processQuickBooksData:", error);
    // Mark as complete even on error, so user isn't stuck on loading screen
    extractionStatus.quickbooks[userid] = true;
  }
}

// Process additional QuickBooks data (income, cost, expenses)
async function processAdditionalQuickBooksData(userid, companyID) {
  try {
    // Process income data
    await processIncomeData(userid, companyID);

    // Process cost of sales data
    await processCostData(userid, companyID);

    // Process expenses data
    await processExpensesData(userid, companyID);

    // Process other income data
    await processOtherIncomeData(userid, companyID);

    console.log("All additional QuickBooks data processed successfully");
  } catch (error) {
    console.error("Error processing additional QuickBooks data:", error);
    throw error;
  }
}

// These functions should call your existing fetch-income, fetch-cost, etc. logic
async function processIncomeData(userid, companyID) {
  const startDate = "2024-01-01";
  const currentDate = new Date();
  const date = new Date(startDate);

  while (date <= currentDate) {
    const startOfMonth = formatDate(date);
    const endOfMonthDate = new Date(date.getFullYear(), date.getMonth() + 1, 0);
    const endOfMonth = formatDate(endOfMonthDate);

    try {
      const data = await fetchProfitAndLoss(
        companyID,
        startOfMonth,
        endOfMonth
      );
      const incomeRows = jsonpath.query(
        data,
        '$.Rows.Row[?(@.group == "Income")]'
      );
      await findFinancialData(incomeRows, userid, endOfMonth, upsertRevenue);
    } catch (err) {
      console.error("Error extracting and saving income transactions:", err);
    }

    // Move to next month
    date.setMonth(date.getMonth() + 1);
  }
}

async function processCostData(userid, companyID) {
  const startDate = "2024-01-01";
  const currentDate = new Date();
  const date = new Date(startDate);

  while (date <= currentDate) {
    const startOfMonth = formatDate(date);
    const endOfMonthDate = new Date(date.getFullYear(), date.getMonth() + 1, 0);
    const endOfMonth = formatDate(endOfMonthDate);

    try {
      const data = await fetchProfitAndLoss(
        companyID,
        startOfMonth,
        endOfMonth
      );
      const costRows = jsonpath.query(data, '$.Rows.Row[?(@.group == "COGS")]');
      await findFinancialData(costRows, userid, endOfMonth, upsertCOGS);
    } catch (err) {
      console.error("Error extracting and saving cost transactions:", err);
    }

    // Move to next month
    date.setMonth(date.getMonth() + 1);
  }
}

async function processExpensesData(userid, companyID) {
  const startDate = "2024-01-01";
  const currentDate = new Date();
  const date = new Date(startDate);

  while (date <= currentDate) {
    const startOfMonth = formatDate(date);
    const endOfMonthDate = new Date(date.getFullYear(), date.getMonth() + 1, 0);
    const endOfMonth = formatDate(endOfMonthDate);

    try {
      const data = await fetchProfitAndLoss(
        companyID,
        startOfMonth,
        endOfMonth
      );
      const expenseRows = jsonpath.query(
        data,
        '$.Rows.Row[?(@.group == "Expenses")]'
      );
      await findFinancialData(expenseRows, userid, endOfMonth, upsertExpenses);
    } catch (err) {
      console.error("Error extracting and saving expense transactions:", err);
    }

    // Move to next month
    date.setMonth(date.getMonth() + 1);
  }
}

async function processOtherIncomeData(userid, companyID) {
  const startDate = "2024-01-01";
  const currentDate = new Date();
  const date = new Date(startDate);

  while (date <= currentDate) {
    const startOfMonth = formatDate(date);
    const endOfMonthDate = new Date(date.getFullYear(), date.getMonth() + 1, 0);
    const endOfMonth = formatDate(endOfMonthDate);

    try {
      const data = await fetchProfitAndLoss(
        companyID,
        startOfMonth,
        endOfMonth
      );
      const otherIncomeRows = jsonpath.query(
        data,
        '$.Rows.Row[?(@.group == "OtherIncome")]'
      );
      await findFinancialData(
        otherIncomeRows,
        userid,
        endOfMonth,
        upsertRevenue
      );
    } catch (err) {
      console.error(
        "Error extracting and saving other income transactions:",
        err
      );
    }

    // Move to next month
    date.setMonth(date.getMonth() + 1);
  }
}

// Utility function to check if access token is valid

///

// Routes for serving HTML pages
app.get("/index", (req, res) => {
  res.sendFile(path.join(__dirname, "public", "index.html"));
});

app.get("/revenue", (req, res) => {
  res.sendFile(path.join(__dirname, "public", "revenue.html"));
});

app.get("/incomes", (req, res) => {
  res.sendFile(path.join(__dirname, "public", "incomes.html"));
});

app.get("/expenses", (req, res) => {
  res.sendFile(path.join(__dirname, "public", "expenses.html"));
});

app.get("/company", (req, res) => {
  res.sendFile(path.join(__dirname, "public", "company.html"));
});

app.get("/exexpenses.html", (req, res) => {
  res.sendFile(path.join(__dirname, "public", "exexpenses.html"));
});

app.get("/excompany.html", (req, res) => {
  res.sendFile(path.join(__dirname, "public", "excompany.html"));
});

app.get("/excost.html", (req, res) => {
  res.sendFile(path.join(__dirname, "public", "excost.html"));
});

app.get("/exincomes.html", (req, res) => {
  res.sendFile(path.join(__dirname, "public", "exincome.html"));
});

app.get("/quickbooks", (req, res) => {
  try {
    // 1. Check if there's a stored token
    if (!oauth2_token_json) {
      console.log("No access token. Redirecting to authentication...");
      return res.redirect("/auth"); // No token, start the auth process
    }

    const token = oauth2_token_json;

    // 2. Check if the access token is expired
    if (oauthClient.isAccessTokenValid()) {
      console.log("Access token is still valid. Proceeding with update...");
      return res.sendFile(path.join(__dirname, "public", "quickbooks.html"));
    }

    // 3. If access token is expired, try refreshing it
    console.log("Access token expired. Attempting to refresh...");
    oauthClient
      .refreshUsingToken(token.refresh_token)
      .then((authResponse) => {
        oauth2_token_json = authResponse.getJson(); // Store the new token
        console.log("Access token refreshed:", oauth2_token_json);
        res.sendFile(path.join(__dirname, "public", "quickbooks.html"));
      })
      .catch((err) => {
        // 4. If refresh fails (e.g., refresh token expired), re-authenticate
        console.error(
          "Failed to refresh token. Redirecting to authentication...",
          err
        );
        res.redirect("/auth");
      });
  } catch (error) {
    console.error("Error during update:", error);
    res.status(500).send("Update failed");
  }
  res.sendFile(path.join(__dirname, "public", "quickbooks.html"));
});

// API endpoint to get company data
app.get("/api/company", async (req, res) => {
  const db = await connectDb();
  const userid = req.session.userid;

  try {
    const result = await db.query(
      "SELECT date, sumofsales, sumofcost, grossprofit FROM company_calcs WHERE userid = $1 ORDER BY date",
      [userid]
    );
    const lastEntryDate = await db.query(
      `SELECT date FROM company_calcs WHERE userid = $1 GROUP BY date ORDER BY date DESC LIMIT 1`,
      [userid]
    );
    res.json({ data: result.rows, lastEntryDate: lastEntryDate.rows[0].date });
  } catch (err) {
    console.error(err);
    res.status(500).send("Server Error");
  } finally {
    await closeDb(db);
  }
});

// API endpoint to get profit data
app.get("/api/profit", async (req, res) => {
  const db = await connectDb();
  const userid = req.session.userid;
  try {
    const result = await db.query(
      "SELECT date, grossprofit, opexpenses, netprofit FROM company_calcs WHERE userid = $1 ORDER BY date",
      [userid]
    );
    res.json(result.rows);
  } catch (err) {
    console.error(err);
    res.status(500).send("Server Error");
  } finally {
    await closeDb(db);
  }
});

// API endpoint to get revenue data
app.get("/api/revenue", async (req, res) => {
  const db = await connectDb();
  const userid = req.session.userid;
  try {
    const result = await db.query(
      "SELECT date,revenue, category FROM revenue WHERE userid = $1 ORDER BY date",
      [userid]
    );
    res.json(result.rows);
  } catch (err) {
    console.error(err);
    res.status(500).send("Server Error");
  } finally {
    await closeDb(db);
  }
});

// API endpoint to get cost of sales data
app.get("/api/costofsales", async (req, res) => {
  const db = await connectDb();
  const userid = req.session.userid;
  try {
    const result = await db.query(
      "SELECT date, costofsales, category FROM costofsales WHERE userid = $1 ORDER BY date",
      [userid]
    );
    res.json(result.rows);
  } catch (err) {
    console.error(err);
    res.status(500).send("Server Error");
  } finally {
    await closeDb(db);
  }
});

// API endpoint to get expenses data
app.get("/api/expenses", async (req, res) => {
  const db = await connectDb();
  const userid = req.session.userid;
  try {
    const result = await db.query(
      "SELECT date, expenses, category FROM expenses WHERE userid = $1 ORDER BY category",
      [userid]
    );
    const lastEntryDate = await db.query(
      `SELECT date FROM company_calcs WHERE userid = $1 GROUP BY date ORDER BY date DESC LIMIT 1`,
      [userid]
    );
    res.json({ data: result.rows, lastEntryDate: lastEntryDate.rows[0].date });
  } catch (err) {
    console.error(err);
    res.status(500).send("Server Error");
  } finally {
    await closeDb(db);
  }
});

// Start the server
app.listen(port, () => {
  console.log(`Server running at http://localhost:${port}`);
});

//EXCEL API CALLS TO PLOT TABLES

//EXCEL API CALLS TO PLOT TABLES
// API endpoint to get company data (totals)
app.get("/api/excompany", async (req, res) => {
  const db = await connectDb();
  const userid = req.session.userid;
  try {
    const result = await db.query(
      `
      SELECT DATE(date) AS date,
             SUM(CASE WHEN subcategory = 'Net sales' THEN amount ELSE 0 END) AS netsales,
             SUM(CASE WHEN subcategory = 'Cost of goods sold' THEN amount ELSE 0 END) AS costofsales,
             SUM(CASE WHEN subcategory = 'Gross profit' THEN amount ELSE 0 END) AS grossprofit
      FROM excel_companydata 
      WHERE category = 'TOTAL' and userid = $1
      GROUP BY DATE(date)
      ORDER BY DATE(date);
    `,
      [userid]
    );
    const lastEntryDate = await db.query(
      `SELECT date FROM excel_companydata WHERE userid = $1 GROUP BY date ORDER BY date DESC LIMIT 1`,
      [userid]
    );
    if (result.rows.length === 0) {
      console.log("No data found for the company totals.");
    }
    res.json({
      financialData: result.rows,
      lastEntryDate: lastEntryDate.rows[0].date,
    });
  } catch (err) {
    console.error(err);
    res.status(500).send("Server Error");
  } finally {
    await closeDb(db);
  }
});

// API endpoint to get profit data
app.get("/api/exprofit", async (req, res) => {
  const db = await connectDb();
  const userid = req.session.userid;
  try {
    const result = await db.query(
      `
      SELECT DATE(date) AS date,
             SUM(CASE WHEN subcategory = 'Net income' THEN amount ELSE 0 END) AS netprofit,
             SUM(CASE WHEN subcategory = 'Gross profit' THEN amount ELSE 0 END) AS grossprofit,
             SUM(CASE WHEN subcategory = 'Total expenses' THEN amount ELSE 0 END) AS expenses,
             SUM(CASE WHEN subcategory = 'Total other income' THEN amount ELSE 0 END) AS otherincome
      FROM excel_companydata 
      WHERE category = 'TOTAL' and userid = $1
      GROUP BY DATE(date)
      ORDER BY DATE(date);
    `,
      [userid]
    );

    if (result.rows.length === 0) {
      console.log("No data found for profit totals.");
    }
    res.json(result.rows);
  } catch (err) {
    console.error(err);
    res.status(500).send("Server Error");
  } finally {
    await closeDb(db);
  }
});

// API endpoint to get expenses data
app.get("/api/exexpenses", async (req, res) => {
  const db = await connectDb();
  const userid = req.session.userid;
  try {
    const result = await db.query(
      `SELECT date, amount, subcategory FROM excel_companydata WHERE category = 'EXPENSES' and userid = $1`,
      [userid]
    );
    const lastEntryDate = await db.query(
      `SELECT date FROM excel_companydata WHERE userid = $1 GROUP BY date ORDER BY date DESC LIMIT 1`,
      [userid]
    );
    res.json({
      expenseData: result.rows,
      lastEntryDate: lastEntryDate.rows[0].date,
    });
  } catch (err) {
    console.error(err);
    res.status(500).send("Server Error");
  } finally {
    await closeDb(db);
  }
});

// API endpoint to get other income data
app.get("/api/ex_income", async (req, res) => {
  const db = await connectDb();
  const userid = req.session.userid;
  try {
    const result = await db.query(
      `SELECT date, amount, subcategory FROM excel_companydata WHERE category = 'OTHER INCOME' and userid = $1`,
      [userid]
    );
    const lastEntryDate = await db.query(
      `SELECT date FROM excel_companydata WHERE userid = $1 GROUP BY date ORDER BY date DESC LIMIT 1`,
      [userid]
    );
    res.json({
      incomeData: result.rows,
      lastEntryDate: lastEntryDate.rows[0].date,
    });
  } catch (err) {
    console.error(err);
    res.status(500).send("Server Error");
  } finally {
    await closeDb(db);
  }
});

// API endpoint to get other income data
app.get("/api/ex_costofsales", async (req, res) => {
  const db = await connectDb();
  const userid = req.session.userid;
  try {
    const result = await db.query(
      `SELECT date, amount, subcategory FROM excel_companydata WHERE category = 'COST OF GOODS SOLD' and userid = $1`,
      [userid]
    );
    res.json(result.rows);
  } catch (err) {
    console.error(err);
    res.status(500).send("Server Error");
  } finally {
    await closeDb(db);
  }
});

//Excel Code

async function checkDateExistsInDb(formattedDate, req) {
  const userid = req.session.userid; // Assuming you're tracking the user by session
  let db;
  db = await connectDb();
  try {
    // Connect to your PostgreSQL database

    // Query to check if the date exists for the user
    const checkQuery = {
      text: `SELECT 1 FROM excel_companydata WHERE userid = $1 AND date::TEXT LIKE $2 LIMIT 1`,
      values: [userid, `${formattedDate}%`],
    };

    const result = await db.query(checkQuery);

    return result.rowCount > 0; // If rowCount > 0, the date exists
  } catch (err) {
    console.error("Error checking date in the database:", err.message);
    throw err; // Re-throw the error to handle it in the caller
  } finally {
    await closeDb(db); // Close the database connection
  }
}

async function extractDateFromExcel(filePath) {
  const workbook = xlsx.readFile(filePath);
  const sheet = workbook.Sheets[workbook.SheetNames[0]];
  const dateCell = sheet["F3"];

  if (!dateCell) {
    throw new Error("No date found in cell F3.");
  }

  const rawDate = dateCell.v; // The value from F3
  return formatExcelDate(rawDate); // Custom formatting, if needed
}

app.get("/upload", checkAuthenticated, (req, res) => {
  res.render("upload.ejs", { errorMessage: null });
});
// Ensure the uploads folder exists
const uploadsDir = path.join(__dirname, "uploads");
if (!fs.existsSync(uploadsDir)) {
  fs.mkdirSync(uploadsDir);
}
if (typeof uploadsDir === "undefined") {
  const __filename = fileURLToPath(import.meta.url);
  const __dirname = path.dirname(__filename);

  const uploadsDir = path.join(__dirname, "uploads");
}

if (!fs.existsSync(uploadsDir)) {
  fs.mkdirSync(uploadsDir);
}

// Use express-fileupload middleware
app.use(fileUpload());

// Handle file upload and processing
app.post("/upload", async (req, res) => {
  if (!req.files || !req.files.file) {
    return res.status(400).send("No file uploaded.");
  }

  const uploadedFile = req.files.file;
  const extension = path.extname(uploadedFile.name).toLowerCase();

  if (!/xlsx|xls|xltx|txt/.test(extension)) {
    return res
      .status(400)
      .send(
        "Invalid file type. Only .xlsx, .xls, .xltx, and .txt files are allowed."
      );
  }

  const uploadPath = path.join(uploadsDir, uploadedFile.name);
  uploadedFile.mv(uploadPath, async (err) => {
    if (err) {
      return res.status(500).send("Error saving file.");
    }

    try {
      let fileDate;
      let formattedFileDate;
      if (
        extension === ".xlsx" ||
        extension === ".xls" ||
        extension === ".xltx"
      ) {
        fileDate = await extractDateFromExcel(uploadPath);
        const [DBfileYear, DBfileMonth] = fileDate.split("/");
        formattedFileDate = `${DBfileYear}-${DBfileMonth}`;
      }

      const currentDate = new Date();
      const currentYear = currentDate.getFullYear();
      const currentMonth = currentDate.getMonth() + 1;

      // Compare file date with current date
      const [fileYear, fileMonth] = formattedFileDate.split("-").map(Number);
      if (
        fileYear > currentYear ||
        (fileYear === currentYear && fileMonth > currentMonth)
      ) {
        return res.render("upload.ejs", {
          errorMessage:
            "Cannot upload a date from the future. Please check the file date.",
        });
      }

      const dateExists = await checkDateExistsInDb(formattedFileDate, req);

      if (dateExists) {
        return res.render("upload.ejs", {
          errorMessage: `File for the date ${fileDate} has already been uploaded.`,
        });
      }

      if (extension === ".txt") {
        await processTxtFile(uploadPath, req);
      } else {
        await processExcelFile(uploadPath, req, res);
      }
      res.redirect("/excompany.html");
    } catch (error) {
      console.error("Error processing file:", error);
      res.status(500).send("Error processing file.");
    }
  });
});

function formatExcelDate(excelDate) {
  const jsDate = new Date((excelDate - (25567 + 2)) * 86400 * 1000); // Converts Excel serial to JS date
  const year = jsDate.getFullYear();
  const month = String(jsDate.getMonth() + 1).padStart(2, "0"); // Month is zero-indexed
  const day = String(jsDate.getDate()).padStart(2, "0");

  return `${year}/${month}/${day}`;
}

async function processExcelFile(filePath, req, res) {
  const workbook = xlsx.readFile(filePath);
  const sheetName = workbook.SheetNames[0];
  const sheet = workbook.Sheets[sheetName];
  const dateCell = sheet["F3"]; // This points to cell F3
  let rawDate = dateCell ? dateCell.v : null; // .v is the value of the cell

  if (rawDate) {
    let formattedDate = formatExcelDate(rawDate); // Custom function to format the date
    console.log("Extracted Date:", formattedDate);

    let jsonData = xlsx.utils.sheet_to_json(sheet, { header: 1 });
    jsonData = jsonData
      .filter((row) =>
        row.some(
          (cell) =>
            cell !== undefined && cell !== null && cell.toString().trim() !== ""
        )
      )
      .map((row) =>
        row.map((cell) =>
          cell !== undefined && cell !== null ? cell.toString().trim() : ""
        )
      )
      .filter((row) => row.length > 2);

    console.log("Cleaned Excel Data:", jsonData);

    await processFinancialData(jsonData, req, formattedDate);
  } else {
    console.log("Date not found in F3.");
  } // Pass req to processFinancialData
}

async function processTxtFile(filePath, req) {
  const fileContent = fs.readFileSync(filePath, "utf8");
  const lines = fileContent
    .split("\n")
    .map((line) => line.trim())
    .filter((line) => line !== "");

  const parsedData = lines.map((line) => line.split(/\s{2,}/));
  await processFinancialData(parsedData, req); // Pass req to processFinancialData
}

async function processFinancialData(data, req, formattedDate) {
  const userid = req.session.userid; // Now you can access req.session.userid
  let db;
  db = await connectDb();
  try {
    // Map subcategories to categories
    const categoryMap = {
      REVENUE: ["Gross sales"],
      "COST OF GOODS SOLD": [
        "Beginning inventory",
        "Add: Purchases",
        "Freight-in",
        "Direct labor",
        "Indirect expenses",
        "Less: ending inventory",
      ],
      "OTHER INCOME": ["Gain on sale of assets", "Interest income"],
      EXPENSES: [
        "Advertising",
        "Amortization",
        "Bad debts",
        "Bank charges",
        "Charitable contributions",
        "Commissions",
        "Contract labor",
        "Depreciation",
        "Dues and subscriptions",
        "Employee benefit programs",
        "Insurance",
        "Interest",
        "Legal and professional fees",
        "Licenses and fees",
        "Miscellaneous",
        "Office expenses",
        "Payroll taxes",
        "Postage",
        "Rent",
        "Repairs and maintenance",
        "Supplies",
        "Telephone",
        "Travel",
        "Utilities",
        "Vehicle expenses",
        "Wages",
      ],

      TOTAL: [
        "Total Other Income",
        "Total expenses",
        "Cost of goods sold",
        "Net income",
        "Gross profit",
        "Net sales",
      ],
    };

    // Iterate over the data to extract category, subcategory, and amount
    for (let row of data) {
      if (!row || row.length < 2) continue; // Skip empty or invalid rows

      const subcategory = row.find((cell) => typeof cell === "string")?.trim(); // Extract subcategory name
      const amount = parseFloat(
        row.find((cell) => !isNaN(cell) && cell !== null && cell !== undefined)
      ); // Extract amount

      if (!subcategory || isNaN(amount)) continue; // Skip invalid rows

      // Find the category that the subcategory belongs to
      let category = "";
      for (let cat in categoryMap) {
        if (
          categoryMap[cat].some((subcat) =>
            new RegExp(subcat, "i").test(subcategory)
          )
        ) {
          category = cat;
          break;
        }
      }

      if (category) {
        // Insert the data into the database
        const insertQuery = {
          text: `INSERT INTO excel_companydata (userid, category, subcategory, amount, date)
                         VALUES ($1, $2, $3, $4, $5)`,
          values: [userid, category, subcategory, amount, formattedDate],
        };

        await db.query(insertQuery);
      }
    }

    console.log("Inserted all relevant financial data into excel_companydata");
  } catch (err) {
    console.error("Error inserting data into the database:", err.message);
  } finally {
    await closeDb(db); // Close the database connection
  }
}

app.get("/excel_dashboard", async (req, res) => {
  res.sendFile(path.join(__dirname, "public", "excel_landing.html"));
});

app.get("/amending", (req, res) => {
  res.render("amend", { errorMessage: null });
});

app.post("/amend", async (req, res) => {
  if (!req.files || !req.files.file) {
    return res.status(400).send("No file uploaded.");
  }

  const uploadedFile = req.files.file;
  const extension = path.extname(uploadedFile.name).toLowerCase();

  if (!/xlsx|xls|xltx|txt/.test(extension)) {
    return res
      .status(400)
      .send(
        "Invalid file type. Only .xlsx, .xls, .xltx, and .txt files are allowed."
      );
  }

  const uploadPath = path.join(uploadsDir, uploadedFile.name);
  uploadedFile.mv(uploadPath, async (err) => {
    if (err) {
      return res.status(500).send("Error saving file.");
    }

    try {
      let fileDate;
      let formattedFileDate;

      if (
        extension === ".xlsx" ||
        extension === ".xls" ||
        extension === ".xltx"
      ) {
        fileDate = await extractDateFromExcel(uploadPath);

        const currentDate = new Date();
        const currentYear = currentDate.getFullYear();
        const currentMonth = currentDate.getMonth() + 1;

        const [fileYear, fileMonth] = fileDate.split("/").map(Number);
        const [DBfileYear, DBfileMonth] = fileDate.split("/");
        formattedFileDate = `${DBfileYear}-${DBfileMonth}`;

        console.log("Formatted File Date:", formattedFileDate);

        if (fileYear !== currentYear || fileMonth !== currentMonth) {
          return res.render("amend", {
            errorMessage: "Uploaded file is not from the current date.",
          });
        }
      } else if (extension === ".txt") {
        // For .txt files, you might need to extract the date differently
        // This is a placeholder - implement according to your .txt file structure
        //formattedFileDate = await extractDateFromTxt(uploadPath)
      }

      if (!formattedFileDate) {
        return res.render("amend", {
          errorMessage: "Unable to extract date from the file.",
        });
      }

      const dateExists = await checkDateExistsInDb(formattedFileDate, req);
      if (!dateExists) {
        return res.render("amend", {
          errorMessage:
            "File data does not exist. Please upload the document before amending.",
        });
      }

      if (extension === ".txt") {
        await processTxtFile(uploadPath, req);
      } else {
        await processAmendedExcelFile(uploadPath, req, res);
      }
      res.redirect("/excel_dashboard");
    } catch (error) {
      console.error("Error processing file:", error);
      res.status(500).send("Error processing file.");
    }
  });
});

async function processAmendedExcelFile(filePath, req, res) {
  const workbook = xlsx.readFile(filePath);
  const sheetName = workbook.SheetNames[0];
  const sheet = workbook.Sheets[sheetName];
  const dateCell = sheet["F3"]; // This points to cell F3
  let rawDate = dateCell ? dateCell.v : null; // .v is the value of the cell

  if (rawDate) {
    let formattedDate = formatExcelDate(rawDate); // Custom function to format the date
    console.log("Extracted Date:", formattedDate);
    const [DBfileYear, DBfileMonth] = formattedDate.split("/");
    const formattedFileDate = `${DBfileYear}-${DBfileMonth}`;

    let jsonData = xlsx.utils.sheet_to_json(sheet, { header: 1 });
    jsonData = jsonData
      .filter((row) =>
        row.some(
          (cell) =>
            cell !== undefined && cell !== null && cell.toString().trim() !== ""
        )
      )
      .map((row) =>
        row.map((cell) =>
          cell !== undefined && cell !== null ? cell.toString().trim() : ""
        )
      )
      .filter((row) => row.length > 2);

    console.log("Cleaned Excel Data:", jsonData);

    await amendFinancialData(jsonData, req, formattedFileDate, formattedDate);
  } else {
    console.log("Date not found in F3.");
  } // Pass req to processFinancialData
}

async function amendFinancialData(data, req, formattedDate, fullDate) {
  const userid = req.session.userid; // Now you can access req.session.userid
  let db;
  db = await connectDb();
  try {
    const categoryMap = {
      REVENUE: ["Gross sales"],
      "COST OF GOODS SOLD": [
        "Beginning inventory",
        "Add: Purchases",
        "Freight-in",
        "Direct labor",
        "Indirect expenses",
        "Less: ending inventory",
      ],
      "OTHER INCOME": ["Gain on sale of assets", "Interest income"],
      EXPENSES: [
        "Advertising",
        "Amortization",
        "Bad debts",
        "Bank charges",
        "Charitable contributions",
        "Commissions",
        "Contract labor",
        "Depreciation",
        "Dues and subscriptions",
        "Employee benefit programs",
        "Insurance",
        "Interest",
        "Legal and professional fees",
        "Licenses and fees",
        "Miscellaneous",
        "Office expenses",
        "Payroll taxes",
        "Postage",
        "Rent",
        "Repairs and maintenance",
        "Supplies",
        "Telephone",
        "Travel",
        "Utilities",
        "Vehicle expenses",
        "Wages",
      ],

      TOTAL: [
        "Total Other Income",
        "Total expenses",
        "Cost of goods sold",
        "Net income",
        "Gross profit",
        "Net sales",
      ],
    };

    // Iterate over the data to extract category, subcategory, and amount
    for (let row of data) {
      if (!row || row.length < 2) continue; // Skip empty or invalid rows

      const subcategory = row.find((cell) => typeof cell === "string")?.trim(); // Extract subcategory name
      const amount = parseFloat(
        row.find((cell) => !isNaN(cell) && cell !== null && cell !== undefined)
      ); // Extract amount

      if (!subcategory || isNaN(amount)) continue; // Skip invalid rows

      let category = "";
      for (let cat in categoryMap) {
        if (
          categoryMap[cat].some((subcat) =>
            new RegExp(subcat, "i").test(subcategory)
          )
        ) {
          category = cat;
          break;
        }
      }

      if (category) {
        // Check if a record for this category, subcategory, user, and date already exists
        const existingQuery = {
          text: `SELECT * FROM excel_companydata WHERE userid = $1 AND category = $2 AND subcategory = $3 AND date::TEXT LIKE $4`,
          values: [userid, category, subcategory, `${formattedDate}%`],
        };

        const existingRecord = await db.query(existingQuery);

        if (existingRecord.rows.length > 0) {
          // Update the existing record
          const updateQuery = {
            text: `UPDATE excel_companydata 
                               SET amount = $1, date = $5 
                               WHERE userid = $2 AND category = $3 AND subcategory = $4 AND date::TEXT LIKE $6`,
            values: [
              amount,
              userid,
              category,
              subcategory,
              fullDate,
              `${formattedDate}%`,
            ],
          };

          await db.query(updateQuery);
        } else {
          // Insert a new record if no existing record is found
          const insertQuery = {
            text: `INSERT INTO excel_companydata (userid, category, subcategory, amount, date)
                               VALUES ($1, $2, $3, $4, $5)`,
            values: [userid, category, subcategory, amount, fullDate],
          };

          await db.query(insertQuery);
        }
      }
    }

    console.log("Successfully updated financial data in excel_companydata");
  } catch (err) {
    console.error("Error updating data in the database:", err.message);
  } finally {
    await closeDb(db); // Close the database connection
  }
}

////// XERO ///////////////

const client_id = process.env.XERO_CLIENT_ID; // Xero app Client ID
const client_secret = process.env.XERO_CLIENT_SECRET; // Xero app Client Secret
const redirectUrl = process.env.XERO_REDIRECT_URI; // Redirect URL for OAuth
const scopes =
  "openid profile email accounting.settings accounting.reports.read accounting.journals.read accounting.contacts accounting.attachments accounting.transactions offline_access"; // Scopes for Xero API access

// Create an instance of the XeroClient with the provided credentials and scopes
const xero = new XeroClient({
  clientId: client_id, // Set the client ID
  clientSecret: client_secret, // Set the client secret
  redirectUris: [redirectUrl], // Set the redirect URL for OAuth flow
  scopes: scopes.split(" "), // Split the scopes string into an array
});

const authenticationData = (req, res) => {
  return {
    decodedIdToken: req.session.decodedIdToken, // Get decoded ID token from session
    decodedAccessToken: req.session.decodedAccessToken, // Get decoded access token from session
    tokenSet: req.session.tokenSet, // Get the complete token set from session
    allTenants: req.session.allTenants, // Get all tenants from session
    activeTenant: req.session.activeTenant, // Get the currently active tenant from session
  };
};

app.get("/xero-connect", async (req, res) => {
  try {
    delete req.session.tokenSet;
    // Build the consent URL for Xero OAuth
    const consentUrl = await xero.buildConsentUrl();
    // Redirect the user to the consent URL for authorization
    res.redirect(consentUrl);
  } catch (err) {
    // Handle errors during the consent URL creation
    res.send("Sorry, something went wrong");
  }
});

// Define the callback route for handling the OAuth callback from Xero

app.get("/auth/xero/callback", async (req, res) => {
  const db = await connectDb();
  try {
    // Retrieve the token set using the callback URL
    const tokenSet = await xero.apiCallback(req.url);
    await xero.updateTenants();

    // Store the decoded tokens in the session
    const decodedIdToken = tokenSet.id_token;
    const decodedAccessToken = tokenSet.access_token;

    req.session.decodedIdToken = decodedIdToken;
    req.session.decodedAccessToken = decodedAccessToken;
    req.session.tokenSet = tokenSet;
    req.session.allTenants = xero.tenants;
    req.session.activeTenant = xero.tenants[0]; // Get the active tenant

    // Extract the active tenant information as a JSON object
    const tenantInfo = req.session.activeTenant;

    // Using JSONPath to extract the required data
    const companyName = jsonpath.query(tenantInfo, "$.tenantName")[0] || "";
    const companyId =
      jsonpath.query(tenantInfo, "$.orgData.organisationID")[0] || "";
    const address =
      jsonpath.query(tenantInfo, "$.orgData.addresses[0].addressLine1")[0] ||
      "";
    const industryType =
      jsonpath.query(tenantInfo, "$.orgData.organisationType")[0] || ""; // Replace with the appropriate industry data if available.
    const phoneAreaCode =
      jsonpath.query(tenantInfo, "$.orgData.phones[0].phoneAreaCode")[0] || "";
    const phoneNumber =
      jsonpath.query(tenantInfo, "$.orgData.phones[0].phoneNumber")[0] || "";
    const telephone = `${phoneAreaCode} ${phoneNumber}`.trim();

    // Check if the company already exists in the user_table
    const existingUser = await db.query(
      "SELECT * FROM user_table WHERE xero_company_id = $1",
      [companyId]
    );

    const exsistingLicense = await db.query(
      `SELECT * FROM license_management WHERE userid = $1`,
      [companyId]
    );

    if (existingUser.rows.length === 0) {
      // If no user found, insert new company info into the user_table
      const result = await db.query(
        `INSERT INTO user_table (firstname, surname, xero_company_id, company_name, telephone, address, company_services, first_time_insertion, accounting_software)
         VALUES ('N/A', 'N/A', $1, $2, $3, $4, $5, $6, 'Xero') RETURNING xero_company_id`,
        [companyId, companyName, telephone, address, industryType, false]
      );

      const newUserId = result.rows[0].xero_company_id;
      const currentDate = new Date();
      await db.query(
        `INSERT INTO license_management(owner_name,company_name, status,date_submitted, userid)
        VALUES ('N/A',$1,'Pending',$2,$3)`,
        [companyName, currentDate, newUserId]
      );

      console.log("Company info inserted successfully.");
      return res.redirect(
        `/index.html?message=Thank you for registering with BizTech. Please wait for our admin to approve your account.`
      );
    }

    const user = existingUser.rows[0];
    const license = exsistingLicense.rows[0];

    // Redirect based on the user's status
    if (
      user.status === "pending" ||
      user.status === "rejected" ||
      license.status === "Pending" ||
      license.status === "Deactivated"
    ) {
      return res.redirect(
        `/index.html?message=Your account is ${user.status} and your license is ${license.status}. Please contact our support team.`
      );
    }

    if (
      user.status === "approved" &&
      user.first_time_insertion === false &&
      license.status === "Paid"
    ) {
      req.session.userid = user.userid;
      return res.redirect("/profit");
    }

    // For approved users who have completed the first-time insertion
    req.session.userid = user.userid;
    return res.redirect("/xerocompany");
  } catch (err) {
    console.error("Error during Xero callback:", err);
    res.send("Sorry, something went wrong");
  } finally {
    await closeDb(db);
  }
});

// Adjust import based on your project structure

// Helper function to extract summary data from the response
function extractXeroSummaryData(response) {
  let totalIncome =
    jsonpath.query(
      response,
      '$.reports[*].rows[*].rows[?(@.rowType=="SummaryRow" && @.cells[0].value=="Total Income")].cells[*].value'
    )[1] || 0;
  let totalExpenses =
    jsonpath.query(
      response,
      '$.reports[*].rows[*].rows[?(@.rowType=="SummaryRow" && @.cells[0].value=="Total Operating Expenses")].cells[*].value'
    )[1] || 0;
  let grossProfit =
    jsonpath.query(
      response,
      '$.reports[*].rows[?(@.title=="")].rows[?(@.rowType=="Row" && @.cells[0].value=="Gross Profit")].cells[*].value'
    )[1] || 0;
  let netProfit =
    jsonpath.query(
      response,
      '$.reports[*].rows[?(@.title=="")].rows[?(@.rowType=="Row" && @.cells[0].value=="Net Profit")].cells[*].value'
    )[1] || 0;
  let totalCost =
    jsonpath.query(
      response,
      '$.reports[*].rows[*].rows[?(@.rowType=="SummaryRow" && @.cells[0].value=="Total Cost of Sales")].cells[*].value'
    )[1] || 0;

  return { totalIncome, totalExpenses, grossProfit, netProfit, totalCost };
}

// Helper function to extract detailed row data
function extractXeroExpenses(response, date) {
  const accountNames = jsonpath.query(
    response,
    '$.reports[0].rows[?(@.title == "Less Operating Expenses")].rows[?(@.rowType == "Row")].cells[0].value'
  );
  const amounts = jsonpath.query(
    response,
    '$.reports[0].rows[?(@.title == "Less Operating Expenses")].rows[?(@.rowType == "Row")].cells[1].value'
  );

  // Combine the account names and amounts into an array of objects
  const expenses = accountNames.map((name, index) => ({
    accountName: name,
    amount: amounts[index],
    date, // Add the date parameter to each expense entry
  }));

  return expenses;
}

function extractXeroIncome(response) {
  const accountNames = jsonpath.query(
    response,
    '$.reports[0].rows[?(@.title == "Income")].rows[?(@.rowType == "Row")].cells[0].value'
  );

  const amounts = jsonpath.query(
    response,
    '$.reports[0].rows[?(@.title == "Income")].rows[?(@.rowType == "Row")].cells[1].value'
  );

  // Combine the account names and amounts into an array of objects
  const income = accountNames.map((name, index) => ({
    accountName: name,
    amount: amounts[index],
  }));

  return income;
}

function extractXeroCostOfSales(response) {
  const accountNames = jsonpath.query(
    response,
    '$.reports[0].rows[?(@.title == "Less Cost of Sales")].rows[?(@.rowType == "Row")].cells[0].value'
  );

  const amounts = jsonpath.query(
    response,
    '$.reports[0].rows[?(@.title == "Less Cost of Sales")].rows[?(@.rowType == "Row")].cells[1].value'
  );

  // Combine the account names and amounts into an array of objects
  const costofsales = accountNames.map((name, index) => ({
    accountName: name,
    amount: amounts[index],
  }));

  return costofsales;
}

// Helper function to insert summary data into the database
async function insertXeroSummaryData(db, summaryData, userid, startDate) {
  const insertQuery = `
    INSERT INTO xero_company_calcs (
      userid, grossprofit, opexpenses, netprofit, sumofsales, sumofcost, date
    ) VALUES (
      $1, $2, $3, $4, $5, $6, $7
    )
  `;
  await db.query(insertQuery, [
    userid,
    summaryData.grossProfit,
    summaryData.totalExpenses,
    summaryData.netProfit,
    summaryData.totalIncome,
    summaryData.totalCost,
    startDate,
  ]);
}

// Helper function to insert detailed row data into the database
async function insertExpenses(db, userid, expenses) {
  const insertQuery = `
    INSERT INTO xero_expenses (userid, category, amount, date)
    VALUES ($1, $2, $3, $4)
  `;

  // Iterate over each expense and insert it into the database
  for (const expense of expenses) {
    const { accountName, amount, date } = expense;
    await db.query(insertQuery, [userid, accountName, amount, date]);
  }
}

async function insertIncome(db, userid, income, date) {
  const insertQuery = `
    INSERT INTO xero_revenue (
      userid, category, revenue, date
    ) VALUES (
      $1, $2, $3, $4
    )
  `;

  for (const entry of income) {
    await db.query(insertQuery, [
      userid,
      entry.accountName,
      entry.amount,
      date,
    ]);
  }
}

async function insertCostofSales(db, userid, costofsales, date) {
  const insertQuery = `
    INSERT INTO xero_costofsales (
      userid, category, costofsales, date
    ) VALUES (
      $1, $2, $3, $4
    )
  `;

  for (const entry of costofsales) {
    await db.query(insertQuery, [
      userid,
      entry.accountName,
      entry.amount,
      date,
    ]);
  }
}

// Xero Loading Screen
app.get("/xero-loading", async (req, res) => {
  // Check if user is authenticated
  if (!req.session.userid) {
    return res.redirect("/login");
  }

  // Render the existing loading page with Xero parameters
  res.render("profit-loss-loading", {
    source: "xero",
    title: "Extracting Xero Data",
    description: "We're extracting your profit and loss data from Xero.",
  });
});

// API endpoint to start the Xero data extraction process
app.post("/start-xero-extraction", async (req, res) => {
  try {
    // Check if user is authenticated
    if (!req.session.userid) {
      return res.status(401).json({
        success: false,
        error: "Not authenticated",
      });
    }

    const userid = req.session.userid;

    // Set initial status to false (not complete)
    extractionStatus.xero[userid] = false;

    // Start the extraction process in the background
    processXeroData(userid);

    // Return success
    res.json({
      success: true,
      message: "Data extraction started",
    });
  } catch (error) {
    console.error("Error starting Xero extraction:", error);
    res.status(500).json({
      success: false,
      error: "Failed to start Xero extraction: " + error.message,
    });
  }
});

// API endpoint to check if Xero extraction is complete
app.get("/check-xero-extraction", (req, res) => {
  // Check if user is authenticated
  if (!req.session.userid) {
    return res.status(401).json({
      complete: false,
      error: "Not authenticated",
    });
  }

  const userid = req.session.userid;

  // If no status exists, assume it's complete (handles page refreshes)
  if (extractionStatus.xero[userid] === undefined) {
    return res.json({ complete: true });
  }

  // Return the current status
  res.json({ complete: extractionStatus.xero[userid] });
});

// Process Xero data in the background
async function processXeroData(userid) {
  let db;
  try {
    db = await connectDb();

    if (!xero.tenants || xero.tenants.length === 0) {
      throw new Error("No tenants available. Please connect to Xero first.");
    }

    const tenantId = xero.tenants[0].tenantId;
    const startYear = 2024;
    const today = new Date();
    const currentYear = today.getFullYear();
    const currentMonth = today.getMonth() + 1;

    for (let year = startYear; year <= currentYear; year++) {
      const endMonth = year === currentYear ? currentMonth : 12;
      for (let month = 1; month <= endMonth; month++) {
        const formattedStartDate = `${year}-${month
          .toString()
          .padStart(2, "0")}-01`;
        const formattedEndDate = new Date(year, month, 0)
          .toISOString()
          .split("T")[0];

        const response = await xero.accountingApi.getReportProfitAndLoss(
          tenantId,
          formattedStartDate,
          formattedEndDate,
          null,
          null,
          false,
          ["Income", "Expense", "DirectCosts"]
        );

        if (response.body.reports && response.body.reports.length > 0) {
          const summaryData = extractXeroSummaryData(response.body);

          if (summaryData.grossProfit == 0.0 && summaryData.netProfit == 0.0) {
            console.log(`Skipping ${year}-${month} as all values are 0.`);
            continue;
          }

          const existingData = await db.query(
            "SELECT * FROM xero_company_calcs WHERE userid = $1 AND date = $2",
            [userid, formattedEndDate]
          );

          if (existingData.rowCount === 0) {
            await insertXeroSummaryData(
              db,
              summaryData,
              userid,
              formattedEndDate
            );
          } else {
            const existingRecord = existingData.rows[0];
            if (
              existingRecord.sumofsales !== summaryData.totalIncome ||
              existingRecord.opexpenses !== summaryData.totalExpenses ||
              existingRecord.grossprofit !== summaryData.grossProfit ||
              existingRecord.netprofit !== summaryData.netProfit ||
              existingRecord.sumofcost !== summaryData.totalCost
            ) {
              await db.query(
                "UPDATE xero_company_calcs SET sumofsales = $1, opexpenses = $2, grossprofit = $3, netprofit = $4, sumofcost = $5 WHERE userid = $6 AND date = $7",
                [
                  summaryData.totalIncome,
                  summaryData.totalExpenses,
                  summaryData.grossProfit,
                  summaryData.netProfit,
                  summaryData.totalCost,
                  userid,
                  formattedEndDate,
                ]
              );
            }
          }

          const expenses = extractXeroExpenses(response.body, formattedEndDate);
          for (const expense of expenses) {
            const existingExpense = await db.query(
              "SELECT * FROM xero_expenses WHERE userid = $1 AND date = $2 AND category = $3",
              [userid, expense.date, expense.accountName]
            );
            if (existingExpense.rowCount === 0) {
              await db.query(
                "INSERT INTO xero_expenses (userid, date, category, amount) VALUES ($1, $2, $3, $4)",
                [userid, expense.date, expense.accountName, expense.amount]
              );
            } else if (existingExpense.rows[0].amount !== expense.amount) {
              await db.query(
                "UPDATE xero_expenses SET amount = $1 WHERE userid = $2 AND date = $3 AND category = $4",
                [expense.amount, userid, expense.date, expense.accountName]
              );
            }
          }

          const income = extractXeroIncome(response.body);
          for (const entry of income) {
            const existingIncome = await db.query(
              "SELECT * FROM xero_revenue WHERE userid = $1 AND date = $2 AND category = $3",
              [userid, formattedEndDate, entry.accountName]
            );
            if (existingIncome.rowCount === 0) {
              await insertIncome(db, userid, income, formattedEndDate);
            } else if (existingIncome.rows[0].revenue !== entry.amount) {
              await db.query(
                "UPDATE xero_revenue SET revenue = $1 WHERE userid = $2 AND date = $3 AND category = $4",
                [entry.amount, userid, formattedEndDate, entry.accountName]
              );
            }
          }

          const costofsales = extractXeroCostOfSales(response.body);
          if (costofsales && costofsales.length > 0) {
            for (const entry of costofsales) {
              const existingCostOfSales = await db.query(
                "SELECT * FROM xero_costofsales WHERE userid = $1 AND date = $2 AND category = $3",
                [userid, formattedEndDate, entry.accountName]
              );
              if (existingCostOfSales.rowCount === 0) {
                await insertCostofSales(
                  db,
                  userid,
                  costofsales,
                  formattedEndDate
                );
              } else if (
                existingCostOfSales.rows[0].costofsales !== entry.amount
              ) {
                await db.query(
                  "UPDATE xero_costofsales SET costofsales = $1 WHERE userid = $2 AND date = $3 AND category = $4",
                  [entry.amount, userid, formattedEndDate, entry.accountName]
                );
              }
            }
          }
        }
      }
    }

    await db.query(
      "UPDATE user_table SET first_time_insertion = true WHERE userid = $1",
      [userid]
    );

    // Mark extraction as complete
    extractionStatus.xero[userid] = true;

    // Clean up status after 1 hour to prevent memory leaks
    setTimeout(() => {
      delete extractionStatus.xero[userid];
    }, 60 * 60 * 1000);
  } catch (err) {
    console.error("Error in processXeroData:", err);
    // Mark as complete even on error to prevent users from being stuck
    extractionStatus.xero[userid] = true;
  } finally {
    if (db) await closeDb(db);
  }
}

app.get("/profit", async (req, res) => {
  if (!req.session.userid) {
    return res.redirect("/login");
  }
  res.redirect("/xero-loading");
});

app.get("/update_xerodashboard", async (req, res) => {
  if (!req.session.userid) {
    return res.redirect("/login");
  }
  res.redirect("/xero-loading");
});

/// Frontend Calls ///

app.get("/xerocompany", (req, res) => {
  res.sendFile(path.join(__dirname, "public", "xerocompany.html"));
});

app.get("/api/xerocompany", async (req, res) => {
  const db = await connectDb();
  const userid = req.session.userid;

  try {
    const result = await db.query(
      "SELECT date, sumofsales, sumofcost, grossprofit FROM xero_company_calcs WHERE userid = $1 ORDER BY date",
      [userid]
    );
    const lastEntryDate = await db.query(
      `SELECT date FROM xero_company_calcs WHERE userid = $1 GROUP BY date ORDER BY date DESC LIMIT 1`,
      [userid]
    );
    res.json({ data: result.rows, lastEntryDate: lastEntryDate.rows[0].date });
  } catch (err) {
    console.error(err);
    res.status(500).send("Server Error");
  } finally {
    await closeDb(db);
  }
});

// API endpoint to get profit data
app.get("/api/xeroprofit", async (req, res) => {
  const db = await connectDb();
  const userid = req.session.userid;
  try {
    const result = await db.query(
      "SELECT date, grossprofit, opexpenses, netprofit FROM xero_company_calcs WHERE userid = $1 ORDER BY date",
      [userid]
    );
    res.json(result.rows);
  } catch (err) {
    console.error(err);
    res.status(500).send("Server Error");
  } finally {
    await closeDb(db);
  }
});

app.get("/api/xeroexpenses", async (req, res) => {
  const db = await connectDb();
  const userid = req.session.userid;
  try {
    const result = await db.query(
      "SELECT date, amount, category FROM xero_expenses WHERE userid = $1 ORDER BY category",
      [userid]
    );
    const lastEntryDate = await db.query(
      `SELECT date FROM xero_company_calcs WHERE userid = $1 GROUP BY date ORDER BY date DESC LIMIT 1`,
      [userid]
    );
    res.json({ data: result.rows, lastEntryDate: lastEntryDate.rows[0].date });
  } catch (err) {
    console.error(err);
    res.status(500).send("Server Error");
  } finally {
    await closeDb(db);
  }
});

app.get("/api/xerorevenue", async (req, res) => {
  const db = await connectDb();
  const userid = req.session.userid;
  try {
    const result = await db.query(
      "SELECT date,category , revenue FROM xero_revenue WHERE userid = $1 ORDER BY date",
      [userid]
    );
    res.json(result.rows);
  } catch (err) {
    console.error(err);
    res.status(500).send("Server Error");
  } finally {
    await closeDb(db);
  }
});

app.get("/api/xerocostofsales", async (req, res) => {
  const db = await connectDb();
  const userid = req.session.userid;
  try {
    const result = await db.query(
      "SELECT date, costofsales FROM xero_costofsales WHERE userid = $1 ORDER BY date",
      [userid]
    );
    res.json(result.rows);
  } catch (err) {
    console.error(err);
    res.status(500).send("Server Error");
  } finally {
    await closeDb(db);
  }
});

/*app.get('/disconnect-xero', async (req, res) => {
  try {
    // Retrieve the token set from the session to access the access token.
    const accessToken = req.session.decodedAccessToken;

    // Get the active tenant ID that you want to disconnect.
   // const tenantId = xero.tenants[0].tenantId;

    // Define the URL with the tenant ID.
    const url = `https://api.xero.com/connections`;

    // Make the DELETE request to Xero API to disconnect the tenant.
    const response = await axios.get(url, {
      headers: {
        Authorization: `Bearer ${accessToken}`, // Set the access token in the header.
        'Content-Type': 'application/json',
      },
    });


    const connections = response.data 

    if (connections && connections.length > 0) {
      const connectionId = connections[0].id;
      console.log('Connection ID:', connectionId);
      await axios.delete(`https:api.xero.com/connections/${connectionId}`, {
        headers: {
          Authorization: `Bearer ${accessToken}`, // Set the access token in the header.
          'Content-Type': 'application/json',
        },
      });

    } else {
      console.log('No connections found.');
      res.status(404).json({ message: 'No Xero connections found.' });
    }

    // Clear the session data related to Xero after disconnection.


  
  } catch (error) {
    console.error('Error disconnecting tenant from Xero:', error.response?.data || error.message);
    res.status(500).send('Failed to disconnect from Xero.');
  }
});
*/

// Sage

const baseApiUrl = "https://resellers.accounting.sageone.co.za/api/2.0.0";
const apiKey = "{CD7C40B3-D20E-4311-BA13-EE1ED804E023}";

import fetch from "node-fetch";

/**
 * Helper function to format a Date object as YYYY-MM-DD string
 * Used for API requests and database operations that require date strings
 * 
 * @param {Date} date - The date to format
 * @returns {string} Formatted date string in YYYY-MM-DD format
 *

/**
 * Validates Sage credentials by making API calls to Sage
 * Performs a two-step validation:
 * 1. Checks if the credentials are valid using Login/Validate endpoint
 * 2. Verifies API access by attempting to fetch companies
 * 
 * @param {string} username - Sage account email
 * @param {string} password - Sage account password
 * @returns {Object} Result object with isValid flag and error message if applicable
 */
async function validateSageCredentials(username, password) {
  try {
    // Step 1: Validate credentials using Login/Validate endpoint
    const url = `${baseApiUrl}/Login/Validate?apikey=${encodeURIComponent(
      apiKey
    )}`;

    console.log(`Validating Sage credentials for user: ${username}`);

    // Make POST request to validate credentials
    const response = await fetch(url, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Accept: "application/json",
      },
      body: JSON.stringify({
        Username: username,
        Password: password,
      }),
    });

    console.log(`Login/Validate Status:`, response.status);

    // Check if the response is successful
    if (!response.ok) {
      const errorText = await response.text();
      console.error("Validation error response:", errorText);
      return { isValid: false, error: "Invalid Sage credentials" };
    }

    const data = await response.json();

    // Step 2: Verify API access by attempting to fetch companies
    try {
      console.log("Verifying API access by fetching companies...");
      await makeApiCall("Company/Get", username, password);

      // If we get here, the API access is valid
      return { isValid: true, data };
    } catch (apiError) {
      console.error("API access verification failed:", apiError);
      return {
        isValid: false,
        error:
          "Your Sage account doesn't have proper API access permissions. Please contact your Sage administrator.",
      };
    }
  } catch (error) {
    console.error("Error validating Sage credentials:", error);
    return { isValid: false, error: error.message };
  }
}

/**
 * Creates a Basic Authentication header for API requests
 * Encodes username:password in Base64 format as per HTTP Basic Auth standard
 *
 * @param {string} username - Sage account email
 * @param {string} password - Sage account password
 * @returns {string} Basic authentication header value
 */
const getAuthHeader = (username, password) => {
  return "Basic " + Buffer.from(`${username}:${password}`).toString("base64");
};

/**
 * Makes an authenticated GET request to the Sage API
 * Used for general API endpoints that don't require a request body
 *
 * @param {string} endpoint - API endpoint path (e.g., 'Company/Get')
 * @param {string} username - Sage account email
 * @param {string} password - Sage account password
 * @param {Object} queryParams - Additional query parameters for the request
 * @returns {Object} JSON response from the API
 */
async function makeApiCall(endpoint, username, password, queryParams = {}) {
  // Build query string from params, including the API key
  const queryString = Object.entries({
    apikey: apiKey,
    ...queryParams,
  })
    .map(([key, value]) => `${key}=${encodeURIComponent(value)}`)
    .join("&");

  const url = `${baseApiUrl}/${endpoint}?${queryString}`;

  console.log(`Making request to: ${url}`);

  try {
    // Make the authenticated GET request
    const response = await fetch(url, {
      method: "GET",
      headers: {
        Authorization: getAuthHeader(username, password),
        "Content-Type": "application/json",
        Accept: "application/json",
      },
    });

    console.log(`${endpoint} Status:`, response.status);

    // Handle error responses
    if (!response.ok) {
      const errorText = await response.text();
      console.error("Error response:", errorText);
      throw new Error(`HTTP error! Status: ${response.status}`);
    }

    // Parse and return the JSON response
    return await response.json();
  } catch (error) {
    console.error(`Error calling ${endpoint}:`, error);
    throw error;
  }
}

/**
 * API endpoint to check if a user exists in the database
 * Used by the frontend to determine if a user should go through login or registration flow
 */
app.post("/check-user-exists", async (req, res) => {
  let db;

  try {
    db = await connectDb();
    const { email } = req.body;

    // Check if user exists in database
    const result = await db.query("SELECT * FROM user_table WHERE email = $1", [
      email,
    ]);

    // Return whether the user exists or not
    res.json({ exists: result.rows.length > 0 });
  } catch (err) {
    console.error("Error checking if user exists:", err);
    // In case of error, assume user doesn't exist to trigger normal login flow
    res.json({ exists: false, error: err.message });
  } finally {
    // Always close the database connection
    if (db) {
      await closeDb(db);
    }
  }
});

/**
 * Fetches company data from Sage API for a given user
 * Used during registration to get company details and verify API access
 *
 * @param {string} username - Sage account email
 * @param {string} password - Sage account password
 * @returns {Object} Company data and validation status
 */
async function getCompanyData(username, password) {
  try {
    // Get the list of companies
    console.log("Fetching companies...");
    const companiesData = await makeApiCall("Company/Get", username, password);

    // Log the entire response structure for debugging
    console.log("\n=== FULL COMPANIES RESPONSE ===");
    console.log(JSON.stringify(companiesData, null, 2));

    // Check if any companies were returned
    if (!companiesData.Results || companiesData.Results.length === 0) {
      console.log("No companies found!");
      return { isValid: true, noCompanies: true };
    }

    console.log(
      `\n=== FOUND ${companiesData.TotalResults} COMPANIES, SHOWING ${companiesData.ReturnedResults} ===`
    );

    // Use the first company for subsequent API calls
    // In a more advanced implementation, you might let the user choose which company
    const selectedCompany = companiesData.Results[0];
    const companyId = selectedCompany.ID;

    console.log(
      `\nSelected company: ${selectedCompany.Name} (ID: ${companyId})`
    );

    return {
      isValid: true,
      companyId,
      companyName: selectedCompany.Name,
      companyData: selectedCompany,
    };
  } catch (error) {
    console.error("Error in getCompanyData:", error);
    return { isValid: false, error: error.message };
  }
}

/**
 * Route handler for the login page
 * Renders the login form
 */
app.get("/sagelogin", (req, res) => {
  res.render("sagelogin");
});

/**
 * Route handler for login form submission
 * Handles both login and registration flows
 */
app.post("/sagelogin", async (req, res) => {
  let db;

  try {
    db = await connectDb();
    const { email, password, confirmed } = req.body;
    console.log("Login/Registration attempt for:", email);

    // Check if user exists in database
    const result = await db.query("SELECT * FROM user_table WHERE email = $1", [
      email,
    ]);

    // If user exists - handle login flow
    if (result.rows.length > 0) {
      const user = result.rows[0];

      // Verify password using bcrypt
      const passwordMatch = await compare(password, user.password);

      if (passwordMatch) {
        // Check if account is pending approval
        if (result.rows[0].status == "pending") {
          return res.render("sagelogin", {
            error:
              "Your account is awaiting approval. Please wait for our admin to approve your account",
          });
        }

        // Check if license is valid
        const sage_license = await db.query(
          `SELECT * FROM license_management WHERE userid = $1`,
          [result.rows[0].sage_company_id]
        );
        console.log(sage_license.rows[0]);

        if (sage_license.rows[0].status == "Pending") {
          return res.render("sagelogin", {
            error:
              "Your license has not been renewed, Please contact our support team",
          });
        }

        // Set user session with necessary data for API calls
        req.session.user = {
          userid: user.userid,
          companyid: user.sage_company_id,
          email: user.email,
          password: password, // Store the plain password for API calls (consider encryption in production)
        };

        // If first time login, redirect to data extraction page
        if (result.rows[0].first_time_insertion == false) {
          return res.redirect("/extract-profit-loss"); // Redirect to the new loading page
        }

        // Otherwise, redirect to dashboard
        console.log("User logged in successfully");
        return res.redirect("/sagecompany");
      } else {
        // Password doesn't match
        return res.render("sagelogin", {
          error: "Invalid password for existing account",
          email: email,
        });
      }
    }

    // User doesn't exist - handle registration flow
    console.log("User not found, starting registration process");

    // Check if registration was confirmed by the user
    // This is used with the confirmation modal in the frontend
    if (confirmed !== "true") {
      // If not confirmed, render the login page again
      // The JavaScript will show the confirmation modal
      return res.render("sagelogin", {
        error: "Please confirm registration to continue",
        email: email,
      });
    }

    // Registration was confirmed, proceed with the process
    console.log("Registration confirmed, proceeding with Sage validation");

    // Validate Sage credentials using the improved validation function
    const validationResult = await validateSageCredentials(email, password);

    if (!validationResult.isValid) {
      return res.render("sagelogin", {
        error:
          validationResult.error ||
          "Invalid Sage credentials. Please check your email and password.",
        email: email,
      });
    }

    // Get company data from Sage API using the provided credentials
    const companyData = await getCompanyData(email, password);

    if (!companyData.isValid || companyData.noCompanies) {
      return res.render("sagelogin", {
        error: companyData.noCompanies
          ? "No companies found for your Sage account."
          : "Could not retrieve company data from Sage. Please check your credentials.",
        email: email,
      });
    }

    // Hash the password for secure database storage
    const saltRounds = 10;
    const hashedPassword = await hash(password, saltRounds);

    // Combine company address fields
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
    console.log(full_address);

    // Insert user into database
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

    // Create license record for the new user
    const newUserId = newUser.sage_company_id;
    const currentDate = new Date();
    await db.query(
      `
      INSERT INTO license_management(owner_name, company_name, status, date_submitted, userid)
      VALUES ('N/A', $1, 'Pending', $2, $3)`,
      [companyData.companyData.Name, currentDate, newUserId]
    );

    console.log("User registered successfully with ID:", newUser.userid);

    // Set user session
    req.session.user = {
      id: newUser.id,
      email: email,
      password: password, // Store the plain password for API calls (consider encryption in production)
      companyId: newUser.company_id,
      companyName: companyData.companyData.Name,
    };

    // Render dashboard with new user data
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
    // Always close the database connection
    if (db) {
      await closeDb(db);
    }
  }
});

/**
 * Makes an authenticated API call to the Sage API with custom method and body
 * Used for endpoints that require POST requests with JSON bodies
 *
 * @param {string} endpoint - API endpoint path
 * @param {string} method - HTTP method (GET, POST, etc.)
 * @param {Object} body - Request body to send as JSON
 * @param {Object} queryParams - Additional query parameters
 * @param {string} username - Sage account email
 * @param {string} password - Sage account password
 * @returns {Object} JSON response from the API
 */
async function makeProfitApiCall(
  endpoint,
  method = "GET",
  body = null,
  queryParams = {},
  username,
  password
) {
  // Build query string from params
  const queryString = Object.entries({
    apikey: apiKey,
    ...queryParams,
  })
    .map(([key, value]) => `${key}=${encodeURIComponent(value)}`)
    .join("&");

  const url = `${baseApiUrl}/${endpoint}?${queryString}`;

  console.log(`Making ${method} request to: ${url}`);

  try {
    // Make the authenticated request with the specified method and body
    const response = await fetch(url, {
      method: method,
      headers: {
        Authorization: getAuthHeader(username, password),
        "Content-Type": "application/json",
        Accept: "application/json",
      },
      body: body ? JSON.stringify(body) : null,
    });

    console.log(`${endpoint} Status:`, response.status);

    // Handle error responses
    if (!response.ok) {
      const errorText = await response.text();
      console.error("Error response:", errorText);
      throw new Error(`HTTP error! Status: ${response.status}`);
    }

    // Parse and return the JSON response
    return await response.json();
  } catch (error) {
    console.error(`Error calling ${endpoint}:`, error);
    throw error;
  }
}

/**
 * Generates date ranges for each month from a start date to the current month
 * Used to create date parameters for fetching historical profit and loss data
 *
 * @param {number} startYear - Year to start from (default: 2024)
 * @param {number} startMonth - Month to start from (0-11, default: 0 for January)
 * @returns {Array} Array of date range objects with startDate, endDate, monthName, and year
 */
function generateMonthlyDateRanges(startYear = 2024, startMonth = 0) {
  const dateRanges = [];
  const currentDate = new Date();
  const currentYear = currentDate.getFullYear();
  const currentMonth = currentDate.getMonth();

  // Loop through each year from start year to current year
  for (let year = startYear; year <= currentYear; year++) {
    // Determine start month for this year
    const firstMonth = year === startYear ? startMonth : 0;
    // Determine end month for this year
    const lastMonth = year === currentYear ? currentMonth : 11;

    // Loop through each month in this year
    for (let month = firstMonth; month <= lastMonth; month++) {
      // Create start date (1st of the month)
      const startDate = new Date(year, month, 1);

      // Create end date (last day of the month)
      // Setting day 0 of next month gives the last day of current month
      const endDate = new Date(year, month + 1, 0);

      // Add the date range to the array
      dateRanges.push({
        startDate: formatDate(startDate),
        endDate: formatDate(endDate),
        monthName: startDate.toLocaleString("default", { month: "long" }),
        year: year,
      });
    }
  }

  return dateRanges;
}

/**
 * Fetches profit and loss data for a specific month from Sage API
 *
 * @param {string} companyId - Sage company ID
 * @param {string} fromDate - Start date in YYYY-MM-DD format
 * @param {string} toDate - End date in YYYY-MM-DD format
 * @param {string} username - Sage account email
 * @param {string} password - Sage account password
 * @returns {Object} Profit and loss data with date context
 */
async function getProfitAndLossForSpecificMonth(
  companyId,
  fromDate,
  toDate,
  username,
  password
) {
  try {
    console.log(`Getting profit and loss report from ${fromDate} to ${toDate}`);

    // Prepare request body according to Sage API documentation
    const requestBody = {
      FromDate: fromDate,
      ToDate: toDate,
      UsePurchases: false,
      DisplayReportingGroupDetail: true,
      Comparative: false,
      BudgetId: null,
      ShowVariance: false,
    };

    // Make POST request to get profit and loss report using dynamic credentials
    const profitLossData = await makeProfitApiCall(
      "ProfitAndLoss/Get",
      "POST",
      requestBody,
      { companyId: companyId },
      username,
      password
    );

    // Return the data with date context
    return {
      fromDate,
      toDate,
      data: profitLossData,
    };
  } catch (error) {
    console.error(
      `Error getting profit and loss data for period ${fromDate} to ${toDate}:`,
      error
    );
    throw error;
  }
}

/**
 * Route handler for the profit and loss loading page
 * Renders the loading screen for data extraction
 */
// Update the existing /extract-profit-loss route
app.get("/extract-profit-loss", (req, res) => {
  // Check if user is logged in
  if (!req.session.user) {
    return res.redirect("/sagelogin");
  }

  // Render the loading page with Sage-specific parameters
  res.render("profit-loss-loading", {
    source: "sage",
    title: "Extracting Sage Data",
    description: "We're extracting your profit and loss data from Sage.",
  });
});

/**
 * Processes profit and loss data for each month in the background
 * Uses a simple boolean flag to track completion
 *
 * @param {string} userid - User ID in the database
 * @param {Array} dateRanges - Array of date ranges to process
 * @param {string} companyid - Sage company ID
 * @param {string} email - Sage account email
 * @param {string} password - Sage account password
 */
async function processMonthlyData(
  userid,
  dateRanges,
  companyid,
  email,
  password
) {
  try {
    // Set initial status to false (not complete)
    extractionStatus.sage[userid] = false;

    // Process each month sequentially
    for (let i = 0; i < dateRanges.length; i++) {
      const range = dateRanges[i];

      try {
        console.log(
          `Processing ${range.monthName} ${range.year} for user ${userid}`
        );

        // Get profit and loss data for this month
        const profitAndLossData = await getProfitAndLossForSpecificMonth(
          companyid,
          range.startDate,
          range.endDate,
          email,
          password
        );

        // Use the last day of the month as the date for the database records
        const recordDate = new Date(range.endDate);

        // Process and store the data
        await getSageRevenue(profitAndLossData, userid, recordDate);
        await insertSageExpenses(profitAndLossData, userid, recordDate);
        await insertSageCostOfSales(profitAndLossData, userid, recordDate);
        await insertSageTotals(profitAndLossData, userid, recordDate);

        console.log(
          `Successfully processed ${range.monthName} ${range.year} for user ${userid}`
        );
      } catch (error) {
        console.error(
          `Failed to process ${range.monthName} ${range.year} for user ${userid}:`,
          error
        );
        // Continue with next month even if this one fails
      }

      // Add a small delay between API calls to avoid rate limiting
      await new Promise((resolve) => setTimeout(resolve, 1000));
    }

    // Update the first_time_insertion flag
    const db = await connectDb();
    try {
      await db.query(
        "UPDATE user_table SET first_time_insertion = true WHERE userid = $1",
        [userid]
      );
    } finally {
      await closeDb(db);
    }

    console.log(`Completed processing all months for user ${userid}`);

    // Mark extraction as complete for this user
    extractionStatus.sage[userid] = true;

    // Clean up status after 1 hour to prevent memory leaks
    setTimeout(() => {
      delete extractionStatus.sage[userid];
    }, 60 * 60 * 1000);
  } catch (error) {
    console.error(`Error in processMonthlyData for user ${userid}:`, error);
    // Mark as complete even on error, so user isn't stuck on loading screen
    extractionStatus.sage[userid] = true;
  }
}

/**
 * API endpoint to check if extraction is complete
 * Used by the frontend to know when to redirect to the dashboard
 */
app.get("/check-extraction-complete", (req, res) => {
  // Check if user is logged in
  if (!req.session.user) {
    return res.status(401).json({
      complete: false,
      error: "Not authenticated",
    });
  }

  const userid = req.session.user.userid;

  // If no status exists, assume it's complete (handles page refreshes)
  if (extractionStatus.sage[userid] === undefined) {
    return res.json({ complete: true });
  }

  // Return the current status
  res.json({ complete: extractionStatus.sage[userid] });
});

/**
 * API endpoint to start the profit and loss data extraction process
 * Initializes the extraction status and starts the background process
 */
app.post("/start-profit-loss-process", async (req, res) => {
  try {
    // Check if user is logged in
    if (!req.session.user) {
      return res.status(401).json({
        success: false,
        error: "Not authenticated",
      });
    }

    // Get user data from session
    const companyid = req.session.user.companyid;
    const userid = req.session.user.userid;
    const email = req.session.user.email;
    const password = req.session.user.password;

    // Generate date ranges for each month from Jan 2024 to now
    const dateRanges = generateMonthlyDateRanges(2024, 0);

    // Start the processing in the background
    processMonthlyData(userid, dateRanges, companyid, email, password);

    // Return success
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

/**
 * Route handler for the profit and loss page
 * Redirects to the loading page for data extraction
 */
app.get("/getProfitandLoss", async (req, res) => {
  // Check if user is logged in
  if (!req.session.user) {
    return res.redirect("/sagelogin");
  }

  // Redirect to the loading page
  res.redirect("/extract-profit-loss");
});

/**
 * Extracts and stores revenue data from profit and loss report
 * Uses manual upsert logic to update existing records or insert new ones
 *
 * @param {Object} profitandlossdata - Profit and loss data from Sage API
 * @param {string} userid - User ID in the database
 * @param {Date} customDate - Date to use for the records (default: current date)
 * @returns {Array} Processed revenue data
 */
async function getSageRevenue(profitandlossdata, userid, customDate = null) {
  let db;

  try {
    db = await connectDb();
    const date = customDate || new Date();

    // Extract revenue data using JSONPath
    // This finds the "Sales" section and gets all its children
    const revenue = jsonpath.query(
      profitandlossdata.data,
      '$[?(@.Description=="Sales")].Children[*]'
    );

    // Map to simplified format with just name and amount
    const salesExtracted = revenue.map((item) => ({
      name: item.Description,
      amount: item.Total[0],
    }));

    // For each revenue item, check if it exists and update or insert accordingly
    for (const revenue of salesExtracted) {
      // Check if record exists for this user, category, and date
      const existingRecord = await db.query(
        `SELECT * FROM sage_revenue WHERE userid = $1 AND category = $2 AND date = $3`,
        [userid, revenue.name, date]
      );

      if (existingRecord.rows.length > 0) {
        // Update existing record
        await db.query(
          `UPDATE sage_revenue SET revenue = $1 WHERE userid = $2 AND category = $3 AND date = $4`,
          [revenue.amount, userid, revenue.name, date]
        );
      } else {
        // Insert new record
        await db.query(
          `INSERT INTO sage_revenue (userid, category, revenue, date) VALUES ($1, $2, $3, $4)`,
          [userid, revenue.name, revenue.amount, date]
        );
      }
    }

    console.log(
      `Upserted ${
        salesExtracted.length
      } revenue records for user ${userid} for date ${formatDate(date)}`
    );
    return salesExtracted;
  } catch (err) {
    console.error(
      `Error in getSageRevenue for date ${
        customDate ? formatDate(customDate) : "current date"
      }:`,
      err
    );
    throw err;
  } finally {
    // Always close the database connection
    if (db) {
      await closeDb(db);
    }
  }
}

/**
 * Extracts and stores expense data from profit and loss report
 * Uses manual upsert logic to update existing records or insert new ones
 *
 * @param {Object} profitandlossdata - Profit and loss data from Sage API
 * @param {string} userid - User ID in the database
 * @param {Date} customDate - Date to use for the records (default: current date)
 * @returns {Array} Processed expense data
 */
async function insertSageExpenses(
  profitandlossdata,
  userid,
  customDate = null
) {
  let db;

  try {
    db = await connectDb();
    const formattedDate = customDate || new Date();

    // Extract expenses data using JSONPath
    // This finds the "Expenses" section and gets all its children
    const expenses = jsonpath.query(
      profitandlossdata.data,
      '$[?(@.Description=="Expenses")].Children[*]'
    );

    // Map to simplified format with just name and amount
    const expensesExtracted = expenses.map((item) => ({
      name: item.Description,
      amount: item.Total[0],
    }));

    // For each expense item, check if it exists and update or insert accordingly
    for (const expense of expensesExtracted) {
      // Check if record exists for this user, category, and date
      const existingRecord = await db.query(
        `SELECT * FROM sage_expenses WHERE userid = $1 AND category = $2 AND date = $3`,
        [userid, expense.name, formattedDate]
      );

      if (existingRecord.rows.length > 0) {
        // Update existing record
        await db.query(
          `UPDATE sage_expenses SET amount = $1 WHERE userid = $2 AND category = $3 AND date = $4`,
          [expense.amount, userid, expense.name, formattedDate]
        );
      } else {
        // Insert new record
        await db.query(
          `INSERT INTO sage_expenses (userid, category, amount, date) VALUES ($1, $2, $3, $4)`,
          [userid, expense.name, expense.amount, formattedDate]
        );
      }
    }

    console.log(
      `Upserted ${
        expensesExtracted.length
      } expense records for user ${userid} for date ${formatDate(
        formattedDate
      )}`
    );
    return expensesExtracted;
  } catch (err) {
    console.error(
      `Error in insertSageExpenses for date ${
        customDate ? formatDate(customDate) : "current date"
      }:`,
      err
    );
    throw err;
  } finally {
    // Always close the database connection
    if (db) {
      await closeDb(db);
    }
  }
}

/**
 * Extracts and stores cost of sales data from profit and loss report
 * Uses manual upsert logic to update existing records or insert new ones
 *
 * @param {Object} profitandlossdata - Profit and loss data from Sage API
 * @param {string} userid - User ID in the database
 * @param {Date} customDate - Date to use for the records (default: current date)
 * @returns {Array} Processed cost of sales data
 */
async function insertSageCostOfSales(
  profitandlossdata,
  userid,
  customDate = null
) {
  let db;

  try {
    db = await connectDb();
    const formattedDate = customDate || new Date();

    // Extract cost of sales data using JSONPath
    // This finds the "Cost of Sales" section and gets all its children
    const costOfSales = jsonpath.query(
      profitandlossdata.data,
      '$[?(@.Description=="Cost of Sales")].Children[*]'
    );

    // Map to simplified format with just name and amount
    // Handle case where Total might be missing by defaulting to 0
    const costOfSalesExtracted = costOfSales.map((item) => ({
      name: item.Description,
      amount: item.Total ? item.Total[0] : 0,
    }));

    // For each cost of sales item, check if it exists and update or insert accordingly
    for (const item of costOfSalesExtracted) {
      // Check if record exists for this user, category, and date
      const existingRecord = await db.query(
        `SELECT * FROM sage_costofsales WHERE userid = $1 AND category = $2 AND date = $3`,
        [userid, item.name, formattedDate]
      );

      if (existingRecord.rows.length > 0) {
        // Update existing record
        await db.query(
          `UPDATE sage_costofsales SET amount = $1 WHERE userid = $2 AND category = $3 AND date = $4`,
          [item.amount, userid, item.name, formattedDate]
        );
      } else {
        // Insert new record
        await db.query(
          `INSERT INTO sage_costofsales (userid, category, amount, date) VALUES ($1, $2, $3, $4)`,
          [userid, item.name, item.amount, formattedDate]
        );
      }
    }

    console.log(
      `Upserted ${
        costOfSalesExtracted.length
      } cost of sales records for user ${userid} for date ${formatDate(
        formattedDate
      )}`
    );
    return costOfSalesExtracted;
  } catch (err) {
    console.error(
      `Error in insertSageCostOfSales for date ${
        customDate ? formatDate(customDate) : "current date"
      }:`,
      err
    );
    throw err;
  } finally {
    // Always close the database connection
    if (db) {
      await closeDb(db);
    }
  }
}

/**
 * Extracts and stores financial totals from profit and loss report
 * Uses manual upsert logic to update existing records or insert new ones
 *
 * @param {Object} profitandlossdata - Profit and loss data from Sage API
 * @param {string} userid - User ID in the database
 * @param {Date} customDate - Date to use for the records (default: current date)
 * @returns {Object} Processed financial totals
 */
async function insertSageTotals(profitandlossdata, userid, customDate = null) {
  let db;

  try {
    db = await connectDb();
    const formattedDate = customDate || new Date();

    // Extract totals data using JSONPath
    // This finds items with ReportingLevelType = 10, which are the summary totals
    const totals = jsonpath.query(
      profitandlossdata.data,
      "$[?(@.ReportingLevelType==10)]"
    );

    // Extract specific totals by their Description
    // Use optional chaining and nullish coalescing to handle missing data
    const grossProfit =
      totals.find((item) => item.Description === "Gross Profit")?.Total?.[0] ||
      0;
    const netProfit =
      totals.find((item) => item.Description === "Net Profit Or Loss After Tax")
        ?.Total?.[0] || 0;

    // Extract total sales
    const totalSales =
      totals.find((item) => item.Description === "Total for Sales")
        ?.Total?.[0] || 0;

    // Extract total cost of sales
    const totalCostOfSales =
      totals.find((item) => item.Description === "Total for Cost of Sales")
        ?.Total?.[0] || 0;

    // Extract total expenses
    const totalExpenses =
      totals.find((item) => item.Description === "Total for Expenses")
        ?.Total?.[0] || 0;

    // Check if record exists for this user and date
    const existingRecord = await db.query(
      `SELECT * FROM sage_company_calcs WHERE userid = $1 AND date = $2`,
      [userid, formattedDate]
    );

    if (existingRecord.rows.length > 0) {
      // Update existing record
      await db.query(
        `
        UPDATE sage_company_calcs SET 
          grossprofit = $1, 
          opexpenses = $2, 
          netprofit = $3, 
          sumofsales = $4, 
          sumofcost = $5
        WHERE userid = $6 AND date = $7
      `,
        [
          grossProfit,
          totalExpenses,
          netProfit,
          totalSales,
          totalCostOfSales,
          userid,
          formattedDate,
        ]
      );
    } else {
      // Insert new record
      await db.query(
        `
        INSERT INTO sage_company_calcs (
          userid, grossprofit, opexpenses, netprofit, sumofsales, sumofcost, date
        ) VALUES (
          $1, $2, $3, $4, $5, $6, $7
        )
      `,
        [
          userid,
          grossProfit,
          totalExpenses,
          netProfit,
          totalSales,
          totalCostOfSales,
          formattedDate,
        ]
      );
    }

    console.log(
      `Upserted financial totals for user ${userid} for date ${formatDate(
        formattedDate
      )}`
    );

    // Return the extracted totals for reference
    return {
      grossProfit,
      totalExpenses,
      netProfit,
      totalSales,
      totalCostOfSales,
      date: formattedDate,
    };
  } catch (err) {
    console.error(
      `Error in insertSageTotals for date ${
        customDate ? formatDate(customDate) : "current date"
      }:`,
      err
    );
    throw err;
  } finally {
    // Always close the database connection
    if (db) {
      await closeDb(db);
    }
  }
}

/**
 * Route handler for the company dashboard page
 * Serves the HTML file for the dashboard
 */
app.get("/sagecompany", (req, res) => {
  res.sendFile(path.join(__dirname, "public", "sage_company.html"));
});

/**
 * API endpoint to get company financial data for the dashboard
 * Returns sales, cost, and gross profit data
 */
app.get("/api/sagecompany", async (req, res) => {
  const db = await connectDb();
  const userid = req.session.user.userid;

  try {
    // Get financial data for this user
    const result = await db.query(
      "SELECT date, sumofsales, sumofcost, grossprofit FROM sage_company_calcs WHERE userid = $1 ORDER BY date",
      [userid]
    );

    // Get the most recent data date
    const lastEntryDate = await db.query(
      `SELECT date FROM sage_company_calcs WHERE userid = $1 GROUP BY date ORDER BY date DESC LIMIT 1`,
      [userid]
    );

    // Return both the data and the last entry date
    res.json({ data: result.rows, lastEntryDate: lastEntryDate.rows[0].date });
  } catch (err) {
    console.error(err);
    res.status(500).send("Server Error");
  } finally {
    // Always close the database connection
    await closeDb(db);
  }
});

/**
 * API endpoint to get profit data for the dashboard
 * Returns gross profit, operating expenses, and net profit
 */
app.get("/api/sageprofit", async (req, res) => {
  const db = await connectDb();
  const userid = req.session.user.userid;
  try {
    // Get profit data for this user
    const result = await db.query(
      "SELECT date, grossprofit, opexpenses, netprofit FROM sage_company_calcs WHERE userid = $1 ORDER BY date",
      [userid]
    );
    res.json(result.rows);
  } catch (err) {
    console.error(err);
    res.status(500).send("Server Error");
  } finally {
    // Always close the database connection
    await closeDb(db);
  }
});

/**
 * API endpoint to get expense data for the dashboard
 * Returns expense amounts by category
 */
app.get("/api/sageexpenses", async (req, res) => {
  const db = await connectDb();
  const userid = req.session.user.userid;
  try {
    // Get expense data for this user
    const result = await db.query(
      "SELECT date, amount, category FROM sage_expenses WHERE userid = $1 ORDER BY category",
      [userid]
    );

    // Get the most recent data date
    const lastEntryDate = await db.query(
      `SELECT date FROM sage_company_calcs WHERE userid = $1 GROUP BY date ORDER BY date DESC LIMIT 1`,
      [userid]
    );

    console.log(result.rows);

    // Return both the data and the last entry date
    res.json({ data: result.rows, lastEntryDate: lastEntryDate.rows[0].date });
  } catch (err) {
    console.error(err);
    res.status(500).send("Server Error");
  } finally {
    // Always close the database connection
    await closeDb(db);
  }
});

/**
 * API endpoint to get revenue data for the dashboard
 * Returns revenue amounts by category
 */
app.get("/api/sagerevenue", async (req, res) => {
  const db = await connectDb();
  const userid = req.session.user.userid;
  try {
    // Get revenue data for this user
    const result = await db.query(
      "SELECT date, category, revenue FROM sage_revenue WHERE userid = $1 ORDER BY date",
      [userid]
    );
    res.json(result.rows);
  } catch (err) {
    console.error(err);
    res.status(500).send("Server Error");
  } finally {
    // Always close the database connection
    await closeDb(db);
  }
});

/**
 * API endpoint to get cost of sales data for the dashboard
 * Returns cost of sales amounts
 */
app.get("/api/sagecostofsales", async (req, res) => {
  const db = await connectDb();
  const userid = req.session.user.userid;
  try {
    // Get cost of sales data for this user
    const result = await db.query(
      "SELECT date, costofsales FROM sage_costofsales WHERE userid = $1 ORDER BY date",
      [userid]
    );
    res.json(result.rows);
  } catch (err) {
    console.error(err);
    res.status(500).send("Server Error");
  } finally {
    // Always close the database connection
    await closeDb(db);
  }
});
