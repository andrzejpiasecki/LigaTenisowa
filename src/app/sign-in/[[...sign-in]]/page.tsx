import { SignIn } from "@clerk/nextjs";

export default function SignInPage() {
  return (
    <main className="sign-shell">
      <SignIn
        routing="path"
        path="/sign-in"
        signUpUrl="/sign-up"
        fallbackRedirectUrl="/dashboard"
        forceRedirectUrl="/dashboard"
      />
    </main>
  );
}
