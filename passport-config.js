import { Strategy as LocalStrategy } from 'passport-local';
 import bcrypt from 'bcrypt';
 import { findUserByEmail, findUserById } from './api.js';

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
    done(null, { userid: user.userid, role: user.role });
  });
  
  passport.deserializeUser(async ({ userid, role }, done) => {
    try {
      const user = await findUserById(userid);
      if (user) {
        user.role = role; // Set the role from the session
        done(null, user);
      } else {
        done(new Error('User not found'));
      }
    } catch (error) {
      done(error);
    }
  });
}

export async function createUser(email, password) {
  const domain = email.split('@')[1]; 

  let roleId;
  switch (domain) {
      case 1:
        res.redirect('/');
        break;
      case 2:
          res.redirect('/');
          break;
      case 3:
        res.redirect('/adminmenu');
        break;
        default:
        res.redirect('/login');
      break;
  }
 const hashedPassword = await hash(password, 10);
 
  await insertUserWithRoleId( email, roleId, hashedPassword);
}

async function insertUserWithRoleId(email, roleId, hashedPassword) {
  const db = await connectDb();
  try {
    
    const query = {
      text: `
        INSERT INTO user_table(email, roleid, password)
        VALUES($1, $2, $3)
        RETURNING *
      `,
      values: [ email, roleId, hashedPassword],
    };
    const result = await db.query(query);
    return result.rows[0];
  } catch (error) {
    console.error('Error inserting user with role ID:', error);
    throw error;
  } finally {
    await closeDb(db); 
  }
}


export default initialize;
