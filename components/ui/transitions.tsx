import { ViewTransition } from "react";

// Navigation types. Going deeper (group → assessment) slides forward; breadcrumbs slide back.
// Without a type (top nav, browser back) the page just fades.
export const FORWARD = ["nav-forward"];
export const BACK = ["nav-back"];

const NAV = { "nav-forward": "nav-forward", "nav-back": "nav-back", default: "page-fade" };

// Switching tabs within a page: slides toward the side of the chosen tab.
export const TAB_SLIDE = { "tab-forward": "tab-forward", "tab-back": "tab-back", default: "none" };

// Goes in each page.tsx, not in the layout: layouts persist and never enter or exit.
export function PageTransition({ children }: { children: React.ReactNode }) {
  return (
    <ViewTransition enter={NAV} exit={NAV} default="none">
      {children}
    </ViewTransition>
  );
}
