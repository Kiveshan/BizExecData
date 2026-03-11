import { Router } from "express";
import path from "path";
import { fileURLToPath } from "url";
import { checkAuthenticated } from "../../middleware/auth.js";
import {
  checkDateExistsInDb,
  extractDateFromExcel,
  processExcelFile,
  processTxtFile,
  processAmendedExcelFile,
  getExcelCompanyData,
  getExcelProfitData,
  getExcelExpensesData,
  getExcelIncomeData,
  getExcelCostOfSalesData,
} from "./controller.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const router = Router();

router.get("/excel_dashboard", (req, res) => {
  res.sendFile(path.join(__dirname, "..", "..", "..", "public", "excel_landing.html"));
});

router.get("/upload", checkAuthenticated, (req, res) => {
  res.render("upload.ejs", { errorMessage: null });
});

router.post("/upload", checkAuthenticated, async (req, res) => {
  if (!req.files || !req.files.file) {
    return res.status(400).send("No file uploaded.");
  }

  const uploadedFile = req.files.file;
  const extension = path.extname(uploadedFile.name).toLowerCase();

  if (!/xlsx|xls|xltx|txt/.test(extension)) {
    return res.status(400).send("Invalid file type.");
  }

  try {
    let fileDate;
    let formattedFileDate;
    if (/xlsx|xls|xltx/.test(extension)) {
      fileDate = extractDateFromExcel(uploadedFile.data);
      const [DBfileYear, DBfileMonth] = fileDate.split("/");
      formattedFileDate = `${DBfileYear}-${DBfileMonth}`;
    }

    const currentDate = new Date();
    const currentYear = currentDate.getFullYear();
    const currentMonth = currentDate.getMonth() + 1;
    const [fileYear, fileMonth] = formattedFileDate.split("-").map(Number);

    if (
      fileYear > currentYear ||
      (fileYear === currentYear && fileMonth > currentMonth)
    ) {
      return res.render("upload.ejs", {
        errorMessage: "Cannot upload a date from the future.",
      });
    }

    const dateExists = await checkDateExistsInDb(formattedFileDate, req);
    if (dateExists) {
      return res.render("upload.ejs", {
        errorMessage: `File for the date ${fileDate} has already been uploaded.`,
      });
    }

    if (extension === ".txt") {
      const content = uploadedFile.data.toString("utf8");
      await processTxtFile(content, req);
    } else {
      await processExcelFile(uploadedFile.data, req, res);
    }
    res.redirect("/excompany.html");
  } catch (error) {
    console.error("Error processing file:", error);
    res.status(500).send("Error processing file.");
  }
});

router.get("/amending", (req, res) => {
  res.render("amend", { errorMessage: null });
});

router.post("/amend", async (req, res) => {
  if (!req.files || !req.files.file) {
    return res.status(400).send("No file uploaded.");
  }

  const uploadedFile = req.files.file;
  const extension = path.extname(uploadedFile.name).toLowerCase();

  if (!/xlsx|xls|xltx|txt/.test(extension)) {
    return res.status(400).send("Invalid file type.");
  }

  try {
    let fileDate;
    let formattedFileDate;

    if (/xlsx|xls|xltx/.test(extension)) {
      fileDate = extractDateFromExcel(uploadedFile.data);
      const currentDate = new Date();
      const currentYear = currentDate.getFullYear();
      const currentMonth = currentDate.getMonth() + 1;
      const [fileYear, fileMonth] = fileDate.split("/").map(Number);
      const [DBfileYear, DBfileMonth] = fileDate.split("/");
      formattedFileDate = `${DBfileYear}-${DBfileMonth}`;

      if (fileYear !== currentYear || fileMonth !== currentMonth) {
        return res.render("amend", {
          errorMessage: "Uploaded file is not from the current date.",
        });
      }
    }

    if (!formattedFileDate) {
      return res.render("amend", {
        errorMessage: "Unable to extract date from the file.",
      });
    }

    const dateExists = await checkDateExistsInDb(formattedFileDate, req);
    if (!dateExists) {
      return res.render("amend", {
        errorMessage: "File data does not exist. Please upload the document before amending.",
      });
    }

    if (extension === ".txt") {
      const content = uploadedFile.data.toString("utf8");
      await processTxtFile(content, req);
    } else {
      await processAmendedExcelFile(uploadedFile.data, req, res);
    }
    res.redirect("/excel_dashboard");
  } catch (error) {
    console.error("Error processing file:", error);
    res.status(500).send("Error processing file.");
  }
});

router.get("/api/excompany", getExcelCompanyData);
router.get("/api/exprofit", getExcelProfitData);
router.get("/api/exexpenses", getExcelExpensesData);
router.get("/api/ex_income", getExcelIncomeData);
router.get("/api/ex_costofsales", getExcelCostOfSalesData);

export default router;
