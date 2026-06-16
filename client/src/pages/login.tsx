import { useState } from "react";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import { useMutation } from "@tanstack/react-query";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Button } from "@/components/ui/button";
import { OrnamentalDivider } from "@/components/ornamental-divider";
import { useToast } from "@/hooks/use-toast";
import { queryClient } from "@/lib/queryClient";
import { loginUser } from "@/lib/api";
import { Loader2, Lock } from "lucide-react";

const loginSchema = z.object({
  username: z.string().min(1, "Username is required"),
  password: z.string().min(1, "Password is required"),
});

type LoginValues = z.infer<typeof loginSchema>;

function RaniwalaLogo() {
  return (
    <div className="flex flex-col items-center leading-none select-none">
      <span className="font-serif text-2xl font-semibold tracking-[0.25em] text-primary uppercase">
        Raniwala
      </span>
      <div className="flex items-center gap-2 w-full mt-1">
        <div className="h-px flex-1 bg-primary/40" />
        <span className="font-serif text-xs font-light tracking-[0.3em] text-primary/80">
          1881
        </span>
        <div className="h-px flex-1 bg-primary/40" />
      </div>
    </div>
  );
}

export default function Login() {
  const { toast } = useToast();
  const [submitting, setSubmitting] = useState(false);

  const {
    register,
    handleSubmit,
    formState: { errors },
  } = useForm<LoginValues>({
    resolver: zodResolver(loginSchema),
    defaultValues: { username: "", password: "" },
  });

  const loginMutation = useMutation({
    mutationFn: (values: LoginValues) => loginUser(values.username, values.password),
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: ["/api/auth/me"] });
    },
    onError: (error: unknown) => {
      toast({
        title: "Sign in failed",
        description: error instanceof Error ? error.message : "Invalid username or password",
        variant: "destructive",
      });
    },
  });

  const onSubmit = async (values: LoginValues) => {
    setSubmitting(true);
    try {
      await loginMutation.mutateAsync(values);
    } finally {
      setSubmitting(false);
    }
  };

  const isLoading = submitting || loginMutation.isPending;

  return (
    <div className="min-h-screen flex flex-col items-center justify-center font-sans bg-background text-foreground relative overflow-hidden px-4">
      {/* Decorative background elements */}
      <div className="fixed -top-[20%] -right-[10%] w-[50vw] h-[50vw] bg-primary/10 rounded-full blur-[100px] pointer-events-none" />
      <div className="fixed top-[40%] -left-[10%] w-[30vw] h-[30vw] bg-secondary/20 rounded-full blur-[80px] pointer-events-none" />

      <Card className="w-full max-w-md relative z-10 border-primary/15 bg-background/80 backdrop-blur-sm shadow-lg">
        <CardContent className="p-8">
          <div className="flex flex-col items-center">
            <RaniwalaLogo />
            <OrnamentalDivider />
            <p className="font-serif text-sm text-muted-foreground tracking-wide text-center -mt-2">
              Design Brain — sign in to continue
            </p>
          </div>

          <form onSubmit={handleSubmit(onSubmit)} className="mt-8 space-y-5">
            <div className="space-y-2">
              <Label htmlFor="username">Username</Label>
              <Input
                id="username"
                type="text"
                autoComplete="username"
                autoFocus
                data-testid="login-username"
                {...register("username")}
              />
              {errors.username && (
                <p className="text-sm text-destructive">{errors.username.message}</p>
              )}
            </div>

            <div className="space-y-2">
              <Label htmlFor="password">Password</Label>
              <Input
                id="password"
                type="password"
                autoComplete="current-password"
                data-testid="login-password"
                {...register("password")}
              />
              {errors.password && (
                <p className="text-sm text-destructive">{errors.password.message}</p>
              )}
            </div>

            <Button
              type="submit"
              className="w-full"
              disabled={isLoading}
              data-testid="login-submit"
            >
              {isLoading ? (
                <>
                  <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                  Signing in…
                </>
              ) : (
                <>
                  <Lock className="mr-2 h-4 w-4" />
                  Sign in
                </>
              )}
            </Button>
          </form>
        </CardContent>
      </Card>

      <p className="font-serif text-xs text-muted-foreground/60 italic mt-6 tracking-wide relative z-10">
        Design to Inspire, Legacy to Celebrate
      </p>
    </div>
  );
}
