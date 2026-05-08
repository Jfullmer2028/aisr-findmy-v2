import { Link, useRouter } from "@tanstack/react-router";
import { useState } from "react";
import { useAuth } from "@/lib/auth-context";
import { Button } from "@/components/ui/button";
import { toast } from "sonner";
import { Menu, X } from "lucide-react";
import seal from "@/assets/aisr-seal.svg";
import { supabase } from "@/lib/supabase";

export function Navbar() {
  const { session, profile, isAdmin, signOut } = useAuth();
  const router = useRouter();
  const [open, setOpen] = useState(false);

  const handleLogin = async () => {
    try {
      // Determine the correct redirect URL
      const isLocal = window.location.hostname === "localhost";
      const redirectUrl = isLocal
        ? "http://localhost:3000/auth/callback"    // hardcoded for local dev
        : `${window.location.origin}/auth/callback`; // dynamic for production

      console.log("Redirecting to:", redirectUrl); // debug

      const { error } = await supabase.auth.signInWithOAuth({
        provider: "google",
        options: {
          redirectTo: redirectUrl,
          queryParams: {
            hd: "aisr.org",
            prompt: "select_account",
          },
        },
      });
      if (error) throw error;
    } catch (e) {
      toast.error("Sign-in failed: " + (e instanceof Error ? e.message : "unknown"));
    }
  };

  const navLink = "px-3 py-2 rounded-md text-sm font-medium hover:bg-white/10 hover:text-secondary transition-colors";

  return (
    <header className="sticky top-0 z-40 border-b border-white/10 bg-primary text-primary-foreground shadow-md">
      <div className="mx-auto flex max-w-6xl items-center justify-between px-4 py-3">
        <Link to="/" className="flex items-center gap-2 font-semibold">
          <img src={seal} alt="AIS-R" className="h-9 w-9 drop-shadow" />
          <span className="hidden sm:inline">AIS-R Lost &amp; Found</span>
          <span className="sm:hidden">L&amp;F</span>
        </Link>

        <nav className="hidden md:flex items-center gap-1 text-sm">
          <Link to="/" className={navLink}>Search</Link>
          {session && <Link to="/report" className={navLink}>Report</Link>}
          {session && <Link to="/dashboard" className={navLink}>Dashboard</Link>}
          {isAdmin && <Link to="/admin" className={navLink}>Admin</Link>}
          {session ? (
            <Button variant="secondary" size="sm" className="ml-2 rounded-full"
              onClick={async () => { await signOut(); router.navigate({ to: "/" }); }}>
              {profile?.email?.split("@")[0]} • Sign out
            </Button>
          ) : (
            <Button variant="secondary" size="sm" className="ml-2 rounded-full font-semibold" onClick={handleLogin}>
              Sign in with Google
            </Button>
          )}
        </nav>

        <button className="md:hidden p-2" onClick={() => setOpen(!open)} aria-label="Menu">
          {open ? <X className="h-5 w-5" /> : <Menu className="h-5 w-5" />}
        </button>
      </div>

      {open && (
        <div className="md:hidden border-t border-white/10 px-4 py-3 flex flex-col gap-1">
          <Link to="/" className={navLink} onClick={() => setOpen(false)}>Search</Link>
          {session && <Link to="/report" className={navLink} onClick={() => setOpen(false)}>Report</Link>}
          {session && <Link to="/dashboard" className={navLink} onClick={() => setOpen(false)}>Dashboard</Link>}
          {isAdmin && <Link to="/admin" className={navLink} onClick={() => setOpen(false)}>Admin</Link>}
          <div className="pt-2">
            {session ? (
              <Button variant="secondary" size="sm" className="w-full rounded-full"
                onClick={async () => { await signOut(); setOpen(false); router.navigate({ to: "/" }); }}>
                Sign out
              </Button>
            ) : (
              <Button variant="secondary" size="sm" className="w-full rounded-full font-semibold" onClick={handleLogin}>
                Sign in with Google
              </Button>
            )}
          </div>
        </div>
      )}
    </header>
  );
}