# Aspire TSS SCORM Player

A web player for Aspire TSS that imports SCORM 1.2 and SCORM 2004 packages, plays them, and tracks learner progress. It runs on the [scorm-again](src/) runtime.

## Run it

Requires Node 20 or later.

```bash
npm ci
npm run build
npm run player
```

Open http://localhost:4173. Set `PLAYER_PORT` to use a different port.

## Run with Docker

```bash
docker compose up --build
```

Open http://localhost:4173. Courses and progress are kept in the `player-data` volume, so they survive restarts and rebuilds.

## What it does

1. **Upload.** Drop a SCORM ZIP onto the library. The page shows upload progress, then unpacking progress.
2. **Validate.** The player reads `imsmanifest.xml` at the ZIP root, detects the SCORM version, and lists the launchable lessons.
3. **Play.** Lessons open in a frame on the same origin, so the content finds `window.API` (SCORM 1.2) or `window.API_1484_11` (SCORM 2004).
4. **Track.** Each commit is saved, and the course card shows status, progress, score, and time.

## Upload checks

There is no limit on ZIP size, file count, or unpacked size. Uploads stream to disk and unpack one file at a time. An import is rejected if:

- `imsmanifest.xml` is missing from the ZIP root, or the manifest has no launchable lessons
- an entry uses an absolute path, a `..` segment, or control characters
- an entry larger than 10 MB expands to more than 100 times its compressed size, which indicates a ZIP bomb
- the file is not a valid ZIP or contains encrypted entries

A failed import leaves nothing behind. Missing referenced files and SCORM 2004 sequencing rules produce warnings rather than errors.

## What it records

For each lesson the player stores completion, success, score, total time, and the resume point (location and suspend data). Session time is added to total time when the lesson terminates. Reopening a lesson resumes where the learner left off.

## Data

Everything lives in `player/data/` (`/app/player/data` in the container):

- `catalog.json` for courses and attempts
- `content/<course-id>/` for unpacked packages
- `uploads/` for ZIPs while they are being imported

Delete `player/data/` to start fresh. The built-in sample course is restored on the next start.

## Trust

Uploaded packages run on the player's own origin and can call its API. Upload only content you trust.

## More

- [Aspire TSS project overview](docs/aspire/Aspire_TSS_SCORM_Project_Overview.docx)
- Player tests: `npx vitest run test/player`

## License

[MIT](LICENSE)
