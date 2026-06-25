import { AssertionError } from 'assert';

async function testCalendarFeed() {
  console.log('Testing FRC Calendar Feed...');
  try {
    const res = await fetch('http://localhost:8787/?bypass=true');
    if (!res.ok) {
      throw new Error(`HTTP Error: ${res.status} ${res.statusText}`);
    }

    const text = await res.text();
    
    // Validate Content-Type
    const contentType = res.headers.get('content-type');
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

    // Verify some specific events exist
    const expectedEvents = [
      'Volunteer Registration Opens',
      'Kickoff',
      'Championship'
    ];

    for (const eventName of expectedEvents) {
      if (!text.toLowerCase().includes(eventName.toLowerCase())) {
        console.warn(`Warning: Event "${eventName}" not found in feed (this may be normal if the FRC season milestones have changed, but double check)`);
      } else {
        console.log(`✓ Found event: ${eventName}`);
      }
    }

    console.log('\nAll iCal feed validation tests PASSED successfully!');
  } catch (error) {
    console.error('Test FAILED:', error);
    process.exit(1);
  }
}

testCalendarFeed();
