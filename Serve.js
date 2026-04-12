const express = require('express');
const cors = require('cors');
const app = express();

app.use(cors());
app.use(express.json());
app.use(express.static('public'));

app.post('/generate', async (req, res) => {
  const { brand, benefit, offer, audience, tone, cta } = req.body;

  if (!brand || !benefit || !offer) {
    return res.status(400).json({ error: 'Missing required fields: brand, benefit, offer' });
  }

  const prompt = `You are an elite Meta ads copywriter specialising in DTC ecommerce brands in India. Generate exactly 5 ad variants for this brief:

Brand/Product: ${brand}
Key Benefit: ${benefit}
Offer: ${offer}
Target Audience: ${audience || 'broad ecommerce shoppers India'}
Tone: ${tone || 'Direct and punchy'}
CTA: ${cta || 'Shop Now'}

Return ONLY a valid JSON array with exactly 5 objects. Each object must have these exact keys:
- "headline": string, max 40 chars, punchy hook
- "primaryText": string, max 125 chars, leads with the offer
- "angle": string, exactly 3 words describing the creative angle
- "score": string like "8.7/10" rating ROAS potential
- "isHot": boolean, true for the top 2 variants only

Return raw JSON only. No markdown, no explanation.`;

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
        max_tokens: 1200,
        messages: [{ role: 'user', content: prompt }]
      })
    });

    const data = await response.json();
    if (data.error) throw new Error(data.error.message);

    const raw = data.content.map(c => c.text || '').join('').replace(/```json|```/g, '').trim();
    const variants = JSON.parse(raw);
    res.json({ variants });

  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`Perfomity Cowork server running on port ${PORT}`));
