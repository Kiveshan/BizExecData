import passport from "passport";
import { hash } from "bcrypt";
import { connectDb, closeDb } from "../db.js";
import { findUserByEmail } from "../user-service.js";
import { ROLES } from "../roles.js";

export async function login(req, res, next) {
  const db = await connectDb();

  passport.authenticate("local", async (err, user, info) => {
    try {
      if (err || !user) {
        return res.render("login", {
          error:
            "Incorrect email or password. Please try again or register an account.",
        });
      }

      const loggedInUser = await findUserByEmail(user.email);

      const exsistingLicense = await db.query(
        "SELECT * FROM license_management WHERE userid = $1",
        [user.userid]
      );

      if (loggedInUser.roleid === ROLES.ADMIN) {
        req.login(user, async (loginErr) => {
          if (loginErr) {
            return next(loginErr);
          }

          req.session.roleid = loggedInUser.roleid;
          req.session.userid = loggedInUser.userid;

          return res.redirect("/dashboard");
        });
      } else {
        if (loggedInUser.status !== "approved") {
          return res.render("login", {
            error:
              "Your account is not yet approved. Please wait for an administrator to approve your registration.",
          });
        }

        if (
          exsistingLicense.rows.length === 0 ||
          exsistingLicense.rows[0].status !== "Paid"
        ) {
          return res.render("login", {
            error:
              "Your license is not active. Please purchase or renew your license to continue.",
          });
        }

        req.login(user, async (loginErr) => {
          if (loginErr) {
            return next(loginErr);
          }

          req.session.roleid = loggedInUser.roleid;
          req.session.userid = loggedInUser.userid;

          return res.redirect("/dashboard");
        });
      }
    } catch (error) {
      return next(error);
    } finally {
      await closeDb(db);
    }
  })(req, res, next);
}

export async function logout(req, res) {
  req.logout(function (err) {
    if (err) {
      res.status(500).send("Internal Server Error");
      return;
    }
    res.redirect("/index");
  });
}

// Registration controller (used by POST /register)
export async function register(req, res) {
  const currentDate = new Date();
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
    clientid, // kept for future use
    clientsecret, // kept for future use
    redirecturl, // kept for future use
  } = req.body;

  const db = await connectDb();

  try {
    // Ensure required fields are present
    if (!email || !password || !firstname || !surname) {
      throw new Error("Firstname, surname, email, and password are required");
    }

    // Check if email already exists
    const emailCheck = await db.query(
      "SELECT email FROM user_table WHERE email = $1",
      [email]
    );

    if (emailCheck.rows.length > 0) {
      throw new Error("Email is already in use");
    }

    // Determine role based on accounting software
    let roleId;
    if (accounting_software === "excel") {
      roleId = ROLES.EXCEL_USER;
    } else {
      roleId = ROLES.COMPANY_USER;
    }

    // Hash the password
    const hashedPassword = await hash(password, 10);

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
      [firstname + " " + surname, company_name, currentDate, userId]
    );

    // Registration successful, redirect to login page
    res.redirect("/login");
  } catch (error) {
    console.error("Registration error:", error);
    res.status(400).render("register.ejs", {
      error: error.message,
      formData: req.body,
    });
  } finally {
    await closeDb(db);
  }
}
