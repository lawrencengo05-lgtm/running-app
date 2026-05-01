const { DynamoDBClient, PutItemCommand, QueryCommand, DeleteItemCommand } = require("@aws-sdk/client-dynamodb");
const { marshall, unmarshall } = require("@aws-sdk/util-dynamodb");

const client = new DynamoDBClient({ region: "us-east-1" });
const TABLE_NAME = "RunLogs";
const DEMO_USER_ID = "user-001";
const ANTHROPIC_API_KEY = process.env.ANTHROPIC_API_KEY;
const CLAUDE_MODEL = "claude-haiku-4-5";

exports.handler = async (event) => {
  const headers = {
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Headers": "Content-Type",
    "Access-Control-Allow-Methods": "GET, POST, PUT, DELETE, OPTIONS",
    "Content-Type": "application/json"
  };

  try {
    const method = event.httpMethod || event.requestContext?.http?.method;
    const path = event.path || event.requestContext?.http?.path || "";

    if (method === "OPTIONS") {
      return { statusCode: 200, headers, body: "" };
    }

    if (method === "POST" && path.endsWith("/coach")) {
      return await handleCoach(event, headers);
    }

    if (method === "POST" && path.endsWith("/runs")) {
      const body = JSON.parse(event.body);
      const item = {
        userId: DEMO_USER_ID,
        runId: new Date().toISOString(),
        title: body.title || "",
        date: body.date,
        distance: body.distance,
        duration: body.duration,
        notes: body.notes || ""
      };
      await client.send(new PutItemCommand({
        TableName: TABLE_NAME,
        Item: marshall(item)
      }));
      return { statusCode: 201, headers, body: JSON.stringify({ message: "Run saved!", item }) };
    }

    if (method === "PUT" && path.includes("/runs/")) {
      const runId = decodeURIComponent(path.split("/runs/")[1]);
      const body = JSON.parse(event.body);
      const item = {
        userId: DEMO_USER_ID,
        runId: runId,
        title: body.title || "",
        date: body.date,
        distance: body.distance,
        duration: body.duration,
        notes: body.notes || ""
      };
      await client.send(new PutItemCommand({
        TableName: TABLE_NAME,
        Item: marshall(item)
      }));
      return { statusCode: 200, headers, body: JSON.stringify({ message: "Run updated!", item }) };
    }

    if (method === "DELETE" && path.includes("/runs/")) {
      const runId = decodeURIComponent(path.split("/runs/")[1]);
      await client.send(new DeleteItemCommand({
        TableName: TABLE_NAME,
        Key: marshall({ userId: DEMO_USER_ID, runId: runId })
      }));
      return { statusCode: 200, headers, body: JSON.stringify({ message: "Run deleted!" }) };
    }

    if (method === "GET") {
      const result = await client.send(new QueryCommand({
        TableName: TABLE_NAME,
        KeyConditionExpression: "userId = :uid",
        ExpressionAttributeValues: marshall({ ":uid": DEMO_USER_ID }),
        ScanIndexForward: false
      }));
      const items = (result.Items || []).map(i => unmarshall(i));
      return { statusCode: 200, headers, body: JSON.stringify(items) };
    }

    return { statusCode: 404, headers, body: JSON.stringify({ error: "Method not supported" }) };
  } catch (err) {
    console.error("Error:", err);
    return { statusCode: 500, headers, body: JSON.stringify({ error: err.message }) };
  }
};

async function handleCoach(event, headers) {
  const body = JSON.parse(event.body);
  const userMessage = body.message;

  if (!userMessage) {
    return { statusCode: 400, headers, body: JSON.stringify({ error: "Missing 'message' field" }) };
  }

  const runsResult = await client.send(new QueryCommand({
    TableName: TABLE_NAME,
    KeyConditionExpression: "userId = :uid",
    ExpressionAttributeValues: marshall({ ":uid": DEMO_USER_ID }),
    ScanIndexForward: false,
    Limit: 10
  }));
  const recentRuns = (runsResult.Items || []).map(i => unmarshall(i));

  const runsContext = recentRuns.length === 0
    ? "The user hasn't logged any runs yet."
    : "Recent runs (newest first):\n" + recentRuns.map(r =>
        `- ${r.date}: ${r.distance} in ${r.duration}${r.notes ? ` (notes: ${r.notes})` : ""}`
      ).join("\n");

  const systemPrompt = `You are a supportive, knowledgeable running coach helping a beginner runner. Be encouraging, specific, and concise. When giving training advice, ground it in the user's actual run history. Avoid medical advice — recommend they see a doctor or physical therapist for any pain or health concerns.

${runsContext}`;

  const claudeResponse = await fetch("https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers: {
      "x-api-key": ANTHROPIC_API_KEY,
      "anthropic-version": "2023-06-01",
      "content-type": "application/json"
    },
    body: JSON.stringify({
      model: CLAUDE_MODEL,
      max_tokens: 1024,
      system: systemPrompt,
      messages: [{ role: "user", content: userMessage }]
    })
  });

  if (!claudeResponse.ok) {
    const errorText = await claudeResponse.text();
    console.error("Claude API error:", errorText);
    return { statusCode: 500, headers, body: JSON.stringify({ error: "Coach unavailable. Try again later." }) };
  }

  const data = await claudeResponse.json();
  const reply = data.content[0].text;

  return { statusCode: 200, headers, body: JSON.stringify({ reply, runsContextUsed: recentRuns.length }) };
}