import { AssertionError } from 'assert';

async function testCalendarFeed() {
  console.log('Testing FRC Calendar Feed...');
  try {
    // Test 1: Validate iCal structure and headers
    const resIcal = await fetch('http://localhost:8787/?bypass=true');
    if (!resIcal.ok) {
      throw new Error(`HTTP Error (iCal): ${resIcal.status} ${resIcal.statusText}`);
    }

    const text = await resIcal.text();
    
    // Validate Content-Type
    const contentType = resIcal.headers.get('content-type');
    console.log(`Content-Type: ${contentType}`);
    if (!contentType || !contentType.includes('text/calendar')) {
      throw new AssertionError({ message: `Expected content-type to include text/calendar, got ${contentType}` });
    }

    // Validate iCal structure
    if (!text.startsWith('BEGIN:VCALENDAR')) {
      throw new AssertionError({ message: 'iCal feed does not start with BEGIN:VCALENDAR' });
    }
    if (!text.includes('END:VCALENDAR')) {
      throw new AssertionError({ message: 'iCal feed does not contain END:VCALENDAR' });
    }
    if (!text.includes('BEGIN:VEVENT')) {
      throw new AssertionError({ message: 'iCal feed does not contain any events (BEGIN:VEVENT)' });
    }
    
    // Verify calendar name headers are present
    if (!text.includes('X-WR-CALNAME:FRC Season Calendar')) {
      throw new AssertionError({ message: 'Missing X-WR-CALNAME header' });
    }
    if (!text.includes('NAME:FRC Season Calendar')) {
      throw new AssertionError({ message: 'Missing NAME header' });
    }
    if (!text.includes('X-WR-CALDESC:FIRST Robotics Competition Season Calendar')) {
      throw new AssertionError({ message: 'Missing X-WR-CALDESC header' });
    }
    console.log('✓ iCal structure and metadata headers are valid.');

    // Test 2: Validate JSON content and milestone logic
    console.log('Fetching FRC Calendar in JSON format...');
    const resJson = await fetch('http://localhost:8787/?format=json&bypass=true');
    if (!resJson.ok) {
      throw new Error(`HTTP Error (JSON): ${resJson.status} ${resJson.statusText}`);
    }

    const events = await resJson.json();
    console.log(`Fetched ${events.length} FRC events.`);

    // Expected events list (must be present)
    const requiredEvents = [
      'Volunteer Registration Opens',
      'Kickoff',
      'Championship',
      'Woodie Flowers Award Application Opens',
      'Official Q'
    ];

    for (const reqEvent of requiredEvents) {
      const found = events.find(e => e.title.toLowerCase().includes(reqEvent.toLowerCase()));
      if (!found) {
        throw new AssertionError({ message: `Required event "${reqEvent}" was not found in the feed!` });
      }
      console.log(`✓ Found required event: ${reqEvent}`);
      
      // Perform date alignment assertions
      const titleLower = found.title.toLowerCase();
      const isTimed = found.startStr.includes('T');
      
      if (titleLower.endsWith('closes') || titleLower.includes('closes')) {
        // Should only use end date
        if (isTimed) {
          if (found.startStr !== found.endStr) {
            throw new AssertionError({
              message: `Event "${found.title}" ends in "closes" but startStr (${found.startStr}) and endStr (${found.endStr}) do not match!`
            });
          }
        } else {
          // For all-day closes event, startStr should be the day before endStr
          const startD = new Date(Date.UTC(parseInt(found.startStr.substring(0,4)), parseInt(found.startStr.substring(4,6))-1, parseInt(found.startStr.substring(6,8))));
          const endD = new Date(Date.UTC(parseInt(found.endStr.substring(0,4)), parseInt(found.endStr.substring(4,6))-1, parseInt(found.endStr.substring(6,8))));
          if (endD.getTime() - startD.getTime() !== 24 * 60 * 60 * 1000) {
            throw new AssertionError({
              message: `Event "${found.title}" ends in "closes" but is not a 1-day event (start: ${found.startStr}, end: ${found.endStr})`
            });
          }
        }
        console.log(`  ✓ Verified single-day "closes" date logic for "${found.title}"`);
      } else if (titleLower.endsWith('opens') || titleLower.startsWith('opens') || titleLower.includes('opens')) {
        // Should only use start date
        if (isTimed) {
          if (found.startStr !== found.endStr) {
            throw new AssertionError({
              message: `Event "${found.title}" starts/ends with "opens" but startStr (${found.startStr}) and endStr (${found.endStr}) do not match!`
            });
          }
        } else {
          // For all-day opens event, it should be a 1-day event
          const startD = new Date(Date.UTC(parseInt(found.startStr.substring(0,4)), parseInt(found.startStr.substring(4,6))-1, parseInt(found.startStr.substring(6,8))));
          const endD = new Date(Date.UTC(parseInt(found.endStr.substring(0,4)), parseInt(found.endStr.substring(4,6))-1, parseInt(found.endStr.substring(6,8))));
          if (endD.getTime() - startD.getTime() !== 24 * 60 * 60 * 1000) {
            throw new AssertionError({
              message: `Event "${found.title}" starts/ends with "opens" but is not a 1-day event (start: ${found.startStr}, end: ${found.endStr})`
            });
          }
        }
        console.log(`  ✓ Verified single-day "opens" date logic for "${found.title}"`);
      }
    }

    console.log('\nAll iCal feed validation tests PASSED successfully!');
  } catch (error) {
    console.error('Test FAILED:', error);
    process.exit(1);
  }
}

testCalendarFeed();
