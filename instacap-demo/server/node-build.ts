import path from "path";
import { createServer } from "./index";
import * as express from "express";
import { browserPool } from "./browser-pool";
import { disconnectDB } from "./db";

const app = createServer();
const port = process.env.PORT || 3000;

// In production, serve the built SPA files
const __dirname = import.meta.dirname;
const distPath = path.join(__dirname, "../spa");

// Serve static files. Vite `/assets/*` fayllari nomida content-hash bo'ladi
// (masalan weekly-hashtag-BxmK-2An.png) — mazmun o'zgarsa nom ham o'zgaradi,
// shuning uchun ularni 1 yilga "immutable" deb keshlash xavfsiz (banner kabi
// katta rasmlar carousel aylanganda "qora ekran" bo'lib qolmasligi uchun ham
// muhim — bir marta yuklangach browser keshidan darhol chiqadi). `index.html`
// esa har deploy'da yangilanishi kerak, shuning uchun keshlanmaydi.
app.use(
  express.static(distPath, {
    setHeaders: (res, filePath) => {
      if (filePath.includes(`${path.sep}assets${path.sep}`)) {
        res.setHeader("Cache-Control", "public, max-age=31536000, immutable");
      } else {
        res.setHeader("Cache-Control", "no-cache");
      }
    },
  }),
);

// Handle React Router - serve index.html for all non-API routes
app.get("{*path}", (req, res) => {
  // Don't serve index.html for API routes
  if (req.path.startsWith("/api/") || req.path.startsWith("/health")) {
    return res.status(404).json({ error: "API endpoint not found" });
  }

  res.sendFile(path.join(distPath, "index.html"));
});

app.listen(port, () => {
  console.log(`🚀 Fusion Starter server running on port ${port}`);
  console.log(`📱 Frontend: http://localhost:${port}`);
  console.log(`🔧 API: http://localhost:${port}/api`);
});

// Graceful shutdown (browser pool va MongoDB ni yopish)
process.on("SIGTERM", async () => {
  console.log("🛑 Received SIGTERM, shutting down gracefully");
  await browserPool.shutdown();
  await disconnectDB();
  process.exit(0);
});

process.on("SIGINT", async () => {
  console.log("🛑 Received SIGINT, shutting down gracefully");
  await browserPool.shutdown();
  await disconnectDB();
  process.exit(0);
});
