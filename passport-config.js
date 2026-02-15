import { Strategy as LocalStrategy } from 'passport-local';
import bcrypt from 'bcrypt';
import { findUserByEmail, findUserById } from './user-service.js';

async function initialize(passport) {
  const authenticateUser = async (email, password, done) => {
    try {
      const user = await findUserByEmail(email);
      if (!user) {
        return done(null, false, { message: 'No user with that email' });
      }
      
      const passwordMatch = await bcrypt.compare(password, user.password);
      if (passwordMatch) {
        return done(null, user);
      } else {
        return done(null, false, { message: 'Password incorrect' });
      }
    } catch (error) {
      return done(error);
    }
  };

  passport.use(new LocalStrategy({ usernameField: 'email' }, authenticateUser));

  passport.serializeUser((user, done) => {
    // Persist only the minimal data needed to rehydrate the user
    done(null, { userid: user.userid, roleid: user.roleid });
  });
  
  passport.deserializeUser(async ({ userid, roleid }, done) => {
    try {
      const user = await findUserById(userid);
      if (user) {
        // Prefer the roleid from the DB but fall back to the serialized value if needed
        if (roleid != null) {
          user.roleid = roleid;
        }
        done(null, user);
      } else {
        done(new Error('User not found'));
      }
    } catch (error) {
      done(error);
    }
  });
}
export default initialize;
