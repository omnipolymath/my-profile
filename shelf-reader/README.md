# Shelf: a self-hosted novel + manga reader with typing practice

Shelf is a small web app you run on your NAS. Upload your **EPUB** novels and **CBZ/ZIP** manga, then read them in any browser on your network: phone, tablet or PC.

For novels there's also **Typing mode**: the book is shown one paragraph at a time and you type it as you read. You get live WPM and accuracy, and your reading position moves along with your typing.

- **Library:** covers, search, filter (novels / manga), sort by recently read. Upload by drag-and-drop or the Upload button.
- **Calm, clean look:** soft off-black / off-white colours, no harsh contrast. One **light/dark switch** flips between a dark background with light text and the opposite. Manga always stays on a dark background, so the switch isn't offered there.
- **Novel reader**, with all settings under the **Aa** button:
  - 8 bundled fonts, stored on your NAS (no internet needed): Literata, Lora, Merriweather, Source Serif, Atkinson Hyperlegible (made for low vision), Inter, OpenDyslexic and JetBrains Mono, or the book's own font.
  - Text size, line spacing and page width.
  - **Focus aid**, for when it's hard to keep your place:
    - *Highlight sentence* highlights the sentence you're on. Move it with ↓ / ↑ or the round buttons, or tap any sentence.
    - *Reading ruler* is a bar over the line you're reading that shades everything else. Drag it, step it a line at a time with ↓ / ↑, or tap a line.
- **Manga reader:** single page or long-strip (webtoon) mode, right-to-left or left-to-right, fit height or fit width, page slider. Tap the left or right side to turn pages, tap the middle to hide the toolbars.
- **Typing**, in the *Typing* tab:
  - **Practice (works like keybr.com):** you start with 6 letters and type short lessons of made-up but pronounceable words that use only the letters you've unlocked. Each lesson leans on your slowest letter. When every letter reaches your target speed (35 WPM by default, adjustable), the next letter unlocks. A mistake stops the cursor until you press the right key. The row of letters shows how close each one is to target.
  - **Speed tests:** 15 s, 30 s, 1 min or 2 min, using common words or passages **from your own novels, only from parts you've already reached, so there are no spoilers**.
  - **Progress:** a speed-over-time chart, personal bests, recent results, and a keyboard map of the **letters you miss most**, including which key you usually hit instead.
  - **Type the book:** press *Type* while reading and type the novel paragraph by paragraph from where you are. Your reading position moves with you. *Simple punctuation* turns curly quotes, dashes and accents into plain keys.
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

### Where your books and your place are kept

- **Books:** every upload is saved as a normal file in the library folder (`/library`), so it's on your NAS's own disks. You can browse, back up or copy those files like any others.
- **Your place in each book, typing history, unlocked letters and per-letter stats:** saved to `state.json` in the data folder (`/data`). This happens a moment after you stop scrolling or turn a page, and immediately when you lock your phone, switch apps or close the tab. Reading progress, typing progress and typing stats all live in that one file, so back it up along with your books.
  - Novels remember the exact paragraph you were on, not just a percentage, so you land in the same spot on a phone and a PC, and changing font size doesn't lose your place.
  - Manga remembers the page.
  - Your place stays with a book even if you rename the file or move it to another folder on the NAS.
- **Switching devices:** open a book on another device and it starts where you left off. If a tab is still open on the old device, you'll see *"You read further on another device. Jump there?"* when you come back to it.
- The library page has a **Continue where you left off** button for the last book you were reading.

Rebuilding or updating the container doesn't touch either folder.

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
| Novel reader with a focus aid on | ↓ / ↑ move the highlight or ruler |
| Typing a book | Esc pause · Ctrl+→ skip paragraph · Ctrl+← previous paragraph |
| Practice / speed test | Tab new lesson or test · Esc pause |

## Development

```bash
npm test   # builds a sample EPUB + CBZ and exercises the whole API
```

## Credits

The bundled fonts are under the SIL Open Font License; see `public/fonts/LICENSES.txt`. They come from the [Fontsource](https://fontsource.org) packages.
