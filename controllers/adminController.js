import { connectDb, closeDb } from "../db.js";

export async function getAdminDashboard(req, res) {
  const db = await connectDb();
  try {
    const result = await db.query("SELECT * FROM user_profile");
    const users = result.rows;

    const usersResult = await db.query("SELECT * FROM user_table");
    const userData = usersResult.rows;

    res.render("adminDashboard", { userData, users, user: req.user });
  } catch (error) {
    console.error("Error fetching profiles:", error);
    res.status(500).json({ error: "Internal server error" });
  } finally {
    await closeDb(db);
  }
}

export async function previewUser(req, res) {
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

export async function approveUser(req, res) {
  const { id } = req.params;
  const db = await connectDb();

  try {
    const userResult = await db.query(
      "SELECT * FROM user_table WHERE userid = $1",
      [id]
    );
    const user = userResult.rows[0];

    if (user && user.status !== "approved") {
      await db.query("UPDATE user_table SET status = $1 WHERE userid = $2", [
        "approved",
        id,
      ]);
    }

    await closeDb(db);
    res.redirect("/adminmenu");
  } catch (err) {
    await closeDb(db);
    console.error("Error approving user", err);
    res.status(500).send("Error approving user");
  }
}

export async function rejectUser(req, res) {
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

export async function listCompanyApplications(req, res) {
  const db = await connectDb();
  try {
    const applicationsResult = await db.query("SELECT * FROM user_table");
    const applications = applicationsResult.rows;

    res.render("companyregapplications", { applications });
  } catch (err) {
    console.error("Error executing query", err);
    res.status(500).send("Error retrieving data from database");
  } finally {
    await closeDb(db);
  }
}

export async function getCompanyRegDetails(req, res) {
  const db = await connectDb();
  try {
    const { id } = req.params;

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
    await closeDb(db);
  }
}
