import { join } from "node:path";
import { createApi } from "./server/api";
import { outputDirFrom } from "./server/config";
import index from "./index.html";

const port = Number(process.env.PORT ?? 3000);
const outputDir = outputDirFrom(process.env, join(import.meta.dir, "output"));
const api = createApi({ outputDir });

const server = Bun.serve({
  hostname: "127.0.0.1", // local tool: never exposed to the network
  port,
  idleTimeout: 255,
  maxRequestBodySize: 64 * 1024 ** 3, // uploaded GeoJSON is streamed, not buffered; Bun's 128 MB default would reject big files
  routes: {
    "/": index,
    "/api/info": () => api.info(),
    "/api/files": () => api.files().catch((error) => api.fail(error, 500)),
    "/api/files/:name": {
      GET: (request) => api.file(request.params.name, new URL(request.url).searchParams.has("download")),
      DELETE: (request) => api.remove(request.params.name),
    },
    "/api/preview/:name": (request) => api.preview(request.params.name),
    "/api/estimate": { POST: (request) => api.estimate(request) },
    "/api/validate": { POST: (request) => api.validate(request) },
    "/api/validate-upload": { POST: (request) => api.validateUpload(request) },
    "/api/download": { POST: (request) => api.download(request) },
  },
  fetch: () => new Response("Not found", { status: 404 }),
});

console.log(`bun-gis UI: ${server.url}\nSaving downloads in ${outputDir}`);
