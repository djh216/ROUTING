import express from "express";
import path from "path";
import { createServer as createViteServer } from "vite";
import { app } from "./server/index.js";
import { probeGoogleMapsAvailability } from "./server/routing/google-maps-status.js";

const PORT = 3000;

async function startServer() {
  // Vite middleware for development
  if (process.env.NODE_ENV !== "production") {
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: "spa",
    });
    app.use(vite.middlewares);
  } else {
    const distPath = path.join(process.cwd(), "dist");
    app.use(express.static(distPath));
    app.get("*", (_req, res) => {
      res.sendFile(path.join(distPath, "index.html"));
    });
  }

  app.listen(PORT, "0.0.0.0", () => {
    console.log(`Server running on http://localhost:${PORT}`);
    if (!process.env.GOOGLE_MAPS_API_KEY) {
      console.info("GOOGLE_MAPS_API_KEY not set — using straight-line drive time and map routes");
    } else {
      void probeGoogleMapsAvailability();
    }
  });
}

startServer();
