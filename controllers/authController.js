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
          error: "Account does exsist please register",
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
            error: "Please wait for our admin to approve you.",
          });
        }

        if (
          exsistingLicense.rows.length === 0 ||
          exsistingLicense.rows[0].status !== "Paid"
        ) {
          return res.render("login", {
            error: "Please ensure you purchase licensing for the software.",
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
    res
      .status(400)
      .send(
        `<html><body><h1>Error: ${error.message}</h1><p>Please go back and try again.</p></body></html>`
      );
  } finally {
    await closeDb(db);
  }
}
