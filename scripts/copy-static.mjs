import { copyFile, mkdir } from "node:fs/promises";
await mkdir("dist", { recursive: true });
await copyFile("index.html", "dist/index.html");
await copyFile("src/styles.css", "dist/styles.css");
await copyFile("src/crack-ui.css", "dist/crack-ui.css");
await copyFile("src/utility-ui.css", "dist/utility-ui.css");
