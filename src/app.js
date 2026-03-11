import express from "express";
import dotenv from "dotenv";
import path from "path";
import { fileURLToPath } from "url";
import bodyParser from "body-parser";
import flash from "express-flash";
import passport from "passport";
import methodOverride from "method-override";
import fileUpload from "express-fileupload";
import initializePassport from "./config/passport.js";
import { createSessionMiddleware } from "./middleware/session.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

dotenv.config();

const app = express();

app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.set("view engine", "ejs");

app.use(express.static("public"));
app.use(bodyParser.urlencoded({ extended: true }));
app.use(flash());
app.use(createSessionMiddleware());
app.use(passport.initialize());
app.use(passport.session());
app.use(methodOverride("_method"));
app.use(fileUpload());

initializePassport(passport);

export default app;
export { __dirname };
