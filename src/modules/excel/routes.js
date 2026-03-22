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
import { createModuleLogger } from "../../utils/logger.js";

const excelRouteLogger = createModuleLogger("excel-routes");

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const router = Router();

router.get("/excel_dashboard", checkAuthenticated, (req, res) => {
  excelRouteLogger.debug("Serving excel_dashboard page");
  res.render("excel_dashboard");
});

router.get("/excompany", checkAuthenticated, (req, res) => {
  excelRouteLogger.debug("Serving excompany page");
  res.render("excompany");
});

router.get("/excost", checkAuthenticated, (req, res) => {
  excelRouteLogger.debug("Serving excost page");
  res.render("excost");
});

router.get("/exincome", checkAuthenticated, (req, res) => {
  excelRouteLogger.debug("Serving exincome page");
  res.render("exincome");
});

router.get("/exexpenses", checkAuthenticated, (req, res) => {
  excelRouteLogger.debug("Serving exexpenses page");
  res.render("exexpenses");
});

router.get("/upload", checkAuthenticated, (req, res) => {
  excelRouteLogger.debug({ userid: req.session?.userid }, "Serving upload page");
  res.render("upload", { errorMessage: null });
});

router.post("/upload", checkAuthenticated, async (req, res) => {
  if (!req.files || !req.files.file) {
    excelRouteLogger.warn({ userid: req.session?.userid }, "No file uploaded");
    return res.status(400).send("No file uploaded.");
  }

  const uploadedFile = req.files.file;
  const extension = path.extname(uploadedFile.name).toLowerCase();
  excelRouteLogger.info({ userid: req.session?.userid, filename: uploadedFile.name, extension }, "File upload started");

  if (!/xlsx|xls|xltx|txt/.test(extension)) {
    excelRouteLogger.warn({ userid: req.session?.userid, extension }, "Invalid file type");
    return res.status(400).send("Invalid file type.");
  }

  try {
    let fileDate;
    let formattedFileDate;
    if (/xlsx|xls|xltx/.test(extension)) {
      fileDate = extractDateFromExcel(uploadedFile.data);
      // Handle both Date objects and string formats
      let year, month;
      if (fileDate instanceof Date) {
        year = fileDate.getFullYear();
        month = fileDate.getMonth() + 1;
      } else {
        const parts = fileDate.split("/");
        year = parseInt(parts[0], 10);
        month = parseInt(parts[1], 10);
      }
      formattedFileDate = `${year}-${String(month).padStart(2, "0")}`;
    }

    const currentDate = new Date();
    const currentYear = currentDate.getFullYear();
    const currentMonth = currentDate.getMonth() + 1;
    const [fileYear, fileMonth] = formattedFileDate.split("-").map(Number);

    if (
      fileYear > currentYear ||
      (fileYear === currentYear && fileMonth > currentMonth)
    ) {
      excelRouteLogger.warn({ userid: req.session?.userid, fileDate }, "Future date upload rejected");
      return res.render("upload", {
        errorMessage: "Cannot upload a date from the future.",
      });
    }

    const dateExists = await checkDateExistsInDb(formattedFileDate, req);
    if (dateExists) {
      excelRouteLogger.warn({ userid: req.session?.userid, fileDate }, "Duplicate date upload rejected");
      return res.render("upload", {
        errorMessage: `File for the date ${fileDate} has already been uploaded.`,
      });
    }

    if (extension === ".txt") {
      const content = uploadedFile.data.toString("utf8");
      await processTxtFile(content, req);
    } else {
      await processExcelFile(uploadedFile.data, req);
    }
    excelRouteLogger.info({ userid: req.session?.userid, fileDate }, "File processed successfully");
    res.redirect("/excompany");
  } catch (error) {
    excelRouteLogger.error({ 
      error: error?.message || 'Unknown error', 
      stack: error?.stack,
      userid: req.session?.userid, 
      filename: uploadedFile?.name 
    }, "Error processing file");
    res.status(500).send(`Error processing file: ${error?.message || 'Unknown error'}`);
  }
});

router.get("/amending", checkAuthenticated, (req, res) => {
  excelRouteLogger.debug("Serving amending page");
  res.render("amend", { errorMessage: null });
});

router.post("/amend", checkAuthenticated, async (req, res) => {
  if (!req.files || !req.files.file) {
    excelRouteLogger.warn("No file uploaded for amendment");
    return res.status(400).send("No file uploaded.");
  }

  const uploadedFile = req.files.file;
  const extension = path.extname(uploadedFile.name).toLowerCase();
  excelRouteLogger.info({ filename: uploadedFile.name, extension }, "File amendment started");

  if (!/xlsx|xls|xltx|txt/.test(extension)) {
    excelRouteLogger.warn({ extension }, "Invalid file type for amendment");
    return res.status(400).send("Invalid file type.");
  }

  try {
    let fileDate;
    let formattedFileDate;

    if (/xlsx|xls|xltx/.test(extension)) {
      fileDate = extractDateFromExcel(uploadedFile.data);
      // Handle both Date objects and string formats
      let year, month;
      if (fileDate instanceof Date) {
        year = fileDate.getFullYear();
        month = fileDate.getMonth() + 1;
      } else {
        const parts = fileDate.split("/");
        year = parseInt(parts[0], 10);
        month = parseInt(parts[1], 10);
      }
      formattedFileDate = `${year}-${String(month).padStart(2, "0")}`;

      const currentDate = new Date();
      const currentYear = currentDate.getFullYear();
      const currentMonth = currentDate.getMonth() + 1;

      if (year !== currentYear || month !== currentMonth) {
        excelRouteLogger.warn({ fileDate }, "Non-current date amendment rejected");
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
      excelRouteLogger.warn({ fileDate }, "Amendment rejected - date does not exist");
      return res.render("amend", {
        errorMessage: "File data does not exist. Please upload the document before amending.",
      });
    }

    if (extension === ".txt") {
      const content = uploadedFile.data.toString("utf8");
      await processTxtFile(content, req);
    } else {
      await processAmendedExcelFile(uploadedFile.data, req);
    }
    excelRouteLogger.info({ fileDate }, "File amended successfully");
    res.redirect("/excel_dashboard");
  } catch (error) {
    excelRouteLogger.error({ error, filename: uploadedFile.name }, "Error processing amendment");
    res.status(500).send("Error processing file.");
  }
});

router.get("/api/excompany", getExcelCompanyData);
router.get("/api/exprofit", getExcelProfitData);
router.get("/api/exexpenses", getExcelExpensesData);
router.get("/api/ex_income", getExcelIncomeData);
router.get("/api/ex_costofsales", getExcelCostOfSalesData);

export default router;
