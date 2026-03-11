import { connectDb, closeDb } from "../../config/database.js";
import { findUserByEmail, findRoleIdByRoleName } from "./service.js";
import { hash } from "bcrypt";
import passport from "passport";

export async function login(req, res, next) {
  const db = await connectDb();

  passport.authenticate("local", async (err, user, info) => {
    try {
      if (err || !user) {
        return res.render("login", {
          error: "Account does not exsist please register",
        });
      }

      const loggedInUser = await findUserByEmail(user.email);

      const exsistingLicense = await db.query(
        `SELECT * FROM license_management WHERE userid = $1`,
        [user.userid]
      );

      if (loggedInUser.roleid === 3) {
        req.login(user, async (err) => {
          if (err) {
            return next(err);
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

        req.login(user, async (err) => {
          if (err) {
            return next(err);
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
      console.error("Error logging out:", err);
      res.status(500).send("Internal Server Error");
      return;
    }
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

  const db = await connectDb();

  try {
    if (!email || !password || !firstname || !surname) {
      throw new Error("Firstname, surname, email, and password are required");
    }

    const emailCheck = await db.query(
      "SELECT email FROM user_table WHERE email = $1",
      [email]
    );

    if (emailCheck.rows.length > 0) {
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

export async function registerSimple(req, res) {
  const { email, password } = req.body;

  try {
    if (!email || !password) {
      throw new Error("Email and password are required");
    }
    res.redirect("/login");
  } catch (error) {
    console.error("Registration error:", error);
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
