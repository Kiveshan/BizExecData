import { getPrismaClient } from "../../config/prismaClient.js";
import { findUserByEmail, findRoleIdByRoleName } from "./service.js";
import { hash } from "bcrypt";
import passport from "passport";
import { validateEmail, validatePassword, sanitizeInput } from "../../utils/validation.js";
import logger, { createModuleLogger } from "../../utils/logger.js";

const authControllerLogger = createModuleLogger("auth-controller");

export async function login(req, res, next) {
  const prisma = getPrismaClient();
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

      const exsistingLicense = await prisma.license_management.findFirst({
        where: {
          userid: String(user.userid),
        },
      });

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
          !exsistingLicense ||
          exsistingLicense.status !== "Paid"
        ) {
          authControllerLogger.warn({ userid: loggedInUser.userid, licenseStatus: exsistingLicense?.status }, "Login failed - license not paid");
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
    company_services,
  } = req.body;

  const accounting_software = "excel";
  authControllerLogger.info({ email, company_name, accounting_software }, "Registration started");

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

    const prisma = getPrismaClient();
    const emailCheck = await prisma.user_table.findFirst({
      where: {
        email: email.toLowerCase(),
      },
      select: {
        email: true,
      },
    });

    if (emailCheck) {
      authControllerLogger.warn({ email }, "Registration failed - email already exists");
      throw new Error("Email is already in use");
    }

    const hashedPassword = await hash(password, 10);
    const roleId = 4;

    const createdUser = await prisma.user_table.create({
      data: {
        firstname: sanitizedFirstname,
        surname: sanitizedSurname,
        company_name: sanitizedCompanyName,
        email: email.toLowerCase(),
        address: sanitizeInput(address),
        telephone: sanitizeInput(telephone),
        password: hashedPassword,
        accounting_software: sanitizeInput(accounting_software),
        company_services: sanitizeInput(company_services),
        roleid: roleId,
        status: "pending",
      },
      select: {
        userid: true,
      },
    });
    const userId = createdUser.userid;
    authControllerLogger.info({ userId, email }, "User registered successfully");

    await prisma.license_management.create({
      data: {
        owner_name: sanitizedFirstname + " " + sanitizedSurname,
        company_name: sanitizedCompanyName,
        status: "Pending",
        date_submitted: curentDate,
        userid: String(userId),
      },
    });
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
  try {
    const prisma = getPrismaClient();
    authControllerLogger.info({ userid, chosen_role }, "Updating user role");

    const roleId = await findRoleIdByRoleName(chosen_role);
    if (!roleId) {
      throw new Error("Role not found");
    }

    await prisma.user_table.update({
      where: {
        userid,
      },
      data: {
        roleid: roleId,
      },
    });
    authControllerLogger.info({ userid, chosen_role }, "User role updated successfully");
  } catch (error) {
    authControllerLogger.error({ error, userid, chosen_role }, "Error updating user role");
    throw error;
  }
}
