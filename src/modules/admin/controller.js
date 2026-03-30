import { getPrismaClient } from "../../config/prismaClient.js";
import { createModuleLogger } from "../../utils/logger.js";

const moduleLogger = createModuleLogger("admin-controller");

export async function getAdminDashboard(req, res) {
  res.status(410).send("Admin dashboard is not available on this deployment.");
}

export async function previewUser(req, res) {
  res.status(410).send("User preview is not available on this deployment.");
}

export async function approveUser(req, res) {
  const { id } = req.params;

  try {
    const prisma = getPrismaClient();
    const user = await prisma.user_table.findUnique({
      where: { userid: Number(id) },
    });

    if (user) {
      if (user.status !== "approved") {
        await prisma.user_table.update({
          where: { userid: Number(id) },
          data: { status: "approved" },
        });
      }

      moduleLogger.info(`User profile with ID ${id} approved and roles updated.`);
    }
    res.redirect("/adminmenu");
  } catch (err) {
    console.error("Error approving user", err);
    res.status(500).send("Error approving user");
  }
}

export async function rejectUser(req, res) {
  const { id } = req.params;
  try {
    const prisma = getPrismaClient();
    await prisma.user_table.update({
      where: { userid: Number(id) },
      data: { status: "rejected" },
    });
    res.redirect("/adminmenu");
  } catch (err) {
    console.error("Error rejecting user", err);
    res.status(500).send("Error rejecting user");
  }
}

export async function getApprovedUsers(req, res) {
  res.status(410).send("Approved users endpoint is not available on this deployment.");
}

export async function getLicenseManagement(req, res) {
  try {
    const prisma = getPrismaClient();
    const licenses = await prisma.license_management.findMany({
      orderBy: { licenseid: "asc" },
    });
    res.render("licensemgt.ejs", { licenses });
  } catch (err) {
    console.error("Error fetching licenses:", err);
    res.status(500).send("Error occurred while fetching licenses.");
  }
}

export async function renewLicense(req, res) {
  const { userid } = req.params;
  const currentDate = new Date();
  const expirationDate = new Date(currentDate);
  expirationDate.setFullYear(currentDate.getFullYear() + 1);
  try {
    const prisma = getPrismaClient();
    await prisma.license_management.updateMany({
      where: { userid: String(userid) },
      data: { status: "Paid", expiration_date: expirationDate },
    });
    res.redirect("/licensemgt");
  } catch (err) {
    console.error(err);
  }
}

export async function deactivateLicense(req, res) {
  const { userid } = req.params;
  try {
    const prisma = getPrismaClient();
    await prisma.license_management.updateMany({
      where: { userid: String(userid) },
      data: { status: "Deactivated" },
    });
    res.redirect("/licensemgt");
  } catch (err) {
    console.error(err);
  }
}

export async function getCompanyRegApplications(req, res) {
  try {
    const prisma = getPrismaClient();
    const applications = await prisma.user_table.findMany({
      orderBy: { userid: "asc" },
    });
    res.render("companyregapplications", { applications });
  } catch (err) {
    console.error("Error executing query", err);
    res.status(500).send("Error retrieving data from database");
  }
}

export async function getCompanyRegDetails(req, res) {
  try {
    const { id } = req.params;
    const prisma = getPrismaClient();
    const application = await prisma.user_table.findUnique({
      where: { userid: Number(id) },
    });

    if (!application) {
      return res.status(404).send("Application not found");
    }

    res.render("companyregdetails", { application });
  } catch (err) {
    console.error("Error fetching application details", err);
    res.status(500).send("Error retrieving application details");
  }
}
