const { DynamoDBClient, PutItemCommand, QueryCommand, DeleteItemCommand } = require("@aws-sdk/client-dynamodb");
const { marshall, unmarshall } = require("@aws-sdk/util-dynamodb");

const client = new DynamoDBClient({ region: "us-east-1" });
const RUNS_TABLE = "RunLogs";
const PLANS_TABLE = "TrainingPlans";
const ANTHROPIC_API_KEY = process.env.ANTHROPIC_API_KEY;
const CLAUDE_MODEL = "claude-haiku-4-5";
const STRAVA_CLIENT_ID = process.env.STRAVA_CLIENT_ID;
const STRAVA_CLIENT_SECRET = process.env.STRAVA_CLIENT_SECRET;
const STRAVA_TABLE = "StravaTokens";

function getUserId(event) {
  console.log("requestContext:", JSON.stringify(event.requestContext, null, 2));
  const userId =
    event.requestContext?.authorizer?.jwt?.claims?.sub ||
    event.requestContext?.authorizer?.claims?.sub ||
    event.requestContext?.authorizer?.principalId;
  if (!userId) {
    throw new Error("Unauthorized: no user ID in token");
  }
  return userId;
}

exports.handler = async (event) => {
  const headers = {
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Headers": "Content-Type, Authorization",
    "Access-Control-Allow-Methods": "GET, POST, PUT, PATCH, DELETE, OPTIONS",
    "Content-Type": "application/json"
  };

  try {
    const method = event.httpMethod || event.requestContext?.http?.method;
    const path = event.path || event.requestContext?.http?.path || "";

    if (method === "OPTIONS") {
      return { statusCode: 200, headers, body: "" };
    }

    const userId = getUserId(event);
    
    if (method === "GET" && path.endsWith("/strava/auth-url")) {
  return await getStravaAuthUrl(event, headers, userId);
}

if (method === "POST" && path.endsWith("/strava/exchange")) {
  return await exchangeStravaCode(event, headers, userId);
}

if (method === "GET" && path.endsWith("/strava/status")) {
  return await getStravaStatus(headers, userId);
}

if (method === "POST" && path.endsWith("/strava/sync")) {
  return await syncStravaActivities(event, headers, userId);
}

    if (method === "POST" && path.endsWith("/coach")) {
      return await handleCoach(event, headers, userId);
    }

    if (method === "POST" && path.endsWith("/plan")) {
      return await generatePlan(event, headers, userId);
    }

    if (method === "GET" && path.endsWith("/plan")) {
      return await getPlan(headers, userId);
    }

    if (method === "PATCH" && path.endsWith("/plan/workout")) {
      return await toggleWorkout(event, headers, userId);
    }

    if (method === "DELETE" && path.endsWith("/plan")) {
      return await deletePlan(headers, userId);
    }

    if (method === "POST" && path.endsWith("/runs")) {
      const body = JSON.parse(event.body);
      const item = {
        userId: userId,
        runId: new Date().toISOString(),
        title: body.title || "",
        date: body.date,
        distance: body.distance,
        duration: body.duration,
        notes: body.notes || ""
      };
      await client.send(new PutItemCommand({
        TableName: RUNS_TABLE,
        Item: marshall(item)
      }));
      return { statusCode: 201, headers, body: JSON.stringify({ message: "Run saved!", item }) };
    }

    if (method === "PUT" && path.includes("/runs/")) {
      const runId = decodeURIComponent(path.split("/runs/")[1]);
      const body = JSON.parse(event.body);
      const item = {
        userId: userId,
        runId: runId,
        title: body.title || "",
        date: body.date,
        distance: body.distance,
        duration: body.duration,
        notes: body.notes || ""
      };
      await client.send(new PutItemCommand({
        TableName: RUNS_TABLE,
        Item: marshall(item)
      }));
      return { statusCode: 200, headers, body: JSON.stringify({ message: "Run updated!", item }) };
    }

    if (method === "DELETE" && path.includes("/runs/")) {
      const runId = decodeURIComponent(path.split("/runs/")[1]);
      await client.send(new DeleteItemCommand({
        TableName: RUNS_TABLE,
        Key: marshall({ userId: userId, runId: runId })
      }));
      return { statusCode: 200, headers, body: JSON.stringify({ message: "Run deleted!" }) };
    }

    if (method === "GET") {
      const result = await client.send(new QueryCommand({
        TableName: RUNS_TABLE,
        KeyConditionExpression: "userId = :uid",
        ExpressionAttributeValues: marshall({ ":uid": userId }),
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

async function handleCoach(event, headers, userId) {
  const body = JSON.parse(event.body);
  const userMessage = body.message;

  if (!userMessage) {
    return { statusCode: 400, headers, body: JSON.stringify({ error: "Missing 'message' field" }) };
  }

  const runsResult = await client.send(new QueryCommand({
    TableName: RUNS_TABLE,
    KeyConditionExpression: "userId = :uid",
    ExpressionAttributeValues: marshall({ ":uid": userId }),
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

async function generatePlan(event, headers, userId) {
  const body = JSON.parse(event.body);
  const { goal, weeks, daysPerWeek, currentFitness, unit } = body;
  const unitLabel = unit === "mi" ? "miles" : "kilometers";

  if (!goal || !weeks || !daysPerWeek) {
    return { statusCode: 400, headers, body: JSON.stringify({ error: "Missing required fields: goal, weeks, daysPerWeek" }) };
  }

  const runsResult = await client.send(new QueryCommand({
    TableName: RUNS_TABLE,
    KeyConditionExpression: "userId = :uid",
    ExpressionAttributeValues: marshall({ ":uid": userId }),
    ScanIndexForward: false,
    Limit: 30
  }));
  const recentRuns = (runsResult.Items || []).map(i => unmarshall(i));

  let runHistoryContext = "";
  if (recentRuns.length > 0) {
    const summary = recentRuns.map(r =>
      `- ${r.date}: ${r.distance} in ${r.duration}${r.notes ? ` (${r.notes})` : ""}`
    ).join("\n");

    const distances = recentRuns
      .map(r => parseFloat((r.distance || "").match(/[\d.]+/)?.[0] || "0"))
      .filter(d => d > 0);
    const avgDistance = distances.length > 0
      ? (distances.reduce((a, b) => a + b, 0) / distances.length).toFixed(1)
      : "unknown";
    const longestDistance = distances.length > 0 ? Math.max(...distances).toFixed(1) : "unknown";

    runHistoryContext = "\n\nUser's recent run history (last " + recentRuns.length + " runs):\n" + summary + "\n\nQuick stats:\n- Average distance per run: " + avgDistance + " km\n- Longest run: " + longestDistance + " km\n- Total runs logged: " + recentRuns.length + "\n\nUse this real data to set the plan's starting difficulty and progression. Don't suggest paces or distances drastically out of line with what they're already doing.";
  } else {
    runHistoryContext = "\n\nThe user hasn't logged any runs yet, so design a beginner-friendly plan starting from low intensity.";
  }

  const planSchemaPrompt = `You are a running coach creating a personalized training plan. Respond with ONLY valid JSON matching this exact schema, no other text or markdown:

{
  "title": "string - short plan title that briefly references the user's starting point if they have run history",
  "goal": "string - the user's goal",
  "weeks": [
    {
      "week": 1,
      "workouts": [
        {
          "workoutId": "w1d1",
          "day": "Monday",
          "description": "specific workout instructions, 1-2 sentences",
          "type": "run|cross-train|rest"
        }
      ]
    }
  ]
}

Plan parameters:
- Goal: ${goal}
- Duration: ${weeks} weeks
- Days per week: ${daysPerWeek}
- User-stated fitness: ${currentFitness || "not specified"}
${runHistoryContext}

Rules:
- Each week must have exactly ${daysPerWeek} workouts
- workoutId format: "w" + weekNumber + "d" + workoutNumber (e.g., w1d1, w1d2, w2d1)
- type must be one of: "run", "cross-train", "rest"
- Be specific in descriptions (mention duration, intensity, intervals)
- Progress gradually week to week
- Include rest/recovery appropriately
- All distances in workout descriptions must be in ${unitLabel}
- If the user has run history, reference their current ability in the plan title (e.g., "5K Plan from a 3K base" or "10K plan building from your weekly 5K runs")
- The first week's workouts should be calibrated to their current average distance, not lower
- Output ONLY the JSON object, no markdown fences, no commentary`;

  const claudeResponse = await fetch("https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers: {
      "x-api-key": ANTHROPIC_API_KEY,
      "anthropic-version": "2023-06-01",
      "content-type": "application/json"
    },
    body: JSON.stringify({
      model: CLAUDE_MODEL,
      max_tokens: 4096,
      messages: [{ role: "user", content: planSchemaPrompt }]
    })
  });

  if (!claudeResponse.ok) {
    const errorText = await claudeResponse.text();
    console.error("Claude API error:", errorText);
    return { statusCode: 500, headers, body: JSON.stringify({ error: "Plan generation failed." }) };
  }

  const data = await claudeResponse.json();
  const rawText = data.content[0].text.trim();

  let planData;
  try {
    const cleanedText = rawText.replace(/^```json\s*/i, "").replace(/^```\s*/i, "").replace(/\s*```$/i, "");
    planData = JSON.parse(cleanedText);
  } catch (parseErr) {
    console.error("Failed to parse Claude JSON:", rawText);
    return { statusCode: 500, headers, body: JSON.stringify({ error: "Plan generation produced invalid format. Try again." }) };
  }

  const planId = `plan-${new Date().toISOString()}`;
  const plan = {
    userId: userId,
    planId: planId,
    title: planData.title,
    goal: planData.goal,
    createdAt: new Date().toISOString(),
    weeks: planData.weeks.map(w => ({
      ...w,
      workouts: w.workouts.map(wk => ({ ...wk, completed: false }))
    }))
  };

  const existing = await client.send(new QueryCommand({
    TableName: PLANS_TABLE,
    KeyConditionExpression: "userId = :uid",
    ExpressionAttributeValues: marshall({ ":uid": userId }),
    ProjectionExpression: "userId, planId"
  }));

  for (const item of existing.Items || []) {
    const unmarshalledItem = unmarshall(item);
    await client.send(new DeleteItemCommand({
      TableName: PLANS_TABLE,
      Key: marshall({
        userId: unmarshalledItem.userId,
        planId: unmarshalledItem.planId
      })
    }));
  }

  await client.send(new PutItemCommand({
    TableName: PLANS_TABLE,
    Item: marshall(plan)
  }));

  return { statusCode: 201, headers, body: JSON.stringify(plan) };
}

async function getPlan(headers, userId) {
  const result = await client.send(new QueryCommand({
    TableName: PLANS_TABLE,
    KeyConditionExpression: "userId = :uid",
    ExpressionAttributeValues: marshall({ ":uid": userId }),
    ScanIndexForward: false,
    Limit: 1
  }));

  if (!result.Items || result.Items.length === 0) {
    return { statusCode: 200, headers, body: JSON.stringify(null) };
  }

  return { statusCode: 200, headers, body: JSON.stringify(unmarshall(result.Items[0])) };
}

async function toggleWorkout(event, headers, userId) {
  const body = JSON.parse(event.body);
  const { planId, workoutId, completed } = body;

  if (!planId || !workoutId || typeof completed !== "boolean") {
    return { statusCode: 400, headers, body: JSON.stringify({ error: "Missing required fields: planId, workoutId, completed" }) };
  }

  const result = await client.send(new QueryCommand({
    TableName: PLANS_TABLE,
    KeyConditionExpression: "userId = :uid AND planId = :pid",
    ExpressionAttributeValues: marshall({ ":uid": userId, ":pid": planId })
  }));

  if (!result.Items || result.Items.length === 0) {
    return { statusCode: 404, headers, body: JSON.stringify({ error: "Plan not found" }) };
  }

  const plan = unmarshall(result.Items[0]);

  let found = false;
  for (const week of plan.weeks) {
    for (const workout of week.workouts) {
      if (workout.workoutId === workoutId) {
        workout.completed = completed;
        found = true;
        break;
      }
    }
    if (found) break;
  }

  if (!found) {
    return { statusCode: 404, headers, body: JSON.stringify({ error: "Workout not found in plan" }) };
  }

  await client.send(new PutItemCommand({
    TableName: PLANS_TABLE,
    Item: marshall(plan)
  }));

  return { statusCode: 200, headers, body: JSON.stringify(plan) };
}

async function deletePlan(headers, userId) {
  const existing = await client.send(new QueryCommand({
    TableName: PLANS_TABLE,
    KeyConditionExpression: "userId = :uid",
    ExpressionAttributeValues: marshall({ ":uid": userId }),
    ProjectionExpression: "userId, planId"
  }));

  for (const item of existing.Items || []) {
    const unmarshalledItem = unmarshall(item);
    await client.send(new DeleteItemCommand({
      TableName: PLANS_TABLE,
      Key: marshall({
        userId: unmarshalledItem.userId,
        planId: unmarshalledItem.planId
      })
    }));
  }

  return { statusCode: 200, headers, body: JSON.stringify({ message: "Plan deleted" }) };
}
async function getStravaAuthUrl(event, headers, userId) {
  const redirectUri = "http://localhost:5173/strava-callback";
  const scope = "read,activity:read_all";
  const state = userId;

  const authUrl = `https://www.strava.com/oauth/authorize?client_id=${STRAVA_CLIENT_ID}&redirect_uri=${encodeURIComponent(redirectUri)}&response_type=code&scope=${scope}&state=${state}&approval_prompt=auto`;

  return { statusCode: 200, headers, body: JSON.stringify({ authUrl }) };
}

async function exchangeStravaCode(event, headers, userId) {
  const body = JSON.parse(event.body);
  const { code } = body;

  if (!code) {
    return { statusCode: 400, headers, body: JSON.stringify({ error: "Missing code" }) };
  }

  const tokenResponse = await fetch("https://www.strava.com/api/v3/oauth/token", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      client_id: STRAVA_CLIENT_ID,
      client_secret: STRAVA_CLIENT_SECRET,
      code: code,
      grant_type: "authorization_code"
    })
  });

  if (!tokenResponse.ok) {
    const errorText = await tokenResponse.text();
    console.error("Strava token exchange error:", errorText);
    return { statusCode: 500, headers, body: JSON.stringify({ error: "Failed to exchange code with Strava" }) };
  }

  const tokens = await tokenResponse.json();

  const item = {
    userId: userId,
    accessToken: tokens.access_token,
    refreshToken: tokens.refresh_token,
    expiresAt: tokens.expires_at,
    athleteId: tokens.athlete?.id?.toString() || "",
    athleteName: tokens.athlete ? `${tokens.athlete.firstname} ${tokens.athlete.lastname}` : "",
    connectedAt: new Date().toISOString()
  };

  await client.send(new PutItemCommand({
    TableName: STRAVA_TABLE,
    Item: marshall(item)
  }));

  return {
    statusCode: 200,
    headers,
    body: JSON.stringify({
      message: "Strava connected!",
      athleteName: item.athleteName
    })
  };
}

async function getStravaStatus(headers, userId) {
  const result = await client.send(new QueryCommand({
    TableName: STRAVA_TABLE,
    KeyConditionExpression: "userId = :uid",
    ExpressionAttributeValues: marshall({ ":uid": userId }),
    Limit: 1
  }));

  if (!result.Items || result.Items.length === 0) {
    return { statusCode: 200, headers, body: JSON.stringify({ connected: false }) };
  }

  const tokens = unmarshall(result.Items[0]);
  return {
    statusCode: 200,
    headers,
    body: JSON.stringify({
      connected: true,
      athleteName: tokens.athleteName,
      connectedAt: tokens.connectedAt
    })
  };
}

async function refreshStravaToken(userId, currentTokens) {
  const nowSeconds = Math.floor(Date.now() / 1000);

  if (currentTokens.expiresAt > nowSeconds + 60) {
    return currentTokens.accessToken;
  }

  const refreshResponse = await fetch("https://www.strava.com/api/v3/oauth/token", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      client_id: STRAVA_CLIENT_ID,
      client_secret: STRAVA_CLIENT_SECRET,
      refresh_token: currentTokens.refreshToken,
      grant_type: "refresh_token"
    })
  });

  if (!refreshResponse.ok) {
    throw new Error("Failed to refresh Strava token");
  }

  const newTokens = await refreshResponse.json();

  const updatedItem = {
    ...currentTokens,
    accessToken: newTokens.access_token,
    refreshToken: newTokens.refresh_token,
    expiresAt: newTokens.expires_at
  };

  await client.send(new PutItemCommand({
    TableName: STRAVA_TABLE,
    Item: marshall(updatedItem)
  }));

  return newTokens.access_token;
}

async function syncStravaActivities(event, headers, userId) {
  const tokenResult = await client.send(new QueryCommand({
    TableName: STRAVA_TABLE,
    KeyConditionExpression: "userId = :uid",
    ExpressionAttributeValues: marshall({ ":uid": userId }),
    Limit: 1
  }));

  if (!tokenResult.Items || tokenResult.Items.length === 0) {
    return { statusCode: 400, headers, body: JSON.stringify({ error: "Strava not connected" }) };
  }

  const tokens = unmarshall(tokenResult.Items[0]);
  const accessToken = await refreshStravaToken(userId, tokens);

  const thirtyDaysAgo = Math.floor((Date.now() - 30 * 24 * 60 * 60 * 1000) / 1000);
  const activitiesResponse = await fetch(
    `https://www.strava.com/api/v3/athlete/activities?after=${thirtyDaysAgo}&per_page=50`,
    {
      headers: { Authorization: `Bearer ${accessToken}` }
    }
  );

  if (!activitiesResponse.ok) {
    const errorText = await activitiesResponse.text();
    console.error("Strava activities fetch error:", errorText);
    return { statusCode: 500, headers, body: JSON.stringify({ error: "Failed to fetch activities from Strava" }) };
  }

  const activities = await activitiesResponse.json();
  const runs = activities.filter(a => a.type === "Run" || a.sport_type === "Run");

  const existingRunsResult = await client.send(new QueryCommand({
    TableName: RUNS_TABLE,
    KeyConditionExpression: "userId = :uid",
    ExpressionAttributeValues: marshall({ ":uid": userId })
  }));
  const existingRuns = (existingRunsResult.Items || []).map(i => unmarshall(i));
  const existingStravaIds = new Set(
    existingRuns
      .filter(r => r.stravaId)
      .map(r => r.stravaId.toString())
  );

  let newCount = 0;
  for (const activity of runs) {
    const stravaIdStr = activity.id.toString();
    if (existingStravaIds.has(stravaIdStr)) {
      continue;
    }

    const distanceKm = (activity.distance / 1000).toFixed(2);
    const totalSeconds = activity.moving_time;
    const minutes = Math.floor(totalSeconds / 60);
    const seconds = totalSeconds % 60;
    const durationStr = `${minutes}:${seconds.toString().padStart(2, "0")}`;
    const dateStr = activity.start_date_local.split("T")[0];

    const item = {
      userId: userId,
      runId: new Date().toISOString() + "-" + stravaIdStr,
      stravaId: stravaIdStr,
      title: activity.name || "Strava run",
      date: dateStr,
      distance: `${distanceKm} km`,
      duration: durationStr,
      notes: "",
      source: "strava"
    };

    await client.send(new PutItemCommand({
      TableName: RUNS_TABLE,
      Item: marshall(item)
    }));
    newCount++;
  }

  return {
    statusCode: 200,
    headers,
    body: JSON.stringify({
      message: `Synced ${newCount} new run${newCount !== 1 ? "s" : ""} from Strava`,
      newCount,
      totalActivitiesChecked: runs.length
    })
  };
}