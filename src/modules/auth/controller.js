import { connectDb, closeDb } from "../../config/database.js";
import { findUserByEmail, findRoleIdByRoleName } from "./service.js";
import { hash } from "bcrypt";
import passport from "passport";
import { validateEmail, validatePassword, sanitizeInput } from "../../utils/validation.js";
import logger, { createModuleLogger } from "../../utils/logger.js";

const authControllerLogger = createModuleLogger("auth-controller");

export async function login(req, res, next) {
  const db = await connectDb();
  authControllerLogger.debug({ email: req.body.email }, "Login attempt started");

  passport.authenticate("local", async (err, user, info) => {
    try {
      if (err || !user) {
        authControllerLogger.warn({ email: req.body.email }, "Login failed - user not found or error");
        return res.render("login", {
          error: "Account does not exsist please register",
        });
      }

      const loggedInUser = await findUserByEmail(user.email);
      authControllerLogger.debug({ userid: loggedInUser.userid, roleid: loggedInUser.roleid }, "User found");

      const exsistingLicense = await db.query(
        `SELECT * FROM license_management WHERE userid = $1`,
        [user.userid]
      );

      if (loggedInUser.roleid === 3) {
        req.login(user, async (err) => {
          if (err) {
            authControllerLogger.error({ err, userid: loggedInUser.userid }, "Session login error for admin");
            return next(err);
          }

          req.session.roleid = loggedInUser.roleid;
          req.session.userid = loggedInUser.userid;
          authControllerLogger.info({ userid: loggedInUser.userid, role: "admin" }, "Admin logged in successfully");

          return res.redirect("/dashboard");
        });
      } else {
        if (loggedInUser.status !== "approved") {
          authControllerLogger.warn({ userid: loggedInUser.userid, status: loggedInUser.status }, "Login failed - user not approved");
          return res.render("login", {
            error: "Please wait for our admin to approve you.",
          });
        }

        if (
          exsistingLicense.rows.length === 0 ||
          exsistingLicense.rows[0].status !== "Paid"
        ) {
          authControllerLogger.warn({ userid: loggedInUser.userid, licenseStatus: exsistingLicense.rows[0]?.status }, "Login failed - license not paid");
          return res.render("login", {
            error: "Please ensure you purchase licensing for the software.",
          });
        }

        req.login(user, async (err) => {
          if (err) {
            authControllerLogger.error({ err, userid: loggedInUser.userid }, "Session login error");
            return next(err);
          }

          req.session.roleid = loggedInUser.roleid;
          req.session.userid = loggedInUser.userid;
          authControllerLogger.info({ userid: loggedInUser.userid, role: "user" }, "User logged in successfully");

          return res.redirect("/dashboard");
        });
      }
    } catch (error) {
      authControllerLogger.error({ error }, "Login error");
      return next(error);
    } finally {
      await closeDb(db);
    }
  })(req, res, next);
}

export async function logout(req, res) {
  const userid = req.session?.userid;
  authControllerLogger.info({ userid }, "Logout initiated");

  req.logout(function (err) {
    if (err) {
      authControllerLogger.error({ err, userid }, "Error logging out");
      res.status(500).send("Internal Server Error");
      return;
    }
    authControllerLogger.info({ userid }, "Logout successful");
    res.redirect("/index");
  });
}

export async function register(req, res) {
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

  authControllerLogger.info({ email, company_name, accounting_software }, "Registration started");

  const db = await connectDb();

  try {
    if (!email || !password || !firstname || !surname) {
      authControllerLogger.warn({ email }, "Registration failed - missing required fields");
      throw new Error("Firstname, surname, email, and password are required");
    }

    if (!validateEmail(email)) {
      authControllerLogger.warn({ email }, "Registration failed - invalid email format");
      throw new Error("Invalid email format");
    }

    if (!validatePassword(password)) {
      authControllerLogger.warn({ email }, "Registration failed - invalid password");
      throw new Error("Password must be at least 8 characters long");
    }

    const sanitizedFirstname = sanitizeInput(firstname);
    const sanitizedSurname = sanitizeInput(surname);
    const sanitizedCompanyName = sanitizeInput(company_name);

    const emailCheck = await db.query(
      "SELECT email FROM user_table WHERE email = $1",
      [email.toLowerCase()]
    );

    if (emailCheck.rows.length > 0) {
      authControllerLogger.warn({ email }, "Registration failed - email already exists");
      throw new Error("Email is already in use");
    }

    let roleId = 0;

    const hashedPassword = await hash(password, 10);
    if (accounting_software == "excel") {
      roleId = 4;
    } else {
      roleId = 1;
    }

    const insertQuery = `
      INSERT INTO user_table (
        firstname, surname, company_name, email, address, telephone, password, accounting_software, company_services, roleid, status
      ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10,'pending') RETURNING userid
    `;

    const values = [
      sanitizedFirstname,
      sanitizedSurname,
      sanitizedCompanyName,
      email.toLowerCase(),
      sanitizeInput(address),
      sanitizeInput(telephone),
      hashedPassword,
      sanitizeInput(accounting_software),
      sanitizeInput(company_services),
      roleId,
    ];

    const result = await db.query(insertQuery, values);
    const userId = result.rows[0].userid;
    authControllerLogger.info({ userId, email }, "User registered successfully");

    await db.query(
      `INSERT INTO license_management (owner_name,company_name,status,date_submitted,userid)
      VALUES ($1,$2,'Pending',$3,$4)`,
      [sanitizedFirstname + " " + sanitizedSurname, sanitizedCompanyName, curentDate, userId]
    );
    authControllerLogger.info({ userId }, "License record created");

    res.redirect("/login");
  } catch (error) {
    authControllerLogger.error({ error, email }, "Registration error");
    const errorMessage = error.message.includes("already in use") 
      ? "Email is already in use" 
      : "Registration failed. Please try again.";
    res
      .status(400)
      .send(
        `<html><body><h1>Error</h1><p>${errorMessage}</p><p><a href="/register">Go back</a></p></body></html>`
      );
  } finally {
    await closeDb(db);
  }
}

export async function registerSimple(req, res) {
  const { email, password } = req.body;
  authControllerLogger.info({ email }, "Simple registration started");

  try {
    if (!email || !password) {
      authControllerLogger.warn("Simple registration failed - missing fields");
      throw new Error("Email and password are required");
    }
    authControllerLogger.info({ email }, "Simple registration successful");
    res.redirect("/login");
  } catch (error) {
    authControllerLogger.error({ error, email }, "Simple registration error");
    res
      .status(400)
      .send(
        `<html><body><h1>Error: ${error.message}</h1><p>Please go back and try again.</p></body></html>`
      );
  }
}

export async function updateUserRole(userid, chosen_role) {
  const db = await connectDb();

  try {
    authControllerLogger.info({ userid, chosen_role }, "Updating user role");
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
    authControllerLogger.info({ userid, chosen_role }, "User role updated successfully");
  } catch (error) {
    authControllerLogger.error({ error, userid, chosen_role }, "Error updating user role");
    throw error;
  } finally {
    await closeDb(db);
  }
}
