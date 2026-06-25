I need a cloudflare worker that scyncrhonizes events from the FRC calendar on this page here: https://www.firstinspires.org/programs/calendar?view=list&program=frc ideally it would make an ical link that google calendar can pull from

are there other files that sould be added to the .gitignore?

If the event ends with the word "closes" only use the end date
if the event starts with the word "opens" only use the start date

why are some events missing, for example "Woodie Flowers Award Application Opens"

Setup github action to deploy to cloudflare if tests pass

---

Sunday mornings at 2am fetch the calendar events that start or end this week and lets format a slack message and post to a webhook into a channel by posting to SLACK_WEBHOOK_URL env var

follow this format for the data to post to slack:

return {
"events": input.array.map(e => `- ${e.summary}: ${new Date(e.start).toLocaleString('en-US', { weekday: 'short', month: 'short', day: 'numeric', year: 'numeric', hour: 'numeric', minute: 'numeric', hour12: true,
  timeZone: 'America/New_York' })}`).join("\n")
}
