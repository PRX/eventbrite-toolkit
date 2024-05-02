import {
  EventBridgeClient,
  PutEventsCommand,
} from "@aws-sdk/client-eventbridge";

const SLACK_CHANNEL = "#garage-registration";
const SLACK_USERNAME = "Eventbrite";
const SLACK_ICON = ":eventbrite:";

const TOKEN = `token=${process.env.EVENTBRITE_TOKEN}`;

const eventbridge = new EventBridgeClient({ apiVersion: "2015-10-07" });

async function getOrder(orderApiUrl) {
  console.info(`Webhook triggered by object ${orderApiUrl}`);
  const reqUrl = `${orderApiUrl}?${TOKEN}&expand=event,attendees`;
  const resp = await fetch(reqUrl);
  const payload = await resp.json();

  console.log(JSON.stringify({ orderPayload: payload }));
  return payload;
}

async function getEvent(order) {
  const reqUrl = `${order.event.resource_uri}?${TOKEN}&expand=ticket_classes,venue`;
  const resp = await fetch(reqUrl);
  const payload = await resp.json();

  console.log(JSON.stringify({ eventPayload: payload }));
  return payload;
}

function message(order, event) {
  const ticketClasses = event.ticket_classes;

  const totalTickets = ticketClasses.reduce((t, c) => t + c.quantity_total, 0);
  const totalSold = ticketClasses.reduce((t, c) => t + c.quantity_sold, 0);

  const remaining = totalTickets - totalSold;

  const tickets = `${order.attendees.length} ticket${order.attendees.length > 1 ? "s" : ""}`;

  const adminUrl = `https://www.eventbrite.com/myevent?eid=${event.id}`;
  const orderUrl = `https://www.eventbrite.com/reports?eid=${event.id}&rid=h&filterby=all,${order.id}`;

  // const order_ts = (Date.parse(order.created) / 1000);

  let geo = "";

  if (event.venue && event.venue.address) {
    geo = `(${event.venue.address.city}, ${event.venue.address.region})`;
  }

  return {
    channel: SLACK_CHANNEL,
    username: `${SLACK_USERNAME} ${geo}`,
    icon_emoji: SLACK_ICON,
    unfurl_links: false,
    unfurl_media: false,
    text: [
      `<mailto:${order.email}|${order.name}> ordered <${orderUrl}|${tickets}> for <${event.url}|${event.name.text}> (<${adminUrl}|Manage>)`,
      `> ${totalSold} tickets ordered – ${remaining} remaining`,
    ].join("\n"),
  };
}

export const handler = async (event) => {
  try {
    const body = event.isBase64Encoded
      ? Buffer.from(event.body, "base64").toString("utf-8")
      : event.body;

    const payload = JSON.parse(body);

    console.debug(
      JSON.stringify({
        event,
        payload,
      }),
    );

    const order = await getOrder(payload.api_url);
    const orderEvent = await getEvent(order);

    await eventbridge.send(
      new PutEventsCommand({
        Entries: [
          {
            Source: "org.prx.eventbrite-toolkit",
            DetailType: "Slack Message Relay Message Payload",
            Detail: JSON.stringify(message(order, orderEvent)),
          },
        ],
      }),
    );

    return { statusCode: 200, headers: {}, body: "" };
  } catch (e) {
    console.log(e);
    throw e;
  }
};
