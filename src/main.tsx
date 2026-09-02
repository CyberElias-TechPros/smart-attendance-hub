import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { RouterProvider, createRouter } from "@tanstack/react-router";
import { StrictMode } from "react";
import { createRoot } from "react-dom/client";

import { ApiClientError } from "./lib/api";
import { AuthProvider } from "./lib/auth";
import { routeTree } from "./routeTree.gen";
import "./styles.css";

const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      staleTime: 30_000,
      refetchOnWindowFocus: false,
      retry: (failureCount, error) => {
        // Never retry a request the server deliberately rejected — retrying a
        // 401/403/404/409 just delays the error the user needs to see.
        if (error instanceof ApiClientError) {
          if (error.code === "NETWORK_ERROR") return failureCount < 2;
          if (error.status && error.status < 500) return false;
        }
        return failureCount < 1;
      },
    },
    mutations: { retry: false },
  },
});

const router = createRouter({
  routeTree,
  context: { queryClient, auth: undefined! },
  defaultPreload: "intent",
  defaultPreloadStaleTime: 0,
  scrollRestoration: true,
});

declare module "@tanstack/react-router" {
  interface Register {
    router: typeof router;
  }
}

const rootElement = document.getElementById("root");
if (!rootElement) throw new Error("Root element #root is missing from index.html");

createRoot(rootElement).render(
  <StrictMode>
    <QueryClientProvider client={queryClient}>
      <AuthProvider router={router} />
    </QueryClientProvider>
  </StrictMode>,
);

export { router, queryClient, RouterProvider };
