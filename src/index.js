export default {
  async fetch(request, env, ctx) {
    const url = new URL(request.url);
    const bypassCache = url.searchParams.get('bypass') === 'true';

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
      const calendarUrl = 'https://www.firstinspires.org/programs/calendar?view=list&program=frc';
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
                } else if (lowerTitle.startsWith('opens')) {
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
    .on('div.calendar-lightbox-content .lightbox-programs span', {
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
    .on('div.calendar-lightbox-content .lightbox-categories span', {
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

