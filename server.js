const express = require('express');
const cors = require('cors');
const mongoose = require('mongoose');
const jwt = require('jsonwebtoken');
const bcrypt = require('bcryptjs');

const app = express();
app.use(cors());
app.use(express.json());

// ─── DB CONNECTION ────────────────────────────────────────────────────────────
mongoose.connect(process.env.MONGODB_URI).then(() => console.log('MongoDB connected'));

// ─── SCHEMAS ──────────────────────────────────────────────────────────────────
const UserSchema = new mongoose.Schema({
  name: String,
  email: { type: String, unique: true },
  password: String,
  createdAt: { type: Date, default: Date.now }
});
const User = mongoose.model('User', UserSchema);

const ClientSchema = new mongoose.Schema({
  userId: String,
  name: String,
  brand: String,
  website: String,
  adAccountId: String,
  accessToken: String,
  pageId: String,
  instagramId: String,
  pixelId: String,
  notes: String,
  createdAt: { type: Date, default: Date.now }
});
const Client = mongoose.model('Client', ClientSchema);

const CampaignLogSchema = new mongoose.Schema({
  userId: String,
  clientId: String,
  clientName: String,
  campaignId: String,
  adsetIds: [String],
  adIds: [String],
  name: String,
  objective: String,
  budget: Number,
  status: String,
  meta: Object,
  createdAt: { type: Date, default: Date.now }
});
const CampaignLog = mongoose.model('CampaignLog', CampaignLogSchema);

// ─── AUTH MIDDLEWARE ──────────────────────────────────────────────────────────
const auth = (req, res, next) => {
  const token = req.headers.authorization?.split(' ')[1];
  if (!token) return res.status(401).json({ error: 'No token' });
  try {
    req.user = jwt.verify(token, process.env.JWT_SECRET);
    next();
  } catch { res.status(401).json({ error: 'Invalid token' }); }
};

// ─── AUTH ROUTES ──────────────────────────────────────────────────────────────
app.post('/api/register', async (req, res) => {
  try {
    const { name, email, password } = req.body;
    if (!name || !email || !password) return res.status(400).json({ error: 'All fields required' });
    const exists = await User.findOne({ email });
    if (exists) return res.status(400).json({ error: 'Email already registered' });
    const hashed = await bcrypt.hash(password, 10);
    const user = await User.create({ name, email, password: hashed });
    const token = jwt.sign({ id: user._id, name: user.name, email: user.email }, process.env.JWT_SECRET, { expiresIn: '30d' });
    res.json({ token, user: { id: user._id, name: user.name, email: user.email } });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

app.post('/api/login', async (req, res) => {
  try {
    const { email, password } = req.body;
    const user = await User.findOne({ email });
    if (!user) return res.status(400).json({ error: 'Invalid credentials' });
    const valid = await bcrypt.compare(password, user.password);
    if (!valid) return res.status(400).json({ error: 'Invalid credentials' });
    const token = jwt.sign({ id: user._id, name: user.name, email: user.email }, process.env.JWT_SECRET, { expiresIn: '30d' });
    res.json({ token, user: { id: user._id, name: user.name, email: user.email } });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// ─── CLIENT ROUTES ────────────────────────────────────────────────────────────
app.get('/api/clients', auth, async (req, res) => {
  const clients = await Client.find({ userId: req.user.id }).sort({ createdAt: -1 });
  res.json(clients);
});

app.post('/api/clients', auth, async (req, res) => {
  try {
    const client = await Client.create({ ...req.body, userId: req.user.id });
    res.json(client);
  } catch (e) { res.status(500).json({ error: e.message }); }
});

app.put('/api/clients/:id', auth, async (req, res) => {
  try {
    const client = await Client.findOneAndUpdate(
      { _id: req.params.id, userId: req.user.id },
      req.body,
      { new: true }
    );
    res.json(client);
  } catch (e) { res.status(500).json({ error: e.message }); }
});

app.delete('/api/clients/:id', auth, async (req, res) => {
  await Client.findOneAndDelete({ _id: req.params.id, userId: req.user.id });
  res.json({ success: true });
});

// ─── AI COPY GENERATION ───────────────────────────────────────────────────────
app.post('/api/generate-copy', auth, async (req, res) => {
  const { brand, benefit, offer, audience, tone, cta, numVariants = 3 } = req.body;
  const prompt = `You are an elite Meta ads copywriter for DTC ecommerce brands in India.
Generate exactly ${numVariants} ad variants for this brief:

Brand/Product: ${brand}
Key Benefit: ${benefit}
Offer: ${offer}
Target Audience: ${audience || 'broad ecommerce shoppers India'}
Tone: ${tone || 'Direct and punchy'}
CTA: ${cta || 'Shop Now'}

Return ONLY a valid JSON array with exactly ${numVariants} objects. Each object must have:
- "headline": string, max 40 chars, punchy hook
- "primaryText": string, 2-3 sentences, leads with problem/desire then offer
- "angle": string, exactly 3 words describing the creative angle
- "score": string like "8.7/10" estimating ROAS potential
- "isHot": boolean, true for top 2 variants only

Raw JSON only. No markdown, no explanation, no backticks.`;

  try {
    const response = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': process.env.ANTHROPIC_API_KEY,
        'anthropic-version': '2023-06-01'
      },
      body: JSON.stringify({
        model: 'claude-sonnet-4-20250514',
        max_tokens: 2000,
        messages: [{ role: 'user', content: prompt }]
      })
    });
    const data = await response.json();
    if (data.error) throw new Error(data.error.message);
    const raw = data.content.map(c => c.text || '').join('').replace(/```json|```/g, '').trim();
    const variants = JSON.parse(raw);
    res.json({ variants });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// ─── META API HELPER ──────────────────────────────────────────────────────────
const META_API = 'https://graph.facebook.com/v21.0';

async function metaPost(path, token, body) {
  const url = `${META_API}${path}`;
  const form = new URLSearchParams({ access_token: token, ...body });
  const res = await fetch(url, { method: 'POST', body: form });
  const data = await res.json();
  if (data.error) {
    const msg = `Meta API Error ${data.error.code}: ${data.error.message}`;
    throw new Error(msg);
  }
  return data;
}

async function metaGet(path, token, params = {}) {
  const qs = new URLSearchParams({ access_token: token, ...params });
  const res = await fetch(`${META_API}${path}?${qs}`);
  const data = await res.json();
  if (data.error) throw new Error(data.error.message);
  return data;
}

// ─── CAMPAIGN LAUNCH ──────────────────────────────────────────────────────────
app.post('/api/launch-campaign', auth, async (req, res) => {
  const {
    clientId,
    campaignName,
    adsetDailyBudget,   // per-adset budget in INR (e.g. 999)
    numAdsets = 3,
    copies,             // array of {headline, primaryText}
    targeting,          // { ageMin, ageMax, genders, countries, interests }
    pageId,
    instagramId,
    pixelId,
    imageHash,          // optional, if they have an image
    websiteUrl,
    accessToken,        // can override client token
    adAccountId         // can override client adAccountId
  } = req.body;

  try {
    // Resolve client credentials
    let token = accessToken;
    let actId = adAccountId;
    let pgId = pageId;

    if (clientId) {
      const client = await Client.findOne({ _id: clientId, userId: req.user.id });
      if (client) {
        token = token || client.accessToken;
        actId = actId || client.adAccountId;
        pgId = pgId || client.pageId;
      }
    }

    if (!token) throw new Error('No access token provided');
    if (!actId) throw new Error('No ad account ID provided');

    const accountPath = `/act_${actId.replace('act_', '')}`;
    const budgetPaise = Math.round(adsetDailyBudget * 100); // Meta uses cents/paise

    // ── STEP 1: Create Campaign (no budget at campaign level for ABO) ──
    const campaign = await metaPost(`${accountPath}/campaigns`, token, {
      name: campaignName,
      objective: 'OUTCOME_SALES',
      status: 'PAUSED',
      special_ad_categories: '[]'
    });
    const campaignId = campaign.id;

    // ── STEP 2: Build targeting spec ──
    const { ageMin = 18, ageMax = 65, genders = [], countries = ['IN'], interests = [] } = targeting || {};
    const targetingSpec = {
      age_min: ageMin,
      age_max: ageMax,
      geo_locations: JSON.stringify({ countries }),
    };
    if (genders.length) targetingSpec.genders = JSON.stringify(genders);
    if (interests.length) targetingSpec.flexible_spec = JSON.stringify([{ interests }]);

    // ── STEP 3: Create Ad Sets (one per targeting variation) ──
    const adsetIds = [];
    for (let i = 0; i < numAdsets; i++) {
      const adset = await metaPost(`${accountPath}/adsets`, token, {
        name: `${campaignName} - AdSet ${i + 1}`,
        campaign_id: campaignId,
        daily_budget: budgetPaise,
        billing_event: 'IMPRESSIONS',
        optimization_goal: 'OFFSITE_CONVERSIONS',
        status: 'PAUSED',
        start_time: Math.floor(Date.now() / 1000),
        ...targetingSpec,
        ...(pixelId ? {
          promoted_object: JSON.stringify({
            pixel_id: pixelId,
            custom_event_type: 'PURCHASE'
          })
        } : {})
      });
      adsetIds.push(adset.id);
    }

    // ── STEP 4: Create Ads (one per copy variant per adset) ──
    const adIds = [];
    for (const adsetId of adsetIds) {
      for (let j = 0; j < Math.min(copies.length, 3); j++) {
        const copy = copies[j];

        // Build creative object
        const objectStory = {
          page_id: pgId,
          link_data: {
            message: copy.primaryText,
            link: websiteUrl || 'https://facebook.com',
            name: copy.headline,
            call_to_action: { type: 'SHOP_NOW', value: { link: websiteUrl || 'https://facebook.com' } }
          }
        };
        if (imageHash) objectStory.link_data.image_hash = imageHash;
        if (instagramId) objectStory.instagram_user_id = instagramId;

        const creative = await metaPost(`${accountPath}/adcreatives`, token, {
          name: `Creative - ${copy.headline.substring(0, 30)}`,
          object_story_spec: JSON.stringify(objectStory)
        });

        const ad = await metaPost(`${accountPath}/ads`, token, {
          name: `${campaignName} - Ad ${j + 1}`,
          adset_id: adsetId,
          creative: JSON.stringify({ creative_id: creative.id }),
          status: 'PAUSED'
        });
        adIds.push(ad.id);
      }
    }

    // ── STEP 5: Log to DB ──
    await CampaignLog.create({
      userId: req.user.id,
      clientId,
      campaignId,
      adsetIds,
      adIds,
      name: campaignName,
      objective: 'OUTCOME_SALES',
      budget: adsetDailyBudget * numAdsets,
      status: 'PAUSED',
      meta: { numAdsets, numAds: adIds.length }
    });

    res.json({
      success: true,
      campaignId,
      adsetIds,
      adIds,
      summary: {
        campaign: campaignName,
        adsets: adsetIds.length,
        ads: adIds.length,
        totalDailyBudget: `₹${adsetDailyBudget * numAdsets}/day`,
        status: 'PAUSED — ready to review in Ads Manager'
      }
    });

  } catch (e) {
    console.error('Launch error:', e.message);
    res.status(400).json({ error: e.message });
  }
});

// ─── REPORTING ────────────────────────────────────────────────────────────────
app.post('/api/report', auth, async (req, res) => {
  const { adAccountId, accessToken, datePreset = 'last_7d', level = 'campaign' } = req.body;
  try {
    let token = accessToken;
    let actId = adAccountId;

    const accountPath = `/act_${actId.replace('act_', '')}`;
    const data = await metaGet(`${accountPath}/insights`, token, {
      level,
      date_preset: datePreset,
      fields: 'campaign_name,adset_name,ad_name,spend,impressions,clicks,ctr,cpm,actions,action_values,purchase_roas,frequency',
      limit: 50
    });
    res.json(data);
  } catch (e) { res.status(400).json({ error: e.message }); }
});

// ─── CAMPAIGN LOGS ────────────────────────────────────────────────────────────
app.get('/api/campaign-logs', auth, async (req, res) => {
  const logs = await CampaignLog.find({ userId: req.user.id }).sort({ createdAt: -1 }).limit(50);
  res.json(logs);
});

// ─── HEALTH ───────────────────────────────────────────────────────────────────
app.get('/health', (req, res) => res.json({ status: 'ok', version: '2.1' }));

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`Perfomity Cowork v2.1 running on port ${PORT}`));
