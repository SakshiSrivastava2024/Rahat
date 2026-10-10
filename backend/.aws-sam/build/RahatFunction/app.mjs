import { DynamoDBClient, CreateTableCommand } from "@aws-sdk/client-dynamodb";
import {
  DynamoDBDocumentClient, PutCommand, ScanCommand, UpdateCommand,
} from "@aws-sdk/lib-dynamodb";
import { randomUUID } from "node:crypto";

// When DYNAMO_ENDPOINT is set we are running locally against DynamoDB Local.
const local =
  process.env.DYNAMO_ENDPOINT ||
  (process.env.AWS_SAM_LOCAL === "true" ? "http://host.docker.internal:8000" : "");
const raw = new DynamoDBClient(
  local
    ? {
        endpoint: local,
        region: "ap-south-1",
        credentials: { accessKeyId: "fake", secretAccessKey: "fake" },
      }
    : {}
);
const db = DynamoDBDocumentClient.from(raw);

const TABLE = process.env.TABLE_NAME;
const TTL_MS = Number(process.env.CLAIM_TTL_MINUTES || 180) * 60000;
const NEEDS = ["food", "water", "medicine", "baby supplies", "other"];

let ready = !local;
async function ensureTable() {
  if (ready) return;
  try {
    await raw.send(new CreateTableCommand({
      TableName: TABLE,
      BillingMode: "PAY_PER_REQUEST",
      AttributeDefinitions: [{ AttributeName: "requestId", AttributeType: "S" }],
      KeySchema: [{ AttributeName: "requestId", KeyType: "HASH" }],
    }));
  } catch (e) {
    if (e.name !== "ResourceInUseException") throw e;
  }
  ready = true;
}

const reply = (statusCode, body) => ({
  statusCode,
  headers: {
    "Content-Type": "application/json",
    "Access-Control-Allow-Origin": "*",
  },
  body: JSON.stringify(body),
});

// Higher score = more urgent. Waiting time adds up to +50 (1 point per 10 min).
function urgency(r, now) {
  let s = 0;
  if (r.infant) s += 50;
  if (r.medical) s += 40;
  if (r.elderly) s += 20;
  s += Math.min(r.people || 1, 10) * 2;
  if (r.need === "medicine" || r.need === "baby supplies") s += 30;
  else if (r.need === "water") s += 15;
  s += Math.min((now - Date.parse(r.createdAt)) / 600000, 50);
  return Math.round(s);
}

// Public view: no phone number. An expired claim shows as open again.
function view(r, now) {
  const expired =
    r.status === "claimed" && now - Date.parse(r.claimedAt) > TTL_MS;
  const { phone, ...pub } = r;
  return {
    ...pub,
    status: expired ? "requested" : r.status,
    reopened: expired,
    waitingMinutes: Math.round((now - Date.parse(r.createdAt)) / 60000),
    urgency: urgency(r, now),
  };
}

export const handler = async (event) => {
  const method = event.requestContext.http.method;
  try {
    await ensureTable();
    const now = Date.now();

    // POST /requests - create a request
    if (method === "POST") {
      const b = JSON.parse(event.body || "{}");
      const lat = Number(b.lat);
      const lng = Number(b.lng);
      const phone = String(b.phone || "").replace(/\D/g, "").slice(-10);
      if (!NEEDS.includes(b.need)) return reply(400, { error: "invalid need" });
      if (!Number.isFinite(lat) || Math.abs(lat) > 90 ||
          !Number.isFinite(lng) || Math.abs(lng) > 180) {
        return reply(400, { error: "invalid location" });
      }
      if (phone.length !== 10) return reply(400, { error: "invalid phone" });

      const item = {
        requestId: randomUUID(),
        need: b.need,
        description: String(b.description || "").slice(0, 300),
        people: Math.min(Math.max(parseInt(b.people, 10) || 1, 1), 50),
        infant: !!b.infant,
        elderly: !!b.elderly,
        medical: !!b.medical,
        lat, lng, phone,
        status: "requested",
        createdAt: new Date(now).toISOString(),
      };
      await db.send(new PutCommand({ TableName: TABLE, Item: item }));
      return reply(201, { requestId: item.requestId });
    }

    // GET /requests - open requests first, most urgent on top, delivered last
    if (method === "GET") {
      const { Items = [] } = await db.send(new ScanCommand({ TableName: TABLE }));
      const list = Items.map((r) => view(r, now)).sort((a, b) => {
        const da = a.status === "delivered" ? 1 : 0;
        const dbb = b.status === "delivered" ? 1 : 0;
        return da - dbb || b.urgency - a.urgency;
      });
      return reply(200, list);
    }

    // PATCH /requests/{id} - claim or deliver
    if (method === "PATCH") {
      const id = event.pathParameters.id;
      const { action, volunteer, note } = JSON.parse(event.body || "{}");
      if (!volunteer) return reply(400, { error: "volunteer name required" });
      const iso = new Date(now).toISOString();

      if (action === "claim") {
        // Allowed if open, or if a previous claim has expired (ghost claim).
        const out = await db.send(new UpdateCommand({
          TableName: TABLE,
          Key: { requestId: id },
          UpdateExpression: "SET #s = :claimed, claimedBy = :v, claimedAt = :now",
          ConditionExpression:
            "#s = :requested OR (#s = :claimed AND claimedAt < :cutoff)",
          ExpressionAttributeNames: { "#s": "status" },
          ExpressionAttributeValues: {
            ":requested": "requested",
            ":claimed": "claimed",
            ":v": volunteer,
            ":now": iso,
            ":cutoff": new Date(now - TTL_MS).toISOString(),
          },
          ReturnValues: "ALL_NEW",
        }));
        // Only the claimer receives the phone number.
        return reply(200, out.Attributes);
      }

      if (action === "deliver") {
        const out = await db.send(new UpdateCommand({
          TableName: TABLE,
          Key: { requestId: id },
          UpdateExpression:
            "SET #s = :delivered, deliveredAt = :now, deliveryNote = :note",
          ConditionExpression: "#s = :claimed AND claimedBy = :v",
          ExpressionAttributeNames: { "#s": "status" },
          ExpressionAttributeValues: {
            ":delivered": "delivered",
            ":claimed": "claimed",
            ":v": volunteer,
            ":now": iso,
            ":note": String(note || "").slice(0, 200),
          },
          ReturnValues: "ALL_NEW",
        }));
        return reply(200, view(out.Attributes, now));
      }

      return reply(400, { error: "action must be claim or deliver" });
    }

    return reply(405, { error: "method not allowed" });
  } catch (e) {
    if (e.name === "ConditionalCheckFailedException") {
      return reply(409, {
        error: "not allowed in the current state (already claimed, or not yours)",
      });
    }
    console.error(e);
    return reply(500, { error: "server error" });
  }
};