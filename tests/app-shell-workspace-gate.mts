import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { mock } from "node:test";
import type { WorkspaceStatus } from "../src/lib/workspace-status.ts";

let pass = 0;
let fail = 0;

function ok(name: string, condition: boolean) {
  if (condition) pass++;
  else {
    fail++;
    console.log("FAIL:", name);
  }
}

const moduleUrl = (path: string) => new URL(`../${path}`, import.meta.url).href;
let pathname = "/";
let workspaceStatus: WorkspaceStatus = {
  phase: "unavailable",
  mode: "live",
  dependency: "state",
  message: "Workspace data is temporarily unavailable.",
};

mock.module("next/navigation", {
  namedExports: {
    usePathname: () => pathname,
  },
});
mock.module(moduleUrl("src/lib/store.ts"), {
  namedExports: {
    useHermes: () => ({
      workspaceStatus,
      retryWorkspace: async () => undefined,
      retrySave: async () => undefined,
    }),
  },
});
mock.module(moduleUrl("src/components/app/sidebar.tsx"), {
  namedExports: { Sidebar: () => React.createElement("aside", { "data-testid": "sidebar" }) },
});
mock.module(moduleUrl("src/components/app/topbar.tsx"), {
  namedExports: { TopBar: () => React.createElement("header", { "data-testid": "topbar" }) },
});
mock.module(moduleUrl("src/components/app/onboarding.tsx"), {
  namedExports: { Onboarding: () => React.createElement("div", { "data-testid": "onboarding" }) },
});

const { AppShell } = await import("../src/components/app/app-shell.tsx");
const child = React.createElement("div", { "data-testid": "product-child" }, "Private product");

let html = renderToStaticMarkup(React.createElement(AppShell, null, child));
ok("unavailable workspace hides protected product children", !html.includes("product-child"));
ok("unavailable workspace hides desktop navigation", !html.includes("sidebar"));
ok("unavailable workspace hides mobile navigation", !html.includes("Primary mobile"));
ok("unavailable workspace exposes an alert", html.includes('role="alert"'));
ok("unavailable workspace exposes Retry", html.includes("Retry"));
ok("unavailable workspace exposes Sign out", html.includes("/auth/signout"));

workspaceStatus = { phase: "loading", mode: "live" };
html = renderToStaticMarkup(React.createElement(AppShell, null, child));
ok("loading workspace hides protected product children", !html.includes("product-child"));
ok("loading workspace announces progress without exposing actions", html.includes('role="status"'));
ok(
  "loading workspace paints shell chrome (no full-page Connecting gate)",
  html.includes("sidebar") && html.includes("topbar") && html.includes("Refreshing workspace"),
);
workspaceStatus = { phase: "unsaved", mode: "live", message: "Changes are not saved." };
html = renderToStaticMarkup(React.createElement(AppShell, null, child));
ok("unsaved workspace hides protected product children", !html.includes("product-child"));
ok("unsaved workspace offers an explicit save retry", html.includes("Retry saving"));

workspaceStatus = { phase: "signed_out", mode: "live" };
html = renderToStaticMarkup(React.createElement(AppShell, null, child));
ok("confirmed sign-out hides protected product children", !html.includes("product-child"));
ok("confirmed sign-out offers a sign-in path without an empty workspace", html.includes("/login"));

workspaceStatus = { phase: "ready", mode: "live" };
html = renderToStaticMarkup(React.createElement(AppShell, null, child));
ok("ready live workspace renders protected product children", html.includes("product-child"));
ok("ready live workspace renders navigation", html.includes("sidebar") && html.includes("Primary mobile"));

workspaceStatus = { phase: "ready", mode: "demo" };
html = renderToStaticMarkup(React.createElement(AppShell, null, child));
ok("explicit ready demo mode remains separate and usable", html.includes("product-child"));

pathname = "/careers/public-role";
workspaceStatus = { phase: "unavailable", mode: "live", dependency: "state", message: "Unavailable" };
html = renderToStaticMarkup(React.createElement(AppShell, null, child));
ok("public careers path remains independent from recruiter workspace availability", html.includes("product-child"));

console.log(`RESULT app-shell-workspace-gate: ${pass} passed, ${fail} failed`);
if (fail > 0) process.exitCode = 1;
