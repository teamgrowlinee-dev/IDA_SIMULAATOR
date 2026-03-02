import cors from "cors";
import express from "express";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { env } from "./config/env.js";
import chatRoutes from "./routes/chat.js";
import storefrontRoutes from "./routes/storefront.js";
import bundleRoutes from "./routes/bundle.js";
import simulatorRoutes from "./routes/simulator.js";

const app = express();
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

app.use(cors());
app.use(express.json({ limit: "1mb" }));

app.get("/health", (_req, res) => {
  res.json({ ok: true });
});

app.use("/api", chatRoutes);
app.use("/api", storefrontRoutes);
app.use("/api", bundleRoutes);
app.use("/api", simulatorRoutes);
app.use("/proxy/api", chatRoutes);
app.use("/proxy/api", storefrontRoutes);
app.use("/proxy/api", bundleRoutes);
app.use("/proxy/api", simulatorRoutes);

const publicDir = path.resolve(__dirname, "../public");
app.use("/simulator-assets", express.static(path.join(publicDir, "simulator"), { maxAge: "1h" }));

app.get("/room", (_req, res) => {
  res.sendFile(path.join(publicDir, "simulator", "room.html"));
});

app.get("/simulator", (_req, res) => {
  res.sendFile(path.join(publicDir, "simulator", "simulator.html"));
});

const widgetDist = path.resolve(__dirname, "../../packages/widget/dist");
app.use("/widget", express.static(widgetDist, { maxAge: "1h" }));

app.get("/widget/embed.js", (_req, res) => {
  res.sendFile(path.join(widgetDist, "chat-widget.iife.js"));
});

// Standalone loader - client adds: <script src="https://SERVER/widget/loader.js" defer></script>
app.get("/widget/loader.js", (req, res) => {
  const protocol = req.headers["x-forwarded-proto"] || req.protocol;
  const host = req.headers["x-forwarded-host"] || req.headers.host;
  const origin = `${protocol}://${host}`;

  res.type("application/javascript");
  res.set("Cache-Control", "no-cache");
  res.send(`(function(){
  var origin="${origin}";
  window.__idastuudioWidgetConfig={apiBase:origin,brandName:"IDA SISUSTUSPOOD & STUUDIO",storeOrigin:"${env.STORE_BASE_URL}"};
  var s=document.createElement("script");
  s.src=origin+"/widget/embed.js?v="+Date.now();
  s.defer=true;
  s.dataset.idaChatWidget="1";
  document.head.appendChild(s);
})();`);
});

app.get("/test", (_req, res) => {
  res.send(`<!DOCTYPE html>
<html><head><title>IDA Widget Test</title></head>
<body style="margin:0;min-height:100vh;background:#f5f5f5;">
  <h1 style="padding:20px;">IDA Chat Widget Test</h1>
  <p style="padding:0 20px;">Kui widget töötab, näed paremas alumises nurgas vestlusnuppu.</p>
  <script src="/widget/loader.js" defer></script>
</body></html>`);
});

app.listen(env.PORT, () => {
  console.log(`IDA chatbot app running on http://localhost:${env.PORT}`);
});
