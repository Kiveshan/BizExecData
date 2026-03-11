import passport from "passport";
import { Strategy as LocalStrategy } from "passport-local";
import { findUserByEmail, findUserById } from "../modules/auth/service.js";

function initializePassport(passport) {
  passport.use(
    new LocalStrategy(
      { usernameField: "email" },
      async (email, password, done) => {
        try {
          const user = await findUserByEmail(email);
          if (!user) {
            return done(null, false, { message: "No user with that email" });
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
