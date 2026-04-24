import { SignUp } from "@clerk/nextjs";

export default function SignUpPage() {
  return (
    <main className="sign-shell">
      <SignUp
        routing="path"
        path="/sign-up"
        signInUrl="/sign-in"
        fallbackRedirectUrl="/dashboard"
        forceRedirectUrl="/dashboard"
      />
    </main>
  );
}
