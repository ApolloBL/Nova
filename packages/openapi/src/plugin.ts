import type { Plugin } from "@novats/core";
import { generateOpenApiDocument } from "./generator.js";
import type { OpenApiOptions } from "./types.js";

const DEFAULT_JSON_PATH = "/openapi.json";
const DEFAULT_UI_PATH = "/docs";
const SWAGGER_UI_CDN_VERSION = "5";

/**
 * Mounts `GET /openapi.json` (always) and Swagger UI at `/docs`
 * (when `ui` is provided). The document is regenerated per request;
 * the endpoint is low-traffic by convention, so caching is not worth
 * the invalidation complexity.
 *
 * ```ts
 * await app.register(openapi({
 *   info: { title: "My API", version: "1.0.0" },
 *   schemaConverter: (s) => toJSONSchema(s),
 *   ui: {},
 * }));
 * ```
 */
export function openapi(options: OpenApiOptions): Plugin {
  const jsonPath = options.path ?? DEFAULT_JSON_PATH;

  return (app) => {
    app.get(jsonPath, () =>
      generateOpenApiDocument(app.routes(), options, (msg) => {
        console.warn(msg);
      }),
    );

    if (options.ui !== undefined) {
      const uiPath = options.ui.path ?? DEFAULT_UI_PATH;
      const title = options.ui.title ?? options.info.title;
      const html = renderSwaggerUiHtml(jsonPath, title);

      app.get(uiPath, (ctx) => {
        ctx.header("content-type", "text/html; charset=utf-8");
        return html;
      });
    }
  };
}

function renderSwaggerUiHtml(jsonPath: string, title: string): string {
  const safeTitle = escapeHtml(title);
  const safeJsonPath = escapeForJsString(jsonPath);

  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <title>${safeTitle}</title>
  <link rel="stylesheet" href="https://unpkg.com/swagger-ui-dist@${SWAGGER_UI_CDN_VERSION}/swagger-ui.css" />
</head>
<body>
  <div id="swagger-ui"></div>
  <script src="https://unpkg.com/swagger-ui-dist@${SWAGGER_UI_CDN_VERSION}/swagger-ui-bundle.js" crossorigin></script>
  <script>
    window.addEventListener("load", () => {
      window.ui = SwaggerUIBundle({
        url: "${safeJsonPath}",
        dom_id: "#swagger-ui",
        deepLinking: true,
        layout: "BaseLayout",
      });
    });
  </script>
</body>
</html>`;
}

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

function escapeForJsString(s: string): string {
  return s.replace(/\\/g, "\\\\").replace(/"/g, '\\"').replace(/</g, "\\u003c");
}
