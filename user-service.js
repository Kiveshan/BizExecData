import { connectDb, closeDb } from "./db.js";

export async function findUserByEmail(email) {
  const db = await connectDb();
  try {
    const query = {
      text: "SELECT * FROM user_table WHERE email = $1",
      values: [email],
    };
    const result = await db.query(query);
    return result.rows[0];
  } catch (error) {
    console.error("Error finding user by email:", error);
    throw error;
  } finally {
    await closeDb(db);
  }
}

export async function findUserById(userid) {
  const db = await connectDb();
  try {
    const query = {
      text: "SELECT * FROM user_table WHERE userid = $1",
      values: [userid],
    };
    const result = await db.query(query);
    return result.rows[0];
  } catch (error) {
    console.error("Error finding user by userid:", error);
    throw error;
  } finally {
    await closeDb(db);
  }
}

export async function findRoleIdByRoleName(rolename) {
  const db = await connectDb();
  try {
    const query = {
      text: "SELECT roleid FROM roles WHERE rolename = $1",
      values: [rolename],
    };
    const result = await db.query(query);
    return result.rows[0]?.roleid;
  } catch (error) {
    console.error("Error finding role by rolename:", error);
    throw error;
  } finally {
    await closeDb(db);
  }
}
