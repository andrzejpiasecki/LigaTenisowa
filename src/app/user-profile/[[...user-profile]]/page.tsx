import { UserProfile } from "@clerk/nextjs";

export default function UserProfilePage() {
  return (
    <main className="sign-shell">
      <UserProfile path="/user-profile" routing="path" />
    </main>
  );
}
