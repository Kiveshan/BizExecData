import { connectDb, closeDb } from "../db.js";

export async function listLicenses(req, res) {
  const db = await connectDb();
  try {
    const result = await db.query("SELECT * FROM license_management");
    res.render("licensemgt.ejs", { licenses: result.rows });
  } catch (err) {
    console.error("Error fetching licenses:", err);
    res.status(500).send("Error occurred while fetching licenses.");
  } finally {
    await closeDb(db);
  }
}

export async function renewLicense(req, res) {
  const { userid } = req.params;
  const currentDate = new Date();
  const expirationDate = new Date(currentDate);
  expirationDate.setFullYear(currentDate.getFullYear() + 1);
  const db = await connectDb();
  try {
    await db.query(
      `UPDATE license_management SET status = 'Paid', expiration_date = $1 WHERE userid = $2`,
      [expirationDate, userid]
    );
    res.redirect("/licensemgt");
  } catch (err) {
    console.error("Error renewing license:", err);
    res.status(500).send("Error occurred while renewing license.");
  } finally {
    await closeDb(db);
  }
}

export async function deactivateLicense(req, res) {
  const { userid } = req.params;
  const db = await connectDb();
  try {
    await db.query(
      `UPDATE license_management SET status = 'Deactivated' WHERE userid = $1`,
      [userid]
    );
    res.redirect("/licensemgt");
  } catch (err) {
    console.error("Error deactivating license:", err);
    res.status(500).send("Error occurred while deactivating license.");
  } finally {
    await closeDb(db);
  }
}
