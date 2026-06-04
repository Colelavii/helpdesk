import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import { useNavigate } from "react-router-dom";
import { signIn } from "../lib/auth-client";

const loginSchema = z.object({
  email: z.email("Enter a valid email address"),
  password: z.string().min(1, "Password is required"),
});

type LoginValues = z.infer<typeof loginSchema>;

export default function LoginPage() {
  const navigate = useNavigate();
  const {
    register,
    handleSubmit,
    setError,
    formState: { errors, isSubmitting },
  } = useForm<LoginValues>({
    resolver: zodResolver(loginSchema),
    defaultValues: { email: "", password: "" },
  });

  async function onSubmit(values: LoginValues) {
    const { error } = await signIn.email(values);
    if (error) {
      setError("root", {
        message: error.message ?? "Unable to sign in. Check your credentials.",
      });
      return;
    }
    navigate("/", { replace: true });
  }

  return (
    <div className="flex min-h-screen items-center justify-center bg-gray-50 px-4">
      <form
        onSubmit={handleSubmit(onSubmit)}
        noValidate
        className="w-full max-w-sm space-y-5 rounded-xl border border-gray-200 bg-white p-8 shadow-sm"
      >
        <div>
          <h1 className="text-xl font-semibold text-gray-900">Sign in</h1>
          <p className="mt-1 text-sm text-gray-500">Helpdesk staff access</p>
        </div>

        <div className="space-y-1">
          <label
            htmlFor="email"
            className="block text-sm font-medium text-gray-700"
          >
            Email
          </label>
          <input
            id="email"
            type="email"
            autoComplete="email"
            {...register("email")}
            className={`w-full rounded-md border px-3 py-2 text-sm focus:outline-none focus:ring-1 ${
              errors.email
                ? "border-red-500 focus:border-red-500 focus:ring-red-500"
                : "border-gray-300 focus:border-blue-500 focus:ring-blue-500"
            }`}
          />
          {errors.email && (
            <p className="text-sm text-red-600">{errors.email.message}</p>
          )}
        </div>

        <div className="space-y-1">
          <label
            htmlFor="password"
            className="block text-sm font-medium text-gray-700"
          >
            Password
          </label>
          <input
            id="password"
            type="password"
            autoComplete="current-password"
            {...register("password")}
            className={`w-full rounded-md border px-3 py-2 text-sm focus:outline-none focus:ring-1 ${
              errors.password
                ? "border-red-500 focus:border-red-500 focus:ring-red-500"
                : "border-gray-300 focus:border-blue-500 focus:ring-blue-500"
            }`}
          />
          {errors.password && (
            <p className="text-sm text-red-600">{errors.password.message}</p>
          )}
        </div>

        {errors.root && (
          <p role="alert" className="text-sm text-red-600">
            {errors.root.message}
          </p>
        )}

        <button
          type="submit"
          disabled={isSubmitting}
          className="w-full rounded-md bg-blue-600 px-3 py-2 text-sm font-medium text-white hover:bg-blue-700 focus:outline-none focus:ring-2 focus:ring-blue-500 focus:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-60"
        >
          {isSubmitting ? "Signing in…" : "Sign in"}
        </button>
      </form>
    </div>
  );
}
