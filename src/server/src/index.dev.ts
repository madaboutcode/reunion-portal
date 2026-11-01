import { createApp } from "./app.js";
import { debugRoutes } from "./routes/debug.routes.js";

const app = createApp();
app.route("/debug", debugRoutes);

export default app;
