# Deployment

Die Website wird auf GitHub Pages bereitgestellt. Der Cloudflare Worker stellt die Kalender- und Formular-API bereit.

## Einmalige Cloudflare-Einrichtung

1. In Cloudflare unter **Workers & Pages** einen API-Token anlegen: Berechtigung **Account / Workers Scripts / Edit**, auf dieses Konto beschraenkt.
2. Den Account-Identifier aus der Cloudflare-Startseite kopieren.
3. Nach dem ersten GitHub-Deployment im Worker-Verzeichnis die Worker-Secrets setzen. Dabei niemals die Werte in Git eintragen:

```sh
cd worker
npx wrangler secret put GOOGLE_CLIENT_ID
npx wrangler secret put GOOGLE_CLIENT_SECRET
npx wrangler secret put GOOGLE_OAUTH_REFRESH_TOKEN
npx wrangler secret put GOOGLE_MAILBOX_ADDRESS
npx wrangler secret put GOOGLE_CALENDAR_ID
npx wrangler secret put ALLOWED_ORIGIN
```

`ALLOWED_ORIGIN` ist die volle Website-Adresse, etwa `https://www.ankern-groemitz.de`. Die Adresse muss exakt passen und enthaelt keinen abschliessenden Schraegstrich.

## Einmalige GitHub-Einrichtung

Im Repository unter **Settings > Secrets and variables > Actions** hinterlegen:

| Typ | Name | Wert |
| --- | --- | --- |
| Secret | `CLOUDFLARE_API_TOKEN` | Cloudflare API-Token |
| Secret | `CLOUDFLARE_ACCOUNT_ID` | Cloudflare Account-ID |
| Variable | `PUBLIC_API_BASE_URL` | Worker-Adresse, zum Beispiel `https://ankern-in-groemitz-api.<konto>.workers.dev` |

Unter **Settings > Pages** als Quelle **GitHub Actions** waehlen. Nach dem ersten erfolgreichen Worker-Deployment erscheint dessen `workers.dev`-Adresse im Cloudflare-Dashboard; diese kommt als `PUBLIC_API_BASE_URL` in GitHub hinein.

Danach deployed jeder Push auf `main` zuerst den Worker und dann die Website.

## Lokal testen

Lege zuerst die nicht versionierte Datei `worker/.dev.vars` an und uebernehme dort die Google-Werte sowie diese lokale Origin:

```text
ALLOWED_ORIGIN=http://localhost:4321
```

Dann starten:

```sh
npm run dev
```

Der Browser unter `http://localhost:4321` verwendet dann den lokalen Worker. Fuer den Cloudflare-Worker oder GitHub Pages werden keine lokalen Zugangsdaten benoetigt.

## Vor dem Livegang

Die Google-Zugangsdaten liegen nur als Worker-Secrets. Da vorhandene Google-Credentials bereits lokal verwendet wurden, sollten Client-Secret und Refresh-Token im Google-Cloud-Projekt neu erstellt werden, bevor sie produktiv gesetzt werden.

Der Formular-Endpunkt ist absichtlich nur fuer die konfigurierte Website-Origin freigegeben. Vor der oeffentlichen Freigabe sollte zudem Turnstile als Spam-Schutz integriert werden.
