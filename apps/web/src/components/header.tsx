/**
 * @file header.tsx
 * @description Main application header providing global navigation and user profile access.
 */

import * as React from "react";
import { Link, useLocation, useNavigate } from "react-router-dom";
import {
  BadgeCheck,
  Bell,
  CreditCard,
  GalleryVerticalEnd,
  LogOut,
  Settings2,
  Sparkles,
  SquareTerminal,
  Database,
  LayoutDashboard,
} from "lucide-react";

import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { ModeToggle } from "./mode-toggle";
import { cn } from "@/lib/utils";
import { buttonVariants } from "@/components/ui/button";
import { useAuth, IS_AUTH_DISABLED } from "@/hooks/use-auth";

import { userApi, resolveUrl, authApi } from "@/lib/api-client";

// Sample data from app-sidebar.tsx
const data = {
  // User data removed, using useAuth hook

  navMain: [
    {
      title: "Home",
      url: "/",
      icon: LayoutDashboard,
    },
    {
      title: "Connections",
      url: "/connections",
      icon: Database,
    },
    {
      title: "SQL Lab",
      url: "/sqllab",
      icon: SquareTerminal,
    },
    {
      title: "Settings",
      url: "/settings",
      icon: Settings2,
    },
  ],
};

export function Header() {
  // Use destructured state for better control and access to actions
  const { user, logout, setUser } = useAuth();
  const location = useLocation();
  const navigate = useNavigate();
  const pathname = location.pathname;
  const isAuthPage = pathname?.startsWith("/auth");
  const [mounted, setMounted] = React.useState(false);

  React.useEffect(() => {
    setMounted(true);
  }, []);

  // Hydrate user if user is missing
  React.useEffect(() => {
    if (!user) {
      userApi
        .getMe()
        .then((userData) => {
          setUser(userData);
        })
        .catch((error) => {
          // Ignore 401 errors during initial hydration
          if (error.message !== "Unauthorized") {
            console.error("Failed to fetch user profile:", error);
          }
        });
    }
  }, [user, setUser]);

  if (isAuthPage) {
    return null;
  }

  return (
    <header className="sticky top-0 z-50 w-full border-b bg-background/95 backdrop-blur supports-backdrop-filter:bg-background/60">
      <div className="flex h-14 items-center px-4 gap-4">
        <Link to="/" className="flex items-center gap-2 hover:opacity-80 transition-opacity">
          <img src="/logo.png" alt="QurioDB" className="size-8 object-contain" loading="lazy" />
          <div className="flex flex-col">
            <span className="truncate font-semibold">QurioDB</span>
          </div>
        </Link>

        <div className="w-px h-6 bg-border mx-2" />

        {/* Main Navigation */}
        <nav className="flex min-w-0 items-center gap-4 overflow-x-auto whitespace-nowrap text-sm font-medium">
          {data.navMain.map((item) => (
            <Link
              key={item.url}
              to={item.url}
              className={cn(
                "transition-colors hover:text-foreground/80",
                pathname === item.url || pathname?.startsWith(item.url + "/")
                  ? "text-foreground"
                  : "text-foreground/60",
              )}
            >
              {item.title}
            </Link>
          ))}
        </nav>

        <div className="ml-auto flex items-center gap-2">
          <ModeToggle />

          {/* User Profile - Hidden completely in Disable Auth mode */}
          {!IS_AUTH_DISABLED && mounted && (
            user ? (
              <DropdownMenu>
                <DropdownMenuTrigger
                  className={cn(
                    buttonVariants({ variant: "ghost" }),
                    "relative h-8 w-8 rounded-full",
                  )}
                >
                  <Avatar className="h-8 w-8">
                    {user.avatarUrl && <AvatarImage src={resolveUrl(user.avatarUrl)} alt={user.name || ""} />}
                    <AvatarFallback className="bg-primary/10 text-primary">
                      {user.name && user.name.trim().length > 0
                        ? user.name
                            .split(" ")
                            .map((n) => n[0])
                            .join("")
                            .toUpperCase()
                            .slice(0, 2)
                        : (user.email || "U").substring(0, 2).toUpperCase()}
                    </AvatarFallback>
                  </Avatar>
                </DropdownMenuTrigger>
                <DropdownMenuContent className="w-56" align="end">
                  <DropdownMenuGroup>
                    <DropdownMenuLabel 
                      className="font-normal cursor-pointer hover:bg-muted/50 transition-colors rounded-sm" 
                      onClick={() => navigate("/settings?tab=account")}
                    >
                      <div className="flex items-center gap-2 text-sm">
                        <Avatar className="h-8 w-8">
                          {user.avatarUrl && <AvatarImage src={resolveUrl(user.avatarUrl)} alt={user.name || ""} />}
                          <AvatarFallback>
                            {user.name && user.name.trim().length > 0
                              ? user.name
                                  .split(" ")
                                  .map((n) => n[0])
                                  .join("")
                                  .toUpperCase()
                                  .slice(0, 2)
                              : (user.email || "U")
                                  .substring(0, 2)
                                  .toUpperCase()}
                          </AvatarFallback>
                        </Avatar>
                        <div className="flex flex-col space-y-1">
                          <p className="text-sm font-medium leading-none">
                            {user.name || "User"}
                          </p>
                          <p className="text-xs leading-none text-muted-foreground">
                            {user.email}
                          </p>
                        </div>
                      </div>
                    </DropdownMenuLabel>
                  </DropdownMenuGroup>
                  <DropdownMenuSeparator />
                  <DropdownMenuGroup>
                    <DropdownMenuItem onClick={() => navigate("/settings?tab=account")}>
                      <BadgeCheck className="mr-2 h-4 w-4" />
                      Account
                    </DropdownMenuItem>
                    <DropdownMenuItem>
                      <Bell className="mr-2 h-4 w-4" />
                      Notifications
                    </DropdownMenuItem>
                  </DropdownMenuGroup>
                  <DropdownMenuSeparator />
                  <DropdownMenuItem
                    onClick={async () => {
                      try {
                        await authApi.logout();
                      } catch (error) {
                        console.error("Failed to logout:", error);
                      } finally {
                        logout();
                        navigate("/auth/login");
                      }
                    }}
                  >
                    <LogOut className="mr-2 h-4 w-4" />
                    Log out
                  </DropdownMenuItem>
                </DropdownMenuContent>
              </DropdownMenu>
            ) : (
              <div className="h-8 w-8 rounded-full bg-muted animate-pulse" />
            )
          )}
          {!IS_AUTH_DISABLED && mounted && !user && (
            <Link
              to="/auth/login"
              className={buttonVariants({ variant: "default", size: "sm" })}
            >
              Sign In
            </Link>
          )}

        </div>
      </div>
    </header>
  );
}
