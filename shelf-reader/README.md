# Shelf: a self-hosted novel + manga reader with typing practice

Shelf is a small web app you run on your NAS. Upload your **EPUB** novels and **CBZ/ZIP** manga, then read them in any browser on your network: phone, tablet or PC.

For novels there's also **Typing mode**: the book is shown one paragraph at a time and you type it as you read. You get live WPM and accuracy, and your reading position moves along with your typing.

- **Library:** covers, search, filter (novels / manga), sort by recently read. Upload by drag-and-drop or the Upload button.
- **Novel reader:** chapter list, font size, dark / sepia / light themes, remembers where you stopped.
- **Manga reader:** single page or long-strip (webtoon) mode, right-to-left or left-to-right, fit height or fit width, page slider. Tap the left or right side to turn pages, tap the middle to hide the toolbars.
- **Typing practice:**
  - Starts exactly where you're reading. Typing to the end of a chapter rolls into the next one.
  - Mistakes show in red. Fix them with Backspace before the paragraph completes.
  - *Simple punctuation* (on by default) turns curly quotes, em-dashes, `…` and accents into plain keyboard keys, so you don't get stuck on characters you can't type.
  - Pauses longer than 3 seconds don't count against your WPM, so you can stop and think.
  - Lifetime stats (characters typed, average WPM, accuracy, best paragraph) appear on the library page.
- **Progress is stored on the server**, so you can start on your PC and keep going on your phone.
- No database and no npm dependencies. It's one small Node.js process.

## Install on a NAS (Docker)

Works on anything that runs Docker: Synology (Container Manager), QNAP (Container Station), Unraid, TrueNAS SCALE, OpenMediaVault, or a plain Linux box.

1. Copy the `shelf-reader` folder onto the NAS (for example `/volume1/docker/shelf-reader`).
2. Edit `docker-compose.yml`:
   - set `READER_PASSWORD` to something only you know;
   - point the `/library` volume at the folder where your books live (or keep `./library`).
3. Start it:
   ```bash
   cd /volume1/docker/shelf-reader
   docker compose up -d --build
   ```
   On Synology you can instead create a **Project** in Container Manager and point it at this folder.
4. Open `http://<your-nas-ip>:8080` and log in with user `reader` and your password.

### Settings

| Variable          | Default        | Meaning                                                      |
|-------------------|----------------|--------------------------------------------------------------|
| `READER_PASSWORD` | *(empty)*      | Turns on a login prompt. **Set this.**                       |
| `READER_USER`     | `reader`       | Login username                                               |
| `PORT`            | `8080`         | Port inside the container                                    |
| `LIBRARY_DIR`     | `/library`     | Where book files live (scanned recursively)                  |
| `DATA_DIR`        | `/data`        | Where `state.json` (progress + typing stats) is saved        |

### Organising files

You don't have to upload through the browser. Anything you copy into the library folder (over SMB, Syncthing, etc.) shows up on the next refresh. Subfolders are shown as the series name, which suits manga:

```
library/
  Novels/Mistborn.epub
  One Piece/Vol 001.cbz
  One Piece/Vol 002.cbz
```

Pages inside a CBZ are sorted naturally (`page2` comes before `page10`).

**Permissions:** if uploads fail with a permission error, uncomment `user:` in `docker-compose.yml` and set it to your NAS user's IDs. Run `id` over SSH to find them.

### Reaching it away from home

Don't forward port 8080 on your router. Use a VPN such as Tailscale or WireGuard (Synology, Unraid and TrueNAS all have Tailscale packages), or put it behind a reverse proxy with HTTPS. The built-in password is sent with every request, so only use it over HTTPS or your home network.

## Run without Docker

Needs Node.js 18 or newer:

```bash
cd shelf-reader
READER_PASSWORD=change-me LIBRARY_DIR=/path/to/books node server.js
```

## Supported formats

- `.epub` (EPUB 2 and 3, including `.kepub.epub`)
- `.cbz` / `.zip` containing JPG, PNG, WebP, GIF or AVIF images
- Not yet: `.cbr` (RAR), `.pdf`, `.mobi`/`.azw3`. Convert them first, for example with Calibre (ebooks) or by re-zipping CBR images into a CBZ.

## Keyboard shortcuts

| Where        | Keys                                              |
|--------------|---------------------------------------------------|
| Novel reader | ← / → previous / next chapter                     |
| Manga reader | ← / → turn page (follows reading direction), Space / PageDown next |
| Typing       | Esc pause · Ctrl+→ skip paragraph · Ctrl+← previous paragraph |

## Development

```bash
npm test   # builds a sample EPUB + CBZ and exercises the whole API
```
