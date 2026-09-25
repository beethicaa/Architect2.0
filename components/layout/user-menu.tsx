"use client";

import { LayoutGrid, LogOut, Settings2, User } from "lucide-react";
import Link from "next/link";
import { usePathname } from "next/navigation";

import { signOut } from "@/lib/actions/auth";
import { initials } from "@/lib/utils";
import type { Profile } from "@/lib/supabase/types";

import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";

/**
 * The account menu in the app chrome.
 *
 * One menu, not a settings page per concern: profile, workspace settings and
 * sign-out are all "about me", and a builder tool should not make a
 * non-technical user hunt for the sign-out button. `signOut` is a Server
 * Action passed as a form action, so no session token ever reaches a handler.
 */
export function UserMenu({
  profile,
  email,
}: {
  profile: Profile | null;
  email: string | null;
}) {
  const pathname = usePathname();
  const name = profile?.full_name ?? email?.split("@")[0] ?? "You";

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button
          variant="ghost"
          size="sm"
          className="h-8 gap-2 px-1.5"
          aria-label="Account"
        >
          <Avatar className="size-6">
            {profile?.avatar_url ? (
              <AvatarImage src={profile.avatar_url} alt="" />
            ) : null}
            <AvatarFallback className="text-micro">
              {initials(name)}
            </AvatarFallback>
          </Avatar>
          <span className="hidden max-w-32 truncate text-sm sm:inline">
            {name}
          </span>
        </Button>
      </DropdownMenuTrigger>

      <DropdownMenuContent align="end" className="w-60">
        <DropdownMenuLabel className="flex flex-col gap-0.5">
          <span className="truncate text-sm font-medium">{name}</span>
          {email ? (
            <span className="truncate text-xs font-normal text-muted-foreground">
              {email}
            </span>
          ) : null}
        </DropdownMenuLabel>
        <DropdownMenuSeparator />

        <DropdownMenuItem asChild>
          <Link href="/dashboard">
            <LayoutGrid />
            Your projects
          </Link>
        </DropdownMenuItem>
        <DropdownMenuItem asChild>
          <Link href="/projects/settings">
            <Settings2 />
            Workspace settings
          </Link>
        </DropdownMenuItem>
        <DropdownMenuItem asChild>
          <Link href="/profile">
            <User />
            Profile
          </Link>
        </DropdownMenuItem>

        <DropdownMenuSeparator />
        <DropdownMenuItem asChild>
          {/* `pathname` is read so the menu item re-renders on navigation even
              though the page it links to is mocked in this assignment. */}
          <form action={signOut}>
            <button
              type="submit"
              className="flex w-full cursor-pointer items-center gap-2 text-left"
              data-path={pathname}
            >
              <LogOut />
              Sign out
            </button>
          </form>
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
