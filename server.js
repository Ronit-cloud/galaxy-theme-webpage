require('dotenv').config();

const path = require('path');
const crypto = require('crypto');
const express = require('express');
const cors = require('cors');
const {
  DynamoDBClient,
  DescribeTableCommand,
  CreateTableCommand,
  waitUntilTableExists,
} = require('@aws-sdk/client-dynamodb');
const { DynamoDBDocumentClient, PutCommand } = require('@aws-sdk/lib-dynamodb');

const PORT = process.env.PORT || 3000;
const REGION = process.env.AWS_REGION || 'us-east-1';
const TABLE = process.env.DYNAMODB_TABLE || 'GalaxyResponses';

// Credentials come from the standard AWS chain (.env, ~/.aws/credentials, IAM role...)
const client = new DynamoDBClient({ region: REGION });
const db = DynamoDBDocumentClient.from(client, {
  marshallOptions: { removeUndefinedValues: true },
});

const app = express();
const allowed = (process.env.ALLOWED_ORIGIN || '')
  .split(',').map((o) => o.trim().replace(/\/$/, '')).filter(Boolean);
app.use(cors(allowed.length ? { origin: allowed } : undefined));
app.use(express.json({ limit: '10kb' }));
app.use(express.static(path.join(__dirname, 'public')));

const GENDERS = ['Male', 'Female', 'Non-binary', 'Prefer not to say'];
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const PHONE_RE = /^\+?[\d\s\-().]{7,20}$/;

const isBlank = (v) => v === undefined || v === null || String(v).trim() === '';

// Every field is optional. Blank fields are dropped; filled fields are validated.
function validate(body) {
  const data = {};
  const errors = [];
  const b = body && typeof body === 'object' ? body : {};

  if (!isBlank(b.name)) {
    const v = String(b.name).trim();
    if (v.length > 100) errors.push('Name must be 100 characters or fewer.');
    else data.name = v;
  }

  if (!isBlank(b.age)) {
    const v = Number(b.age);
    if (!Number.isInteger(v) || v < 1 || v > 120) errors.push('Age must be a whole number between 1 and 120.');
    else data.age = v;
  }

  if (!isBlank(b.gender)) {
    const v = String(b.gender).trim();
    if (!GENDERS.includes(v)) errors.push('Gender must be one of the listed options.');
    else data.gender = v;
  }

  if (!isBlank(b.height)) {
    const v = Number(b.height);
    if (!Number.isFinite(v) || v < 30 || v > 272) errors.push('Height must be between 30 and 272 cm.');
    else data.heightCm = v;
  }

  if (!isBlank(b.email)) {
    const v = String(b.email).trim().toLowerCase();
    if (v.length > 254 || !EMAIL_RE.test(v)) errors.push('Email address is not valid.');
    else data.email = v;
  }

  if (!isBlank(b.phoneNumber)) {
    const v = String(b.phoneNumber).trim();
    if (!PHONE_RE.test(v)) errors.push('Phone number is not valid.');
    else data.phoneNumber = v;
  }

  if (!isBlank(b.hobby)) {
    const v = String(b.hobby).trim();
    if (v.length > 200) errors.push('Hobby must be 200 characters or fewer.');
    else data.hobby = v;
  }

  return { data, errors };
}

app.post('/api/responses', async (req, res) => {
  const { data, errors } = validate(req.body);

  if (errors.length) return res.status(400).json({ ok: false, errors });
  if (Object.keys(data).length === 0) {
    return res.status(400).json({ ok: false, errors: ['Answer at least one question before saving.'] });
  }

  const item = { id: crypto.randomUUID(), createdAt: new Date().toISOString(), ...data };

  try {
    await db.send(new PutCommand({ TableName: TABLE, Item: item }));
    res.status(201).json({ ok: true, id: item.id });
  } catch (err) {
    console.error('DynamoDB write failed:', err.name, err.message);
    res.status(500).json({ ok: false, errors: ['Could not save your answers right now. Please try again.'] });
  }
});

app.get('/api/health', (_req, res) => res.json({ ok: true, table: TABLE, region: REGION }));

// Create the table on first run if it doesn't exist (pay-per-request, key: id)
async function ensureTable() {
  try {
    await client.send(new DescribeTableCommand({ TableName: TABLE }));
    console.log(`DynamoDB table "${TABLE}" is ready (${REGION}).`);
  } catch (err) {
    if (err.name !== 'ResourceNotFoundException') {
      console.error(`Could not reach DynamoDB: ${err.name} - ${err.message}`);
      console.error('Check your AWS credentials, region and IAM permissions (see README).');
      return;
    }
    console.log(`Table "${TABLE}" not found. Creating it...`);
    try {
      await client.send(
        new CreateTableCommand({
          TableName: TABLE,
          AttributeDefinitions: [{ AttributeName: 'id', AttributeType: 'S' }],
          KeySchema: [{ AttributeName: 'id', KeyType: 'HASH' }],
          BillingMode: 'PAY_PER_REQUEST',
        })
      );
      await waitUntilTableExists({ client, maxWaitTime: 60 }, { TableName: TABLE });
      console.log(`Table "${TABLE}" created.`);
    } catch (createErr) {
      console.error(`Could not create table: ${createErr.name} - ${createErr.message}`);
    }
  }
}

app.listen(PORT, async () => {
  console.log(`Galaxy survey running at http://localhost:${PORT}`);
  await ensureTable();
});
