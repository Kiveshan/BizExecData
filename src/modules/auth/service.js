import { getPrismaClient } from "../../config/prismaClient.js";

export async function findUserByEmail(email) {
  try {
    const prisma = getPrismaClient();
    return await prisma.user_table.findFirst({
      where: {
        email: email?.toLowerCase(),
      },
    });
  } catch (error) {
    console.error("Error finding user by email:", error);
    throw error;
  }
}

export async function findUserById(userid) {
  try {
    const prisma = getPrismaClient();
    return await prisma.user_table.findUnique({
      where: {
        userid,
      },
    });
  } catch (error) {
    console.error("Error finding user by userid:", error);
    throw error;
  }
}

export async function findRoleIdByRoleName(rolename) {
  try {
    const prisma = getPrismaClient();
    const role = await prisma.roles.findFirst({
      where: {
        rolename,
      },
      select: {
        roleid: true,
      },
    });
    return role?.roleid;
  } catch (error) {
    console.error("Error finding role by rolename:", error);
    throw error;
  }
}
