require('dotenv').config();
const express = require('express');
const cors = require('cors');
const mongoose = require('mongoose');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const axios = require('axios');

const app = express();
app.use(cors());
app.use(express.json({ limit: '50mb' }));

// ─── DB CONNECTION ────────────────────────────────────────────────────────────
mongoose.connect(process.env.MONGODB_URI)
  .then(() => console.log('MongoDB connected'))
  .catch(err => console.error('MongoDB error:', err));

// ─── SCHEMAS ──────────────────────────────────────────────────────────────────
const UserSchema = new mongoose.Schema({
  name: String,
  email: { type: String, unique: true },
  password: String,
  role: { type: String, default: 'admin' },
  createdAt: { type: Date, default: Date.now }
});

const ClientSchema = new mongoose.Schema({
  userId: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
  name: String,
  brand: String,
  adAccountId: String,
  metaAccessToken: String,
  pixelId: String,
  pageId: String,
  facebookPageId: String,
  instagramActorId: String,
  logoUrl: String,
  notes: String,
  active: { type: Boolean, default: true },
  createdAt: { type: Date, default: Date.now }
});

const CampaignSchema = new mongoose.Schema({
  userId: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
  clientId: { type: mongoose.Schema.Types.ObjectId, ref: 'Client' },
  clientName: String,
  name: String,
  metaCampaignId: String,
  objective: String,
  status: String,
  budgetType: String,
  totalBudget: Number,
  adsets: [{
    name: String,
    metaAdsetId: String,
    targeting: Object,
    budget: Number,
    ads: [{
      name: String,
      metaAdId: String,
      headline: String,
      primaryText: String,
      description: String,
      creativeUrl: String,
      metaCreativeId: String
    }]
  }],
  metrics: {
    spend: { type: Number, default: 0 },
    impressions: { type: Number, default: 0 },
    clicks: { type: Number, default: 0 },
    purchases: { type: Number, default: 0 },
    revenue: { type: Number, default: 0 },
    roas: { type: Number, default: 0 },
    cpa: { type: Number, default: 0 },
    ctr: { type: Number, default: 0 },
    cpm: { type: Number, default: 0 }
  },
  lastSynced: Date,
  createdAt: { type: Date, default: Date.now }
});

const AdCopySchema = new mongoose.Schema({
  userId: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
  clientId: { type: mongoose.Schema.Types.ObjectId, ref: 'Client' },
  brief: Object,
  variants: Array,
  createdAt: { type: Date, default: Date.now }
});

const User = mongoose.model('User', UserSchema);
const Client = mongoose.model('Client', ClientSchema);
const Campaign = mongoose.model('Campaign', CampaignSchema);
const AdCopy = mongoose.model('AdCopy', AdCopySchema);

// ─── AUTH MIDDLEWARE ──────────────────────────────────────────────────────────
const auth = async (req, res, next) => {
  try {
    const token = req.headers.authorization?.split(' ')[1];
    if (!token) return res.status(401).json({ error: 'No token' });
    const decoded = jwt.verify(token, process.env.JWT_SECRET);
    req.userId = decoded.userId;
    next();
  } catch {
    res.status(401).json({ error: 'Invalid token' });
  }
};

// ─── AUTH ROUTES ──────────────────────────────────────────────────────────────
app.post('/api/auth/register', async (req, res) => {
  try {
    const { name, email, password } = req.body;
    const exists = await User.findOne({ email });
    if (exists) return res.status(400).json({ error: 'Email already registered' });
    const hashed = await bcrypt.hash(password, 10);
    const user = await User.create({ name, email, password: hashed });
    const token = jwt.sign({ userId: user._id }, process.env.JWT_SECRET, { expiresIn: '30d' });
    res.json({ token, user: { id: user._id, name: user.name, email: user.email } });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.post('/api/auth/login', async (req, res) => {
  try {
    const { email, password } = req.body;
    const user = await User.findOne({ email });
    if (!user) return res.status(400).json({ error: 'Invalid credentials' });
    const valid = await bcrypt.compare(password, user.password);
    if (!valid) return res.status(400).json({ error: 'Invalid credentials' });
    const token = jwt.sign({ userId: user._id }, process.env.JWT_SECRET, { expiresIn: '30d' });
    res.json({ token, user: { id: user._id, name: user.name, email: user.email } });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.get('/api/auth/me', auth, async (req, res) => {
  const user = await User.findById(req.userId).select('-password');
  res.json(user);
});

// ─── CLIENT ROUTES ────────────────────────────────────────────────────────────
app.get('/api/clients', auth, async (req, res) => {
  const clients = await Client.find({ userId: req.userId }).sort('-createdAt');
  res.json(clients);
});

app.post('/api/clients', auth, async (req, res) => {
  try {
    const client = await Client.create({ ...req.body, userId: req.userId });
    res.json(client);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.put('/api/clients/:id', auth, async (req, res) => {
  try {
    const client = await Client.findOneAndUpdate(
      { _id: req.params.id, userId: req.userId },
      req.body,
      { new: true }
    );
    res.json(client);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.delete('/api/clients/:id', auth, async (req, res) => {
  await Client.findOneAndDelete({ _id: req.params.id, userId: req.userId });
  res.json({ success: true });
});

// ─── AI COPY GENERATION ───────────────────────────────────────────────────────
app.post('/api/generate', auth, async (req, res) => {
  const { brand, benefit, offer, audience, tone, cta, count = 3 } = req.body;
  if (!brand || !benefit || !offer) return res.status(400).json({ error: 'brand, benefit and offer required' });

  const prompt = `You are an elite Meta ads copywriter for DTC ecommerce brands in India.
Generate exactly ${count} ad variants for this brief:

Brand/Product: ${brand}
Key Benefit: ${benefit}
Offer: ${offer}
Target Audience: ${audience || 'Indian online shoppers'}
Tone: ${tone || 'Direct and punchy'}
CTA: ${cta || 'Shop Now'}

Return ONLY a valid JSON array with exactly ${count} objects. Each object must have:
- "headline": string, max 40 chars
- "primaryText": string, max 125 chars  
- "description": string, max 30 chars, short punchy tagline
- "angle": string, exactly 3 words
- "score": string like "8.7/10"
- "isHot": boolean, true for top ${Math.ceil(count/2)} variants

Raw JSON only. No markdown, no explanation.`;

  try {
    const response = await axios.post('https://api.anthropic.com/v1/messages', {
      model: 'claude-sonnet-4-20250514',
      max_tokens: 2000,
      messages: [{ role: 'user', content: prompt }]
    }, {
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': process.env.ANTHROPIC_API_KEY,
        'anthropic-version': '2023-06-01'
      }
    });

    const raw = response.data.content.map(c => c.text || '').join('').replace(/```json|```/g, '').trim();
    const variants = JSON.parse(raw);

    await AdCopy.create({ userId: req.userId, brief: req.body, variants });
    res.json({ variants });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ─── META API HELPERS ─────────────────────────────────────────────────────────
const metaPost = async (endpoint, data, token) => {
  const url = `https://graph.facebook.com/v20.0${endpoint}`;
  const response = await axios.post(url, { ...data, access_token: token }, {
    headers: { 'Content-Type': 'application/json' }
  });
  if (response.data.error) throw new Error(response.data.error.message);
  return response.data;
};

const metaGet = async (endpoint, params, token) => {
  const url = `https://graph.facebook.com/v20.0${endpoint}`;
  const response = await axios.get(url, { params: { ...params, access_token: token } });
  if (response.data.error) throw new Error(response.data.error.message);
  return response.data;
};

// ─── CAMPAIGN LAUNCH ──────────────────────────────────────────────────────────
app.post('/api/campaigns/launch', auth, async (req, res) => {
  const {
    clientId, campaignName, objective, budgetType, totalBudget,
    adsets, copies, landingUrl, driveImageUrl
  } = req.body;

  try {
    const client = await Client.findOne({ _id: clientId, userId: req.userId });
    if (!client) return res.status(404).json({ error: 'Client not found' });

    const token = client.metaAccessToken;
    const cleanAccountId = client.adAccountId.replace('act_', '');
    const perAdsetBudget = Math.floor(totalBudget / adsets.length) * 100;

    const isSales = objective === 'OUTCOME_SALES';
    const isTraffic = objective === 'OUTCOME_TRAFFIC';

    // 1. CREATE CAMPAIGN
    const campPayload = {
      name: campaignName,
      objective,
      status: 'PAUSED',
      special_ad_categories: ['NONE'],
      is_adset_budget_sharing_enabled: budgetType === 'CBO'
    };
    if (budgetType === 'CBO') campPayload.daily_budget = totalBudget * 100;

    const camp = await metaPost(`/act_${cleanAccountId}/campaigns`, campPayload, token);

    const createdAdsets = [];

    for (const adsetConfig of adsets) {
      // 2. CREATE ADSET
      const adsetPayload = {
        name: adsetConfig.name,
        campaign_id: camp.id,
        billing_event: 'IMPRESSIONS',
        optimization_goal: isSales && client.pixelId ? 'OFFSITE_CONVERSIONS' : 'LINK_CLICKS',
        targeting: adsetConfig.targeting,
        status: 'PAUSED'
      };

      if (!isSales || !client.pixelId) adsetPayload.bid_amount = 100;
      if (budgetType === 'ABO') adsetPayload.daily_budget = perAdsetBudget;
      if (isSales && client.pixelId) {
        adsetPayload.promoted_object = {
          pixel_id: client.pixelId,
          custom_event_type: req.body.conversionEvent || 'PURCHASE'
        };
      }

      const adset = await metaPost(`/act_${cleanAccountId}/adsets`, adsetPayload, token);

      const createdAds = [];

      // 3. CREATE ADS (one per copy variant)
      for (let i = 0; i < copies.length; i++) {
        const copy = copies[i];
        const adName = `${campaignName} | ${adsetConfig.name} | Ad ${i + 1}`;

        try {
          // Create ad creative
          const creativePayload = {
            name: adName + ' Creative',
            object_story_spec: {
              page_id: client.pageId || client.facebookPageId,
              link_data: {
                link: landingUrl,
                message: copy.primaryText,
                name: copy.headline,
                description: copy.description || '',
                call_to_action: {
                  type: req.body.ctaType || 'SHOP_NOW',
                  value: { link: landingUrl }
                }
              }
            }
          };

          // Add image if Drive URL provided
          if (driveImageUrl) {
            creativePayload.object_story_spec.link_data.picture = driveImageUrl;
          }

          const creative = await metaPost(`/act_${cleanAccountId}/adcreatives`, creativePayload, token);

          // Create the ad
          const ad = await metaPost(`/act_${cleanAccountId}/ads`, {
            name: adName,
            adset_id: adset.id,
            creative: { creative_id: creative.id },
            status: 'PAUSED'
          }, token);

          createdAds.push({
            name: adName,
            metaAdId: ad.id,
            metaCreativeId: creative.id,
            headline: copy.headline,
            primaryText: copy.primaryText,
            description: copy.description
          });
        } catch (adErr) {
          console.error(`Ad ${i + 1} failed:`, adErr.message);
          createdAds.push({ name: adName, error: adErr.message });
        }
      }

      createdAdsets.push({
        name: adsetConfig.name,
        metaAdsetId: adset.id,
        targeting: adsetConfig.targeting,
        budget: perAdsetBudget / 100,
        ads: createdAds
      });
    }

    // 4. SAVE TO DB
    const campaign = await Campaign.create({
      userId: req.userId,
      clientId,
      clientName: client.name,
      name: campaignName,
      metaCampaignId: camp.id,
      objective,
      status: 'PAUSED',
      budgetType,
      totalBudget,
      adsets: createdAdsets
    });

    res.json({ success: true, campaign, metaCampaignId: camp.id });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ─── CAMPAIGN LIST ────────────────────────────────────────────────────────────
app.get('/api/campaigns', auth, async (req, res) => {
  const { clientId } = req.query;
  const filter = { userId: req.userId };
  if (clientId) filter.clientId = clientId;
  const campaigns = await Campaign.find(filter).sort('-createdAt');
  res.json(campaigns);
});

app.get('/api/campaigns/:id', auth, async (req, res) => {
  const campaign = await Campaign.findOne({ _id: req.params.id, userId: req.userId });
  if (!campaign) return res.status(404).json({ error: 'Not found' });
  res.json(campaign);
});

// ─── REPORTING — SYNC METRICS FROM META ──────────────────────────────────────
app.post('/api/campaigns/:id/sync', auth, async (req, res) => {
  try {
    const campaign = await Campaign.findOne({ _id: req.params.id, userId: req.userId });
    if (!campaign) return res.status(404).json({ error: 'Not found' });

    const client = await Client.findById(campaign.clientId);
    const token = client.metaAccessToken;

    const data = await metaGet(`/${campaign.metaCampaignId}/insights`, {
      fields: 'spend,impressions,clicks,actions,action_values,cpm,ctr',
      date_preset: 'lifetime'
    }, token);

    if (data.data && data.data.length > 0) {
      const d = data.data[0];
      const purchases = d.actions?.find(a => a.action_type === 'purchase')?.value || 0;
      const revenue = d.action_values?.find(a => a.action_type === 'purchase')?.value || 0;
      const spend = parseFloat(d.spend || 0);

      campaign.metrics = {
        spend,
        impressions: parseInt(d.impressions || 0),
        clicks: parseInt(d.clicks || 0),
        purchases: parseInt(purchases),
        revenue: parseFloat(revenue),
        roas: spend > 0 ? parseFloat(revenue) / spend : 0,
        cpa: parseInt(purchases) > 0 ? spend / parseInt(purchases) : 0,
        ctr: parseFloat(d.ctr || 0),
        cpm: parseFloat(d.cpm || 0)
      };
      campaign.lastSynced = new Date();
      await campaign.save();
    }

    res.json(campaign);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ─── REPORTING — DASHBOARD OVERVIEW ──────────────────────────────────────────
app.get('/api/reporting/overview', auth, async (req, res) => {
  try {
    const { clientId } = req.query;
    const filter = { userId: req.userId };
    if (clientId) filter.clientId = clientId;

    const campaigns = await Campaign.find(filter);

    const totals = campaigns.reduce((acc, c) => ({
      spend: acc.spend + (c.metrics?.spend || 0),
      revenue: acc.revenue + (c.metrics?.revenue || 0),
      impressions: acc.impressions + (c.metrics?.impressions || 0),
      clicks: acc.clicks + (c.metrics?.clicks || 0),
      purchases: acc.purchases + (c.metrics?.purchases || 0)
    }), { spend: 0, revenue: 0, impressions: 0, clicks: 0, purchases: 0 });

    totals.roas = totals.spend > 0 ? totals.revenue / totals.spend : 0;
    totals.ctr = totals.impressions > 0 ? (totals.clicks / totals.impressions) * 100 : 0;
    totals.cpa = totals.purchases > 0 ? totals.spend / totals.purchases : 0;

    res.json({
      totals,
      campaigns: campaigns.map(c => ({
        id: c._id,
        name: c.name,
        clientName: c.clientName,
        status: c.status,
        objective: c.objective,
        totalBudget: c.totalBudget,
        metrics: c.metrics,
        lastSynced: c.lastSynced,
        createdAt: c.createdAt
      }))
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ─── AD LIBRARY RESEARCH ──────────────────────────────────────────────────────
app.post('/api/research/analyze', auth, async (req, res) => {
  const { adUrls, niche, competitor } = req.body;

  const prompt = `You are a world-class Meta ads strategist. Analyze these winning ads from the ${niche} niche${competitor ? ` (competitor: ${competitor})` : ''}.

Based on what top-performing ${niche} ads typically use, generate strategic insights and 3 ad copy variations inspired by winning patterns.

Return JSON with:
{
  "insights": ["insight 1", "insight 2", "insight 3"],
  "hooks": ["winning hook pattern 1", "winning hook pattern 2", "winning hook pattern 3"],
  "variants": [
    {
      "headline": "...",
      "primaryText": "...",
      "description": "...",
      "angle": "3 word angle",
      "score": "9.1/10",
      "isHot": true,
      "rationale": "Why this works"
    }
  ]
}`;

  try {
    const response = await axios.post('https://api.anthropic.com/v1/messages', {
      model: 'claude-sonnet-4-20250514',
      max_tokens: 2000,
      messages: [{ role: 'user', content: prompt }]
    }, {
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': process.env.ANTHROPIC_API_KEY,
        'anthropic-version': '2023-06-01'
      }
    });

    const raw = response.data.content.map(c => c.text || '').join('').replace(/```json|```/g, '').trim();
    res.json(JSON.parse(raw));
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ─── HEALTH CHECK ─────────────────────────────────────────────────────────────
app.get('/health', (req, res) => res.json({ status: 'ok', version: '2.0' }));

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`Perfomity Cowork v2.0 running on port ${PORT}`));
