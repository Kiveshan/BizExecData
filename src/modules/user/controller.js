import { connectDb, closeDb } from "../../config/database.js";

export async function getDashboard(req, res) {
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
}

export async function getCompanyData(req, res) {
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
}

export async function getProfitData(req, res) {
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
}

export async function getRevenueData(req, res) {
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
}

export async function getCostOfSalesData(req, res) {
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
}

export async function getExpensesData(req, res) {
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
}
