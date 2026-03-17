import { getPrismaClient } from "../../config/prismaClient.js";

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
  const prisma = getPrismaClient();
  const userid = req.session.userid;

  try {
    const data = await prisma.company_calcs.findMany({
      where: { userid },
      select: { date: true, sumofsales: true, sumofcost: true, grossprofit: true },
      orderBy: { date: "asc" },
    });
    const lastEntryDate = await prisma.company_calcs.findFirst({
      where: { userid },
      select: { date: true },
      orderBy: { date: "desc" },
    });
    res.json({ data, lastEntryDate: lastEntryDate?.date });
  } catch (err) {
    console.error(err);
    res.status(500).send("Server Error");
  }
}

export async function getProfitData(req, res) {
  const prisma = getPrismaClient();
  const userid = req.session.userid;
  try {
    const data = await prisma.company_calcs.findMany({
      where: { userid },
      select: { date: true, grossprofit: true, opexpenses: true, netprofit: true },
      orderBy: { date: "asc" },
    });
    res.json(data);
  } catch (err) {
    console.error(err);
    res.status(500).send("Server Error");
  }
}

export async function getRevenueData(req, res) {
  const prisma = getPrismaClient();
  const userid = req.session.userid;
  try {
    const data = await prisma.revenue.findMany({
      where: { userid },
      select: { date: true, revenue: true, category: true },
      orderBy: { date: "asc" },
    });
    res.json(data);
  } catch (err) {
    console.error(err);
    res.status(500).send("Server Error");
  }
}

export async function getCostOfSalesData(req, res) {
  const prisma = getPrismaClient();
  const userid = req.session.userid;
  try {
    const data = await prisma.costofsales.findMany({
      where: { userid },
      select: { date: true, costofsales: true, category: true },
      orderBy: { date: "asc" },
    });
    res.json(data);
  } catch (err) {
    console.error(err);
    res.status(500).send("Server Error");
  }
}

export async function getExpensesData(req, res) {
  const prisma = getPrismaClient();
  const userid = req.session.userid;
  try {
    const data = await prisma.expenses.findMany({
      where: { userid },
      select: { date: true, expenses: true, category: true },
      orderBy: { category: "asc" },
    });
    const lastEntryDate = await prisma.company_calcs.findFirst({
      where: { userid },
      select: { date: true },
      orderBy: { date: "desc" },
    });
    res.json({ data, lastEntryDate: lastEntryDate?.date });
  } catch (err) {
    console.error(err);
    res.status(500).send("Server Error");
  }
}
