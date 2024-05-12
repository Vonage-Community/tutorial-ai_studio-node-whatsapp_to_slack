// Import required modules
require('dotenv').config();
const express = require('express');
const axios = require('axios');
const bodyParser = require('body-parser');



// Create an Express application
const app = express();
const PORT = process.env.PORT || 3000;

// Import our secure ENV variables
const SLACK_WEBHOOK_URL = process.env.SLACK_WEBHOOK_URL;
const AI_STUDIO_KEY = process.env.AI_STUDIO_KEY;


// Middleware to parse JSON requests
app.use(express.json());

// Middleware to parse requests from Slack
const urlencodedParser = bodyParser.urlencoded({ extended: false })

// Global variable to correlate AI Studio sessions and Slack threads
const SESSIONS = {};

// Define the /start endpoint
app.post('/start', (req, res) => {
  const sessionId = req.body.sessionId;
  const transcription = handleTranscription(req.body.history.transcription);
  const data = { text: `Session: \`${sessionId}\`\nTranscription:${transcription}`, }
  axios.post(SLACK_WEBHOOK_URL, data)
  res.send('Start endpoint reached');
});


// Define the /inbound endpoint
app.post('/inbound', (req, res) => {
  const message = req.body.text
  const session_id = req.body.sessionId;
  const thread_ts = SESSIONS[session_id].thread_ts;
  const data = {
    "thread_ts": thread_ts,
    "text": `Customer respsonse: \`\`\`${message}\`\`\``
  }
  axios.post(SLACK_WEBHOOK_URL, data);
  res.send('Inbound endpoint reached');
});


// Define the /slack/start endpoint
app.post('/slack/start', urlencodedParser, function (req, res) {
  console.log("Hit the endpoint");
  const response = JSON.parse(req.body.payload);
  const thread_ts = response.message.ts;
  const session_id = extractSessionId(response.message.text);
  newSession(session_id, thread_ts);
  const data = {
    "thread_ts": thread_ts,
    "text": `Session seen by <@${response.user.id}>`
  }
  axios.post(SLACK_WEBHOOK_URL, data);
  res.send("Begin initiated");
})

// Define the /slack/message endpoint
app.post('/slack/message', urlencodedParser, function (req, res) {
  const response = req.body;
  const agentResponse = parseMessage(req.body.text);
  const session_id = agentResponse['sessionId'];
  const message = agentResponse['message'];
  const studio_data = { message_type: 'text', text: message };
  const thread_ts = SESSIONS[session_id].thread_ts;
  const slack_data = {
    "thread_ts": thread_ts,
    "text": `Response sent by <@${response.user_id}> \`\`\`${message}\`\`\``,
  }
  axios.post(`https://studio-api-eu.ai.vonage.com/live-agent/outbound/${session_id}`, studio_data, {
    headers: { 'X-Vgai-Key': AI_STUDIO_KEY }
  })
  axios.post(SLACK_WEBHOOK_URL, slack_data);
  res.send("Response sent to user")
})


app.post('/slack/end', urlencodedParser, function (req, res) {
  const agentResponse = parseMessage(req.body.text);
  const session_id = agentResponse['sessionId'];
  const data = {};
  axios.post(`https://studio-api-eu.ai.vonage.com/live-agent/disconnect/${session_id}`, data, {
    headers: { 'X-Vgai-Key': AI_STUDIO_KEY }
  })
  const thread_ts = SESSIONS[session_id].thread_ts;
  const slack_data = {
    "thread_ts": thread_ts,
    "text": `This conversation has been marked as resolved.`,
  }
  axios.post(SLACK_WEBHOOK_URL, slack_data);
  res.send("Conversation ended")
})


// Start the server
app.listen(PORT, () => {
  console.log(`Server is running on port ${PORT}`);
});

// We'll add our function declarations below here
const handleTranscription = (transcription = []) => {
  if (!transcription.length) return null;

  let strTrans = '```';

  for (const message of transcription) {
    for (const key in message) {
      strTrans += `\n${key}: ${message[key]}`;
    }
  }

  strTrans += '```';
  console.log(strTrans);
  return strTrans;
};

const extractSessionId = (input) => {
  const sessionIdPattern = /Session: `([0-9a-f\-]{36})`/i;
  const match = input.match(sessionIdPattern);

  if (match && match[1]) {
    return match[1];
  }

  return null;
};

const newSession = (session_id, message_ts) => {
  SESSIONS[session_id] = {
    "session_id": session_id,
    "thread_ts": message_ts
  }
}

const parseMessage = (input) => {
  const [sessionId, ...messageParts] = input.split(' ');
  const message = messageParts.join(' ');

  // Check if the first part is a valid session ID format
  const sessionIdPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
  if (sessionIdPattern.test(sessionId)) {
    return { sessionId, message };
  }

  // If the first part is not a valid session ID, treat the entire input as a message
  return { message: input };
};
