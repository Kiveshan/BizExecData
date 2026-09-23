import { Strategy as LocalStrategy } from "passport-local";
import { compare } from "bcrypt";
import { findUserByEmail, findUserById } from "../modules/auth/service.js";

function initializePassport(passport) {
  passport.use(
    new LocalStrategy(
      { usernameField: "email" },
      async (email, password, done) => {
        try {
          const user = await findUserByEmail(email);
          // Accounts created through QuickBooks/Xero OAuth have no password and
          // must never be reachable through the local strategy.
          if (!user || !user.password || typeof password !== "string") {
            return done(null, false, { message: "Invalid email or password" });
          }
          const passwordMatch = await compare(password, user.password);
          if (!passwordMatch) {
            return done(null, false, { message: "Invalid email or password" });
          }
          return done(null, user);
        } catch (error) {
          return done(error);
        }
      }
    )
  );

  passport.serializeUser((user, done) => {
    done(null, user.userid);
  });

  passport.deserializeUser(async (userid, done) => {
    try {
      const user = await findUserById(userid);
      done(null, user);
    } catch (error) {
      done(error, null);
    }
  });
}

export default initializePassport;
