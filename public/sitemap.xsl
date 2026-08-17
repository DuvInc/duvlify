<?xml version="1.0" encoding="UTF-8"?>
<!--
  Makes /sitemap.xml readable when a human opens it, without changing a byte of
  what a crawler receives — the stylesheet is only applied by browsers. Useful
  far more often than it sounds: "is that page actually in the sitemap?" is a
  question that gets asked during every migration.
-->
<xsl:stylesheet version="1.0"
                xmlns:xsl="http://www.w3.org/1999/XSL/Transform"
                xmlns:sitemap="http://www.sitemaps.org/schemas/sitemap/0.9">
  <xsl:output method="html" encoding="UTF-8" indent="yes"/>

  <xsl:template match="/">
    <html lang="en">
      <head>
        <meta charset="utf-8"/>
        <meta name="viewport" content="width=device-width, initial-scale=1"/>
        <meta name="robots" content="noindex"/>
        <title>XML sitemap — Duvlify documentation</title>
        <style>
          :root { color-scheme: light dark; --bg:#fff; --fg:#111; --muted:#6b6b6b; --line:#ececec; --accent:#00875c }
          @media (prefers-color-scheme: dark) {
            :root { --bg:#0a0a0a; --fg:#f5f5f5; --muted:#a3a3a3; --line:#262626; --accent:#34d399 }
          }
          * { box-sizing: border-box }
          body {
            margin: 0; padding: 56px 24px; background: var(--bg); color: var(--fg);
            font: 15px/1.6 ui-sans-serif, system-ui, -apple-system, "Segoe UI", sans-serif;
          }
          main { max-width: 940px; margin: 0 auto }
          h1 { font-size: 28px; font-weight: 650; margin: 0 0 6px }
          p.lede { margin: 0 0 32px; color: var(--muted) }
          table { width: 100%; border-collapse: collapse; font-size: 14px }
          th {
            text-align: left; padding: 10px 12px; border-bottom: 1px solid var(--line);
            font-size: 11px; letter-spacing: .09em; text-transform: uppercase; color: var(--muted);
          }
          td { padding: 11px 12px; border-bottom: 1px solid var(--line); vertical-align: top }
          tr:hover td { background: color-mix(in oklab, currentColor 4%, transparent) }
          a { color: var(--accent); text-decoration: none }
          a:hover { text-decoration: underline }
          td.n { color: var(--muted); width: 46px; font-variant-numeric: tabular-nums }
          td.d { color: var(--muted); white-space: nowrap; font-variant-numeric: tabular-nums }
        </style>
      </head>
      <body>
        <main>
          <h1>XML sitemap</h1>
          <p class="lede">
            <xsl:value-of select="count(sitemap:urlset/sitemap:url)"/>
            <xsl:text> pages. This is the file submitted to search engines; </xsl:text>
            <a href="/llms.txt">llms.txt</a>
            <xsl:text> is the equivalent for assistants.</xsl:text>
          </p>
          <table>
            <tr><th>#</th><th>URL</th><th>Last modified</th></tr>
            <xsl:for-each select="sitemap:urlset/sitemap:url">
              <tr>
                <td class="n"><xsl:value-of select="position()"/></td>
                <td>
                  <a href="{sitemap:loc}"><xsl:value-of select="sitemap:loc"/></a>
                </td>
                <td class="d"><xsl:value-of select="substring(sitemap:lastmod, 1, 10)"/></td>
              </tr>
            </xsl:for-each>
          </table>
        </main>
      </body>
    </html>
  </xsl:template>
</xsl:stylesheet>
