import type { ReactNode } from "react";
import "../styles.css";

export const appName = "copy-paste-detector";

export function Layout({
  title,
  description,
  children,
}: {
  title?: string;
  description?: string;
  children: ReactNode;
}) {
  const heading = title ? `${title} · ${appName}` : appName;

  return (
    <html lang="en">
      <head>
        <meta charSet="utf-8" />
        <meta name="viewport" content="width=device-width, initial-scale=1" />
        <title>{heading}</title>
        {description && <meta name="description" content={description} />}
        <link rel="icon" href="/favicon.svg" type="image/svg+xml" />
      </head>
      <body>
        <header>
          <nav>
            <a href="/" className="brand">
              <strong>{appName}</strong>
            </a>
            <a href="https://www.rshono.com">built with rshono</a>
          </nav>
        </header>
        <main>{children}</main>
        <footer>
          <p>
            A signal, not a verdict. It records how text entered a field — it
            cannot tell you who wrote it.
          </p>
        </footer>
      </body>
    </html>
  );
}
