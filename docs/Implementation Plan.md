# iCal Calendar Sync for FRC Events

Create a Cloudflare Worker that fetches the FRC calendar page, parses it to extract events relevant to the FIRST Robotics Competition (FRC), converts them into a valid iCalendar (.ics) format, and serves the feed. This allows Google Calendar (or any other calendar client) to subscribe to the feed and stay synchronized.

## User Review Required

> [!NOTE]
> The worker parses the FRC calendar live by scraping `https://www.firstinspires.org/programs/calendar?view=list&program=frc` using Cloudflare's built-in, edge-optimized `HTMLRewriter` API. This approach is highly efficient, runs entirely at the edge, and requires no external heavy DOM parsers (like Cheerio/JSDOM), ensuring fast execution within Cloudflare's CPU time limits.

> [!IMPORTANT]
> The FRC calendar page contains full event details including dates, title, description, and pre-formatted Google Calendar "Add to Calendar" URLs inside lightboxes. We will extract the date-times and timezone from these Google Calendar links directly, which is extremely reliable because the links are generated server-side by FIRST's CMS.

## Open Questions

None at this time. The requirements are clear, and the HTML structure of the source calendar has been analyzed and shown to contain all necessary machine-readable details.

## Proposed Changes

We will create a new Cloudflare Worker project in the workspace.

---

### Cloudflare Worker Configuration

#### [NEW] [wrangler.toml](file:///Users/techplex/Documents/antigravity/fearless-hypatia/wrangler.toml)

Defines the Cloudflare Worker configuration, name, main entry point, and compatibility date.

#### [NEW] [package.json](file:///Users/techplex/Documents/antigravity/fearless-hypatia/package.json)

Configures project dependencies, specifically adding `wrangler` for development and deployment.

---

### Application Logic

#### [NEW] [index.js](file:///Users/techplex/Documents/antigravity/fearless-hypatia/src/index.js)

Contains the core handler that:

1. Fetches the live calendar HTML from `firstinspires.org`.
2. Parses the HTML stream using `HTMLRewriter` to collect FRC events, titles, descriptions, and Google Calendar links.
3. Decodes and processes the Google Calendar URLs to extract starts/ends date-times, location, and timezone details.
4. Generates an iCal (.ics) formatted string with proper escaping and line-folding.
5. Returns the iCal file with the appropriate `text/calendar; charset=utf-8` Content-Type headers and CORS headers.

## Verification Plan

### Automated Tests

We will write a simple test script to check the iCal parsing logic:

- [NEW] [test.js](file:///Users/techplex/Documents/antigravity/fearless-hypatia/scratch/test.js)
- Run using Node: `node scratch/test.js`

### Manual Verification

1. Run the worker locally using:
   ```bash
   npx wrangler dev
   ```
2. Request the calendar feed locally using `curl`:
   ```bash
   curl -i http://localhost:8787/
   ```
3. Verify that the response has:
   - Status `200 OK`
   - Content-Type `text/calendar; charset=utf-8`
   - Valid iCalendar format starting with `BEGIN:VCALENDAR` and ending with `END:VCALENDAR`
   - Multiple `BEGIN:VEVENT` blocks containing the parsed FRC events with correct summary, description, and timezone-aware dates.
