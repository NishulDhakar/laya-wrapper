import { LoginForm } from "./login-form";

export default function LoginPage() {
  return (
    <main className="flex min-h-screen items-center justify-center px-4">
      <div className="w-full max-w-sm rounded-xl border border-line bg-surface p-6 shadow-sm">
        <div className="mb-6">
          <h1 className="text-lg font-semibold">laya-hub</h1>
          <p className="text-sm text-muted">Sign in to manage keys and usage.</p>
        </div>
        <LoginForm />
      </div>
    </main>
  );
}
