const calendarUrl = 'https://www.firstinspires.org/programs/calendar?view=list&program=frc';

export default {
  async fetch(request, env, ctx) {
    const url = new URL(request.url);
    const testSlack = url.searchParams.get('test-slack') === 'true';
    if (testSlack) {
      try {
        await handleScheduled(env);
        return new Response('Slack test trigger completed successfully.', { status: 200 });
      } catch (err) {
        return new Response(`Slack test trigger failed: ${err.message}`, { status: 500 });
      }
    }

    const bypassCache = url.searchParams.get('bypass') === 'true';
    const getJSON = url.searchParams.get('format') === 'json';

    const cacheKey = new Request(request.url, request);
    const cache = caches.default;

    if (!bypassCache) {
      const cachedResponse = await cache.match(cacheKey);
      if (cachedResponse) {
        return cachedResponse;
      }
    }

    try {
      // Fetch FRC calendar page from FIRST Inspires
      
      const targetResponse = await fetch(calendarUrl, {
        headers: {
          'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
          'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,image/webp,*/*;q=0.8'
        }
      });

      if (!targetResponse.ok) {
        return new Response(`Failed to fetch FRC calendar: ${targetResponse.status} ${targetResponse.statusText}`, {
          status: 502,
          headers: { 'Content-Type': 'text/plain' }
        });
      }

      const htmlText = await targetResponse.text();
      const events = await parseFrcEvents(htmlText);

      if(getJSON) {
        return new Response(JSON.stringify(events), {
          status: 200,
          headers: {
            'Content-Type': 'application/json',
            'Access-Control-Allow-Origin': '*',
            // 'Cache-Control': 'public, max-age=3600', // Cache for 1 hour
          }
        });
      }

      // console.log(events)

      // Generate iCal feed
      const icalContent = generateICal(events);

      const response = new Response(icalContent, {
        status: 200,
        headers: {
          'Content-Type': 'text/calendar; charset=utf-8',
          'Content-Disposition': 'attachment; filename="frc-calendar.ics"',
          'Access-Control-Allow-Origin': '*',
          'Cache-Control': 'public, max-age=3600', // Cache for 1 hour
        }
      });

      // Cache the response if it was successful
      if (!bypassCache) {
        ctx.waitUntil(cache.put(cacheKey, response.clone()));
      }

      return response;
    } catch (error) {
      return new Response(`Error synchronizing FRC calendar: ${error.message}\n${error.stack}`, {
        status: 500,
        headers: { 'Content-Type': 'text/plain' }
      });
    }
  },

  async scheduled(event, env, ctx) {
    ctx.waitUntil(handleScheduled(env));
  }
};

/**
 * Parses FRC events from FIRST calendar HTML using HTMLRewriter.
 */
async function parseFrcEvents(htmlText) {
  const events = [];
  let currentLightbox = null;
  let currentText = '';
  let currentTarget = null; // 'heading' | 'description' | 'program' | 'category'

  const response = new Response(htmlText);
  const rewriter = new HTMLRewriter()
    .on('div.calendar-lightbox-content', {
      element(el) {
        currentLightbox = {
          title: '',
          description: '',
          programs: [],
          categories: [],
          gcalUrl: '',
        };
        el.onEndTag(() => {
          if (currentLightbox) {
            // Check if this event belongs to FRC
            const isFrc = currentLightbox.programs.some(p => 
              p.toLowerCase().includes('robotics competition') || 
              p.toLowerCase().includes('frc')
            );
            
            if (isFrc && currentLightbox.gcalUrl) {
              const parsedGcal = parseGcalUrl(currentLightbox.gcalUrl);
              if (parsedGcal) {
                let startStr = parsedGcal.startStr;
                let endStr = parsedGcal.endStr;
                const title = parsedGcal.text || currentLightbox.title || 'FRC Event';
                
                const trimmedTitle = title.trim();
                const lowerTitle = trimmedTitle.toLowerCase();
                const isTimed = startStr.includes('T');

                if (lowerTitle.endsWith('closes')) {
                  if (isTimed) {
                    startStr = endStr;
                  } else {
                    const endDate = parseYyyyMmDd(endStr);
                    const startDate = new Date(endDate.getTime());
                    startDate.setUTCDate(startDate.getUTCDate() - 1);
                    startStr = formatYyyyMmDd(startDate);
                  }
                } else if (lowerTitle.endsWith('opens')) {
                  if (isTimed) {
                    endStr = startStr;
                  } else {
                    const startDate = parseYyyyMmDd(startStr);
                    const endDate = new Date(startDate.getTime());
                    endDate.setUTCDate(endDate.getUTCDate() + 1);
                    endStr = formatYyyyMmDd(endDate);
                  }
                }

                events.push({
                  title: trimmedTitle,
                  description: currentLightbox.description,
                  startStr,
                  endStr,
                  location: parsedGcal.location,
                  ctz: parsedGcal.ctz,
                  gcalUrl: currentLightbox.gcalUrl
                });
              }
            }
            currentLightbox = null;
          }
        });
      }
    })
    .on('div.calendar-lightbox-content .lightbox-heading', {
      element(el) {
        currentTarget = 'heading';
        currentText = '';
        el.onEndTag(() => {
          if (currentLightbox) {
            currentLightbox.title = currentText.replace(/\s+/g, ' ').trim();
          }
          currentTarget = null;
        });
      },
      text(textEl) {
        if (currentTarget === 'heading') {
          currentText += textEl.text;
        }
      }
    })
    .on('div.calendar-lightbox-content .lightbox-description', {
      element(el) {
        currentTarget = 'description';
        currentText = '';
        el.onEndTag(() => {
          if (currentLightbox) {
            // Normalize spaces/newlines
            currentLightbox.description = currentText
              .replace(/[ \t]+/g, ' ') // collapse horizontal spaces
              .replace(/\n\s*\n+/g, '\n\n') // collapse multiple blank lines
              .trim();
          }
          currentTarget = null;
        });
      },
      text(textEl) {
        if (currentTarget === 'description') {
          currentText += textEl.text;
        }
      }
    })
    .on('div.calendar-lightbox-content .lightbox-description p', {
      element(el) {
        el.onEndTag(() => {
          if (currentTarget === 'description') {
            currentText += '\n\n';
          }
        });
      }
    })
    .on('div.calendar-lightbox-content .lightbox-description br', {
      element(el) {
        if (currentTarget === 'description') {
          currentText += '\n';
        }
      }
    })
    .on('div.calendar-lightbox-content .lightbox-programs span, div.calendar-lightbox-content .lightbox-programs a', {
      element(el) {
        currentTarget = 'program';
        currentText = '';
        el.onEndTag(() => {
          if (currentLightbox) {
            currentLightbox.programs.push(currentText.trim());
          }
          currentTarget = null;
        });
      },
      text(textEl) {
        if (currentTarget === 'program') {
          currentText += textEl.text;
        }
      }
    })
    .on('div.calendar-lightbox-content .lightbox-categories span, div.calendar-lightbox-content .lightbox-categories a', {
      element(el) {
        currentTarget = 'category';
        currentText = '';
        el.onEndTag(() => {
          if (currentLightbox) {
            currentLightbox.categories.push(currentText.trim());
          }
          currentTarget = null;
        });
      },
      text(textEl) {
        if (currentTarget === 'category') {
          currentText += textEl.text;
        }
      }
    })
    .on('div.calendar-lightbox-content .lightbox-add-to-calendar a.button', {
      element(el) {
        if (currentLightbox) {
          currentLightbox.gcalUrl = el.getAttribute('href') || '';
        }
      }
    });

  const transformed = rewriter.transform(response);
  await transformed.text(); // Consume stream to run handlers
  return events;
}

/**
 * Parses Google Calendar URL to extract event parameters.
 */
function parseGcalUrl(urlStr) {
  const decodedUrl = urlStr.replace(/&amp;/g, '&');
  try {
    const url = new URL(decodedUrl);
    const params = url.searchParams;
    const text = params.get('text') || '';
    const dates = params.get('dates') || '';
    const location = params.get('location') || '';
    const details = params.get('details') || '';
    const ctz = params.get('ctz') || 'America/New_York';

    const [startStr, endStr] = dates.split('/');

    return {
      text,
      startStr,
      endStr,
      location,
      details,
      ctz
    };
  } catch (err) {
    return null;
  }
}

/**
 * Generates RFC 5545 iCalendar content.
 */
function generateICal(events) {
  const now = new Date();
  const stampStr = now.toISOString().replace(/[-:]/g, '').split('.')[0] + 'Z';

  let ics = [
    'BEGIN:VCALENDAR',
    'VERSION:2.0',
    'PRODID:-//Antigravity//FRC Calendar Sync//EN',
    'CALSCALE:GREGORIAN',
    'METHOD:PUBLISH',
    'X-WR-CALNAME:FRC Season Calendar',
    'X-WR-CALDESC:FIRST Robotics Competition Season Calendar',
    'NAME:FRC Season Calendar',
    'X-WR-TIMEZONE:America/New_York',
    'REFRESH-INTERVAL;VALUE=DURATION:PT1H',
    'X-PUBLISHED-TTL:PT1H'
  ];

  for (const event of events) {
    const uid = `${slugify(event.title)}-${event.startStr}-${event.endStr}@frc-calendar-sync.local`;
    
    ics.push('BEGIN:VEVENT');
    ics.push(`UID:${uid}`);
    ics.push(`DTSTAMP:${stampStr}`);
    
    // Check if startStr is timed (contains 'T') or just a date
    if (event.startStr.includes('T')) {
      ics.push(`DTSTART;TZID=${event.ctz}:${event.startStr}`);
      ics.push(`DTEND;TZID=${event.ctz}:${event.endStr}`);
    } else {
      ics.push(`DTSTART;VALUE=DATE:${event.startStr}`);
      ics.push(`DTEND;VALUE=DATE:${event.endStr}`);
    }
    
    ics.push(`SUMMARY:${escapeICalText(event.title)}`);
    if (event.description) {
      ics.push(`DESCRIPTION:${escapeICalText(event.description)}`);
    }
    if (event.location) {
      ics.push(`LOCATION:${escapeICalText(event.location)}`);
    }
    ics.push('END:VEVENT');
  }

  ics.push('END:VCALENDAR');

  return ics.map(foldLine).join('\r\n');
}

/**
 * Escapes characters for iCal values.
 */
function escapeICalText(text) {
  if (!text) return '';
  const decoded = decodeHtmlEntities(text);
  return decoded
    .replace(/\\/g, '\\\\')
    .replace(/,/g, '\\,')
    .replace(/;/g, '\\;')
    .replace(/\n/g, '\\n')
    .replace(/\r/g, '');
}

/**
 * Decodes HTML entities commonly found in target webpage.
 */
function decodeHtmlEntities(str) {
  if (!str) return '';
  return str
    .replace(/&amp;/g, '&')
    .replace(/&nbsp;/g, ' ')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#039;/g, "'")
    .replace(/&apos;/g, "'")
    .replace(/&rsquo;/g, "'")
    .replace(/&lsquo;/g, "'")
    .replace(/&ldquo;/g, '"')
    .replace(/&rdquo;/g, '"')
    .replace(/&ndash;/g, '-')
    .replace(/&mdash;/g, '—');
}


/**
 * Folds iCal lines to max 75 octets.
 */
function foldLine(line) {
  const parts = [];
  while (line.length > 75) {
    parts.push(line.substring(0, 75));
    line = ' ' + line.substring(75);
  }
  parts.push(line);
  return parts.join('\r\n');
}

/**
 * Slugifies text for UID stability.
 */
function slugify(text) {
  return text
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/(^-|-$)+/g, '');
}

/**
 * Parses YYYYMMDD into a Date object.
 */
function parseYyyyMmDd(str) {
  const y = parseInt(str.substring(0, 4), 10);
  const m = parseInt(str.substring(4, 6), 10) - 1;
  const d = parseInt(str.substring(6, 8), 10);
  return new Date(Date.UTC(y, m, d));
}

/**
 * Formats a Date object as a YYYYMMDD string.
 */
function formatYyyyMmDd(date) {
  const y = date.getUTCFullYear();
  const m = String(date.getUTCMonth() + 1).padStart(2, '0');
  const d = String(date.getUTCDate()).padStart(2, '0');
  return `${y}${m}${d}`;
}

/**
 * Scheduled handler to fetch events weekly and post to Slack.
 */
async function handleScheduled(env) {
  if (!env.SLACK_WEBHOOK_URL) {
    console.error('SLACK_WEBHOOK_URL environment variable is not set.');
    return;
  }

  try {
    // 1. Fetch calendar page
    const response = await fetch(calendarUrl, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
        'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,image/webp,*/*;q=0.8'
      }
    });

    if (!response.ok) {
      throw new Error(`Failed to fetch FRC calendar: ${response.status} ${response.statusText}`);
    }

    const htmlText = await response.text();
    const events = await parseFrcEvents(htmlText);

    // 2. Filter events that start or end "this week"
    const now = new Date();
    // Get Sunday of the current week (UTC-based logic, aligned to America/New_York days)
    const todayUtc = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()));
    const dayOfWeek = todayUtc.getUTCDay();
    const startOfWeek = new Date(todayUtc);
    startOfWeek.setUTCDate(todayUtc.getUTCDate() - dayOfWeek);
    const endOfWeek = new Date(startOfWeek);
    endOfWeek.setUTCDate(startOfWeek.getUTCDate() + 7);

    const filteredEvents = events.filter(e => {
      const startDay = parseYyyyMmDd(e.startStr.substring(0, 8));
      const endDay = parseYyyyMmDd(e.endStr.substring(0, 8));
      // For all-day events, the end date is exclusive, so the last active day is endDay - 1 day.
      const activeEndDay = e.startStr.includes('T') ? endDay : new Date(endDay.getTime() - 24 * 60 * 60 * 1000);

      const startsThisWeek = startDay >= startOfWeek && startDay < endOfWeek;
      const endsThisWeek = activeEndDay >= startOfWeek && activeEndDay < endOfWeek;

      return startsThisWeek || endsThisWeek;
    });

    if (filteredEvents.length === 0) {
      console.log('No events starting or ending this week.');
      return;
    }

    // 3. Format according to the user's requested snippet
    const input = {
      array: filteredEvents.map(e => {
        const absoluteDate = parseToAbsoluteDate(e.startStr, e.ctz);
        return {
          summary: e.title,
          start: absoluteDate.getTime()
        };
      })
    };

    // User's formatting logic
    const payload = {
      "events": input.array.map(e => `- ${e.summary}: ${new Date(e.start).toLocaleString('en-US', { weekday: 'short', month: 'short', day: 'numeric', year: 'numeric', hour: 'numeric', minute: 'numeric', hour12: true,
        timeZone: 'America/New_York' })}`).join("\n")
    };

    // 4. Send to Slack webhook
    const slackRes = await fetch(env.SLACK_WEBHOOK_URL, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json'
      },
      body: JSON.stringify(payload)
    });

    if (!slackRes.ok) {
      throw new Error(`Slack post failed: ${slackRes.status} ${slackRes.statusText}`);
    }

    console.log('Successfully posted events to Slack.');
  } catch (error) {
    console.error('Error in scheduled handler:', error);
    throw error;
  }
}

/**
 * Parses YYYYMMDD or YYYYMMDDTHHMMSS in America/New_York (or other ctz)
 * and returns a standard Date object representing that exact point in time.
 */
function parseToAbsoluteDate(dateStr, timezone = 'America/New_York') {
  const y = dateStr.substring(0, 4);
  const m = dateStr.substring(4, 6);
  const d = dateStr.substring(6, 8);
  
  let localDate;
  if (dateStr.includes('T')) {
    const hh = dateStr.substring(9, 11);
    const mm = dateStr.substring(11, 13);
    const ss = dateStr.substring(13, 15);
    localDate = new Date(`${y}-${m}-${d}T${hh}:${mm}:${ss}`);
  } else {
    localDate = new Date(`${y}-${m}-${d}T00:00:00`);
  }

  // Shift by timezone offset to represent the correct epoch timestamp in Workers
  const tzDate = new Date(localDate.toLocaleString('en-US', { timeZone: timezone }));
  const diff = localDate.getTime() - tzDate.getTime();
  return new Date(localDate.getTime() + diff);
}

