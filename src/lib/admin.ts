import { auth, currentUser } from "@clerk/nextjs/server";

function readMetadataRole(sessionClaims: Awaited<ReturnType<typeof auth>>["sessionClaims"]) {
  const metadata = sessionClaims?.metadata;
  if (!metadata || typeof metadata !== "object") {
    return null;
  }

  const role = (metadata as Record<string, unknown>).role;
  return typeof role === "string" ? role : null;
}

async function resolveCurrentUserRole() {
  const user = await currentUser();
  const role = user?.publicMetadata?.role;
  return typeof role === "string" ? role : null;
}

export async function isCurrentUserAdmin() {
  const { sessionClaims } = await auth();
  const role = await resolveCurrentUserRole();
  return (role || readMetadataRole(sessionClaims)) === "admin";
}

export async function requireAdminUser() {
  const { userId, sessionClaims } = await auth();

  if (!userId) {
    return { userId: null, isAdmin: false };
  }

  const role = await resolveCurrentUserRole();
  return { userId, isAdmin: (role || readMetadataRole(sessionClaims)) === "admin" };
}
